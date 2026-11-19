"""Turn scored pairs into donor entities.

- match_probability >= high threshold (and name_rule 'ok'): same entity.
- likely threshold <= p, not merged: "likely the same donor". Never merged; kept as a link between two
  entities that must be shown with that label wherever it appears.
- below the likely threshold, or name_rule 'conflict': separate.

Merging is constrained connected components. High pairs are applied strongest first; a union is refused if
the combined entity would hold two people who cannot be the same person: different full first names
(not equal and Jaro-Winkler < 0.92), different middle initials, different generational suffixes (JR vs SR),
or opposite titles (MR vs MRS/MS).
This stops chains like "JACQUES YEAGER SR" - "JACQUES YEAGER" - "JACQUES YEAGER JR".

The entity key is the smallest member `canonical_key`. Edges are processed in a fixed order
(probability descending, then keys), so the same input, model and thresholds give identical output.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import duckdb
import polars as pl

LIKELY_LABEL = "likely the same donor"


def jaro_winkler(a: str, b: str) -> float:
    row = duckdb.execute("SELECT jaro_winkler_similarity(?, ?)", [a, b]).fetchone()
    assert row is not None
    return float(row[0])


@dataclass
class _Group:
    first_names: set[str] = field(default_factory=set)  # full first names (length > 1)
    middle_initials: set[str] = field(default_factory=set)
    suffixes: set[str] = field(default_factory=set)
    genders: set[str] = field(default_factory=set)  # from MR / MRS / MS titles


class _ConstrainedUnionFind:
    def __init__(self, attrs: dict[str, tuple[str | None, ...]]) -> None:
        self.parent: dict[str, str] = {}
        self.groups: dict[str, _Group] = {}
        self.attrs = attrs
        self._jw: dict[tuple[str, str], float] = {}

    def find(self, x: str) -> str:
        parent = self.parent
        root = x
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(x, x) != root:
            parent[x], x = root, parent[x]
        return root

    def _group(self, root: str) -> _Group:
        g = self.groups.get(root)
        if g is None:
            first, middle, suffix, gender = self.attrs.get(root, (None, None, None, None))
            g = _Group()
            if first and len(first) > 1:
                g.first_names.add(first)
            if middle:
                g.middle_initials.add(middle[0])
            if suffix:
                g.suffixes.add(suffix)
            if gender:
                g.genders.add(gender)
            self.groups[root] = g
        return g

    def _names_compatible(self, a: set[str], b: set[str]) -> bool:
        for x in a:
            for y in b:
                if x == y:
                    continue
                key = (x, y) if x < y else (y, x)
                if key not in self._jw:
                    self._jw[key] = jaro_winkler(*key)
                if self._jw[key] < 0.92:
                    return False
        return True

    def union(self, a: str, b: str) -> bool:
        """Merge the groups of a and b unless that would combine incompatible people. True if merged."""
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return True
        ga, gb = self._group(ra), self._group(rb)
        if len(ga.suffixes | gb.suffixes) > 1:
            return False
        if len(ga.middle_initials | gb.middle_initials) > 1:
            return False
        if len(ga.genders | gb.genders) > 1:
            return False
        if not self._names_compatible(ga.first_names, gb.first_names):
            return False
        if rb < ra:
            ra, rb, ga, gb = rb, ra, gb, ga
        self.parent[rb] = ra
        ga.first_names |= gb.first_names
        ga.middle_initials |= gb.middle_initials
        ga.suffixes |= gb.suffixes
        ga.genders |= gb.genders
        del self.groups[rb]
        return True


def cluster(
    entities: pl.DataFrame, pairs: pl.DataFrame, high: float, likely: float
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Return (members, likely_links).

    entities: canonical_key, kind, and for people optionally first_name, middle_name, gen_suffix, title_gender.
    pairs: kind, key_l, key_r, match_probability, optional name_rule
    ('conflict' pairs are ignored; 'weak' pairs can be likely but never merged).

    members: canonical_key, kind, entity_key, cluster_size, match_score, confidence. `match_score` is the
    highest pair probability that joined this record to the entity (1.0 for the entity's own key and for
    singletons). confidence is "high" for every merged record.
    likely_links: kind, entity_key_l, entity_key_r, match_probability (best pair between the two entities),
    label. Includes high-scoring pairs whose merge was refused by the constraints above.
    """
    if "name_rule" in pairs.columns:
        pairs = pairs.filter(pl.col("name_rule") != "conflict")
        is_high = (pl.col("match_probability") >= high) & (pl.col("name_rule") == "ok")
    else:
        is_high = pl.col("match_probability") >= high

    kinds = dict(entities.select("canonical_key", "kind").iter_rows())
    attrs: dict[str, tuple[str | None, ...]] = {}
    if "first_name" in entities.columns:
        cols = [
            pl.col(c) if c in entities.columns else pl.lit(None, pl.Utf8).alias(c)
            for c in ("first_name", "middle_name", "gen_suffix", "title_gender")
        ]
        attrs = {k: tuple(v) for k, *v in entities.select("canonical_key", *cols).iter_rows()}

    uf = _ConstrainedUnionFind(attrs)
    best: dict[str, float] = {}
    order = pairs.filter(is_high).sort(["match_probability", "key_l", "key_r"], descending=[True, False, False])
    for k_l, k_r, p in order.select("key_l", "key_r", "match_probability").iter_rows():
        if kinds.get(k_l) != kinds.get(k_r) or kinds.get(k_l) not in ("person", "org"):
            raise ValueError(f"refusing to merge {k_l} ({kinds.get(k_l)}) with {k_r} ({kinds.get(k_r)})")
        if uf.union(k_l, k_r):
            for k in (k_l, k_r):
                if p > best.get(k, 0.0):
                    best[k] = p

    keys = entities["canonical_key"].to_list()
    entity_key = [uf.find(k) for k in keys]
    members = (
        entities.select("canonical_key", "kind")
        .with_columns(entity_key=pl.Series(entity_key, dtype=pl.Utf8))
        .with_columns(cluster_size=pl.len().over("entity_key").cast(pl.Int32))
        .with_columns(
            match_score=pl.when(pl.col("canonical_key") == pl.col("entity_key"))
            .then(1.0)
            .otherwise(pl.col("canonical_key").replace_strict(best, default=1.0, return_dtype=pl.Float64)),
            confidence=pl.lit("high"),
        )
        .sort("canonical_key")
    )

    ek = dict(zip(keys, entity_key, strict=True))
    likely_rows = (
        pairs.filter(pl.col("match_probability") >= likely)
        .with_columns(
            a=pl.col("key_l").replace_strict(ek, return_dtype=pl.Utf8),
            b=pl.col("key_r").replace_strict(ek, return_dtype=pl.Utf8),
        )
        .filter(pl.col("a") != pl.col("b"))
        .with_columns(entity_key_l=pl.min_horizontal("a", "b"), entity_key_r=pl.max_horizontal("a", "b"))
        .group_by("kind", "entity_key_l", "entity_key_r")
        .agg(pl.col("match_probability").max())
        .with_columns(label=pl.lit(LIKELY_LABEL))
        .select("kind", "entity_key_l", "entity_key_r", "match_probability", "label")
        .sort("entity_key_l", "entity_key_r")
    )
    return members, likely_rows
