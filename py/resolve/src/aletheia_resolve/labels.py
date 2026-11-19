"""Hand labels: draft candidate pairs into `data/manual/labels.csv`, then score precision and recall.

Pairs are drawn from fixed strata of the scored pairs so that every decision the resolver makes is checked:

- `merged_99`: merged, p >= 0.99
- `merged_95`: merged, high threshold <= p < 0.99
- `likely`: likely the same donor (not merged)
- `weak_name`: people with only loosely similar first names, p >= likely threshold (never merged)
- `name_conflict`: people with clearly different first names, p >= high threshold (never merged)
- `separate`: 0.2 <= p < likely threshold

Estimates weight each labeled pair by (pairs in its stratum) / (labeled pairs in its stratum), so the
oversampled strata do not distort the totals.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

import polars as pl

REPO = Path(__file__).resolve().parents[4]
LABELS_CSV = REPO / "data" / "manual" / "labels.csv"
SEED = "20261115"

PLAN = {
    "person": {"merged_99": 30, "merged_95": 30, "likely": 25, "weak_name": 15, "name_conflict": 15, "separate": 25},
    "org": {"merged_99": 15, "merged_95": 15, "likely": 15, "separate": 15},
}

FIELDS = [
    "pair_id", "kind", "stratum", "match_probability", "name_rule",
    "left_key", "left_name", "left_employer", "left_occupation", "left_city", "left_state", "left_zip",
    "left_filing_url",
    "right_key", "right_name", "right_employer", "right_occupation", "right_city", "right_state", "right_zip",
    "right_filing_url",
    "label", "labeler", "notes",
]  # fmt: skip

LABEL_VALUES = {"same", "different", "unsure"}


def pair_id(key_l: str, key_r: str) -> str:
    return hashlib.md5(f"{key_l}|{key_r}".encode()).hexdigest()[:12]


def stratum_expr(high: float, likely: float) -> pl.Expr:
    p = pl.col("match_probability")
    rule = pl.col("name_rule")
    return (
        pl.when((rule == "ok") & (p >= 0.99) & (p >= high))
        .then(pl.lit("merged_99"))
        .when((rule == "ok") & (p >= high))
        .then(pl.lit("merged_95"))
        .when((rule == "conflict") & (p >= high))
        .then(pl.lit("name_conflict"))
        .when((rule == "weak") & (p >= likely))
        .then(pl.lit("weak_name"))
        .when((rule == "ok") & (p >= likely))
        .then(pl.lit("likely"))
        .when((rule != "conflict") & (p < likely))
        .then(pl.lit("separate"))
        .otherwise(pl.lit(None))
    )


def filing_url(row_ref: str | None) -> str | None:
    """`RCPT_CD:<filing_id>:<amend_id>:<form>:<line>` -> the state's public PDF of that filing."""
    if not row_ref:
        return None
    parts = row_ref.split(":")
    if len(parts) < 3:
        return None
    return f"https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid={parts[1]}&amendid={parts[2]}"


def with_strata(pairs: pl.DataFrame, high: float, likely: float) -> pl.DataFrame:
    return pairs.with_columns(stratum=stratum_expr(high, likely)).filter(pl.col("stratum").is_not_null())


def draft(pairs: pl.DataFrame, entities: pl.DataFrame, high: float, likely: float) -> list[dict[str, str]]:
    """Pick the candidate pairs (deterministic: ordered by a seeded hash of the pair id)."""
    s = with_strata(pairs, high, likely).with_columns(
        pair_id=pl.concat_str("key_l", pl.lit("|"), "key_r").map_elements(
            lambda x: hashlib.md5(x.encode()).hexdigest()[:12], return_dtype=pl.Utf8
        )
    )
    s = s.with_columns(
        order=pl.concat_str(pl.lit(SEED), "pair_id").map_elements(
            lambda x: hashlib.md5(x.encode()).hexdigest(), return_dtype=pl.Utf8
        )
    )
    picks = []
    for kind, plan in PLAN.items():
        for stratum, n in plan.items():
            picks.append(s.filter((pl.col("kind") == kind) & (pl.col("stratum") == stratum)).sort("order").head(n))
    chosen = pl.concat(picks)
    e = entities.select("canonical_key", "name", "employer", "occupation", "city", "state", "zip", "row_ref")
    chosen = chosen.join(e, left_on="key_l", right_on="canonical_key").join(
        e, left_on="key_r", right_on="canonical_key", suffix="_r"
    )
    rows = []
    for r in chosen.sort("kind", "stratum", "order").iter_rows(named=True):
        rows.append(
            {
                "pair_id": r["pair_id"],
                "kind": r["kind"],
                "stratum": r["stratum"],
                "match_probability": f"{r['match_probability']:.6f}",
                "name_rule": r["name_rule"],
                "left_key": r["key_l"],
                "left_name": r["name"],
                "left_employer": r["employer"] or "",
                "left_occupation": r["occupation"] or "",
                "left_city": r["city"] or "",
                "left_state": r["state"] or "",
                "left_zip": r["zip"] or "",
                "left_filing_url": filing_url(r["row_ref"]) or "",
                "right_key": r["key_r"],
                "right_name": r["name_r"],
                "right_employer": r["employer_r"] or "",
                "right_occupation": r["occupation_r"] or "",
                "right_city": r["city_r"] or "",
                "right_state": r["state_r"] or "",
                "right_zip": r["zip_r"] or "",
                "right_filing_url": filing_url(r["row_ref_r"]) or "",
                "label": "",
                "labeler": "",
                "notes": "",
            }
        )
    return rows


def write(rows: list[dict[str, str]], path: Path = LABELS_CSV, force: bool = False) -> None:
    if path.exists() and not force and any(r["label"].strip() for r in read(path)):
        raise SystemExit(f"{path} already has labels; pass --force to overwrite them")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def read(path: Path = LABELS_CSV) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


# ---------- evaluation ----------

THRESHOLD_CANDIDATES = [0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 0.999]
MIN_LABELS_ABOVE = 20  # labeled same/different pairs needed above a threshold before trusting its precision


def evaluate(
    labels: list[dict[str, str]], pairs: pl.DataFrame, high: float, likely: float, target: float = 0.98
) -> dict:
    """Weighted pairwise precision and recall per kind and threshold, plus the lowest threshold that meets
    `target` precision with at least MIN_LABELS_ABOVE labels above it (None if no threshold qualifies).

    Labeled pairs are re-scored against the current `pairs` (score and name rule as of this run, not as of
    the draft), then post-stratified: each one is weighted by (current pairs in its stratum) / (labeled pairs
    in its stratum). A labeled pair the current run no longer scores counts as `separate` and not merged.
    """
    current = {
        (k, l, r): (p, rule)
        for k, l, r, p, rule in pairs.select("kind", "key_l", "key_r", "match_probability", "name_rule").iter_rows()
    }
    strata_sizes = {
        (k, s): n for k, s, n in with_strata(pairs, high, likely).group_by("kind", "stratum").len().iter_rows()
    }
    scored = []
    for r in labels:
        if r.get("label", "").strip().lower() not in ("same", "different"):
            continue
        p, rule = current.get((r["kind"], r["left_key"], r["right_key"]), (0.0, "ok"))
        row = pl.DataFrame({"match_probability": [p], "name_rule": [rule]})
        stratum = row.select(stratum_expr(high, likely)).item() or "separate"
        scored.append({"kind": r["kind"], "p": p, "rule": rule, "stratum": stratum, "same": r["label"].strip().lower() == "same"})
    per_stratum: dict[tuple[str, str], int] = {}
    for r in scored:
        per_stratum[(r["kind"], r["stratum"])] = per_stratum.get((r["kind"], r["stratum"]), 0) + 1

    out: dict = {"labels_total": len(labels), "labels_used": len(scored), "kinds": {}}
    for kind in PLAN:
        rows = [r for r in scored if r["kind"] == kind]
        kind_out: dict = {"labels_used": len(rows), "thresholds": [], "recommended_high": None}
        for t in THRESHOLD_CANDIDATES:
            tp = fp = fn = 0.0
            n_above = 0
            for r in rows:
                w = strata_sizes.get((kind, r["stratum"]), 0) / per_stratum[(kind, r["stratum"])]
                merged = r["rule"] == "ok" and r["p"] >= t
                if merged:
                    n_above += 1
                    tp += w if r["same"] else 0.0
                    fp += 0.0 if r["same"] else w
                elif r["same"]:
                    fn += w
            precision = tp / (tp + fp) if tp + fp else None
            recall = tp / (tp + fn) if tp + fn else None
            kind_out["thresholds"].append(
                {"threshold": t, "labels_above": n_above, "precision": precision, "recall": recall}
            )
            if (
                kind_out["recommended_high"] is None
                and precision is not None
                and precision >= target
                and n_above >= MIN_LABELS_ABOVE
            ):
                kind_out["recommended_high"] = t
        out["kinds"][kind] = kind_out
    return out
