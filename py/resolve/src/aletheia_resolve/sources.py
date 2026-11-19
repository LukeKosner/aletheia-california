"""Read raw CAL-ACCESS donor entities. Read-only: DuckDB is opened read_only, Postgres in a read-only session.

Raw entities are `entity` rows with `canonical_key LIKE 'calaccess:raw:%'` and `attrs.temporary = true`
(see `py/ingest/README.md`, CAL-ACCESS > Mapping). Filers (`calaccess:filer:%`) are never read here, so they
can never be merged.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import polars as pl

COLUMNS = ["canonical_key", "kind", "name", "entity_cd", "city", "state", "zip", "employer", "occupation", "row_ref"]

_DUCKDB_SQL = """
SELECT canonical_key, kind, name, attrs->>'entity_cd' AS entity_cd, attrs->>'city' AS city,
       attrs->>'state' AS state, attrs->>'zip' AS zip, attrs->>'employer' AS employer,
       attrs->>'occupation' AS occupation, row_ref
FROM out_entity
WHERE canonical_key LIKE 'calaccess:raw:%' AND coalesce(attrs->>'temporary', '') = 'true'
ORDER BY canonical_key
"""

_POSTGRES_SQL = """
SELECT e.canonical_key, e.kind::text, e.name, e.attrs->>'entity_cd', e.attrs->>'city', e.attrs->>'state',
       e.attrs->>'zip', e.attrs->>'employer', e.attrs->>'occupation', a.source_row_id
FROM entity e
LEFT JOIN entity_alias a ON a.entity_id = e.id AND a.method = 'raw'
WHERE e.canonical_key LIKE 'calaccess:raw:%' AND coalesce(e.attrs->>'temporary', '') = 'true'
ORDER BY e.canonical_key
"""


def from_duckdb(path: Path) -> pl.DataFrame:
    with duckdb.connect(str(path), read_only=True) as con:
        out = pl.from_arrow(con.sql(_DUCKDB_SQL).to_arrow_table())
    assert isinstance(out, pl.DataFrame)
    return out


def from_postgres(url: str) -> pl.DataFrame:
    import psycopg

    with psycopg.connect(url) as con:
        con.read_only = True
        with con.cursor() as cur:
            cur.execute(_POSTGRES_SQL)
            rows = cur.fetchall()
    return pl.DataFrame(rows, schema=COLUMNS, orient="row").unique("canonical_key", keep="first").sort("canonical_key")


def from_parquet(path: Path) -> pl.DataFrame:
    return pl.read_parquet(path).select(COLUMNS).sort("canonical_key")


def load(source: str) -> pl.DataFrame:
    """`source` is a postgres:// URL, a .duckdb file or a .parquet file."""
    if source.startswith(("postgres://", "postgresql://")):
        return from_postgres(source)
    p = Path(source)
    if p.suffix == ".duckdb":
        return from_duckdb(p)
    return from_parquet(p)
