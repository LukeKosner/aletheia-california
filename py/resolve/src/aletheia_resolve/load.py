"""Write a resolution run into Postgres. Additive and reversible; no schema change.

Approved by the project owner on 2026-11-15 as an exception to "agents never write to the database".

What it writes, in one transaction:

1. Clears any earlier resolution: removes the keys below from raw entities' `attrs` and deletes
   `entity_alias` rows with `method = 'splink'`. Reruns therefore replace, never accumulate.
2. For every raw person/org in a multi-record entity, merges into `entity.attrs`:
   `resolved_entity_key` (the entity's canonical key, the smallest member key), `resolved_entity_id`,
   `resolved_member_count`, `match_score` and `confidence` ("high").
3. For every member other than the entity's own key, adds an `entity_alias` row on the resolved entity
   (`method = 'splink'`, `match_score`, same raw name and source row as the member's raw alias), so every
   spelling of a donor is found from the resolved entity.
4. For every "likely the same donor" link, adds to both entities' `attrs.likely_same_donor` a list of
   `{entity_key, match_probability, label}`. These are never merged and must be shown with the label.

Money edges are not touched: totals per donor group by `coalesce(attrs->>'resolved_entity_key', canonical_key)`.
Undo: rerun with an empty resolution, or run the two statements in `clear()`.

The CAL-ACCESS ingest load replaces `entity.attrs` on upsert, so rerun this after any ingest reload.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

KEYS = [
    "resolved_entity_key",
    "resolved_entity_id",
    "resolved_member_count",
    "match_score",
    "confidence",
    "likely_same_donor",
]
_KEYS_SQL = "ARRAY[" + ", ".join(f"'{k}'" for k in KEYS) + "]"

CLEAR_ATTRS = f"""
UPDATE entity SET attrs = attrs - {_KEYS_SQL}::text[]
WHERE canonical_key LIKE 'calaccess:raw:%' AND attrs ?| {_KEYS_SQL}::text[]
"""
CLEAR_ALIASES = "DELETE FROM entity_alias WHERE method = 'splink'"


def _copy(cur, table: str, columns: list[str], frame: pl.DataFrame) -> None:
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as cp:
        for row in frame.select(columns).iter_rows():
            cp.write_row(row)


def load(url: str, out_dir: Path, dry_run: bool = False) -> dict[str, int]:
    import psycopg

    members = pl.read_parquet(out_dir / "members.parquet")
    likely = pl.read_parquet(out_dir / "likely_links.parquet")
    multi = members.filter(pl.col("cluster_size") > 1).select(
        "canonical_key", "entity_key", "match_score", "confidence", "cluster_size"
    )
    stats: dict[str, int] = {}
    with psycopg.connect(url) as con, con.cursor() as cur:
        raw_in_db = cur.execute("SELECT count(*) FROM entity WHERE canonical_key LIKE 'calaccess:raw:%'").fetchone()[0]
        stats["raw_entities_in_db"] = raw_in_db
        if raw_in_db < 0.99 * members.height:
            raise SystemExit(
                f"database has {raw_in_db:,} raw entities but the resolution covers {members.height:,}; "
                "load CAL-ACCESS first (python -m ingest.calaccess), then rerun `run --source $DATABASE_URL`"
            )
        cur.execute("SET LOCAL statement_timeout = 0")
        stats["attrs_cleared"] = cur.execute(CLEAR_ATTRS).rowcount
        stats["aliases_cleared"] = cur.execute(CLEAR_ALIASES).rowcount

        cur.execute(
            "CREATE TEMP TABLE r_member (canonical_key text PRIMARY KEY, entity_key text, match_score float8, "
            "confidence text, cluster_size int) ON COMMIT DROP"
        )
        _copy(cur, "r_member", multi.columns, multi)
        cur.execute("ANALYZE r_member")
        stats["entities_marked"] = cur.execute(
            """
            UPDATE entity e SET attrs = e.attrs || jsonb_build_object(
                'resolved_entity_key', m.entity_key, 'resolved_entity_id', root.id,
                'resolved_member_count', m.cluster_size, 'match_score', round(m.match_score::numeric, 6),
                'confidence', m.confidence)
            FROM r_member m JOIN entity root ON root.canonical_key = m.entity_key
            WHERE e.canonical_key = m.canonical_key
            """
        ).rowcount
        if stats["entities_marked"] < 0.99 * multi.height:
            raise SystemExit(
                f"only {stats['entities_marked']:,} of {multi.height:,} resolved records exist in this database; "
                "the resolution was built from different data. Rerun `run --source $DATABASE_URL` first."
            )
        stats["aliases_added"] = cur.execute(
            """
            INSERT INTO entity_alias (id, entity_id, raw_name, source, source_row_id, match_score, method)
            SELECT md5(m.canonical_key || ':splink')::uuid, root.id, a.raw_name, a.source, a.source_row_id,
                   m.match_score, 'splink'
            FROM r_member m
            JOIN entity e ON e.canonical_key = m.canonical_key
            JOIN entity_alias a ON a.entity_id = e.id AND a.method = 'raw'
            JOIN entity root ON root.canonical_key = m.entity_key
            WHERE m.canonical_key <> m.entity_key
            """
        ).rowcount

        cur.execute(
            "CREATE TEMP TABLE r_likely (entity_key_l text, entity_key_r text, match_probability float8, label text) "
            "ON COMMIT DROP"
        )
        _copy(cur, "r_likely", ["entity_key_l", "entity_key_r", "match_probability", "label"], likely)
        stats["likely_entities_marked"] = cur.execute(
            """
            WITH sides AS (
                SELECT entity_key_l AS k, entity_key_r AS other, match_probability, label FROM r_likely
                UNION ALL
                SELECT entity_key_r, entity_key_l, match_probability, label FROM r_likely
            ), agg AS (
                SELECT k, jsonb_agg(jsonb_build_object('entity_key', other,
                           'match_probability', round(match_probability::numeric, 6), 'label', label)
                       ORDER BY match_probability DESC, other) AS links
                FROM sides GROUP BY k
            )
            UPDATE entity e SET attrs = e.attrs || jsonb_build_object('likely_same_donor', agg.links)
            FROM agg WHERE e.canonical_key = agg.k
            """
        ).rowcount
        if dry_run:
            con.rollback()
            stats["committed"] = 0
        else:
            con.commit()
            stats["committed"] = 1
    return stats
