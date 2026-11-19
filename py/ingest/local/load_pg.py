"""Copy staging parquet into the shared Postgres tables. Humans run this; agents never write to the database.

Idempotent: filings conflict on (source, filing_id, amendment_no), entities on
canonical_key, aliases and edges on their deterministic uuid5 ids. Edges join to
entities by canonical_key, so a committee already loaded from state data
(`calaccess:filer:<id>`) is reused rather than duplicated.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl
import psycopg

STAGING_DDL = """
create temp table stg_filing (id uuid, source text, filing_id text, amendment_no int, form text,
  filed_at date, period_start date, period_end date, url text, filing_key text) on commit drop;
create temp table stg_entity (id uuid, kind text, name text, canonical_key text, attrs text) on commit drop;
create temp table stg_alias (id uuid, canonical_key text, raw_name text, source text, source_row_id text,
  match_score real, method text) on commit drop;
create temp table stg_edge (id uuid, amount numeric(14,2), date date, kind text, schedule text, line_item text,
  from_key text, to_key text, filing_key text) on commit drop;
"""

MERGE = """
insert into filing (id, source, filing_id, amendment_no, form, filed_at, period_start, period_end, url)
select id, source, filing_id, amendment_no, form, filed_at::timestamptz, period_start, period_end, url from stg_filing
on conflict (source, filing_id, amendment_no) do nothing;

insert into entity (id, kind, name, canonical_key, attrs)
select id, kind::entity_kind, name, canonical_key, coalesce(attrs::jsonb, '{}'::jsonb) from stg_entity
on conflict (canonical_key) do nothing;

insert into entity_alias (id, entity_id, raw_name, source, source_row_id, match_score, method)
select a.id, e.id, a.raw_name, a.source, a.source_row_id, a.match_score, a.method
from stg_alias a join entity e on e.canonical_key = a.canonical_key
on conflict (id) do nothing;

insert into money_edge (id, from_entity, to_entity, amount, date, kind, filing_id, schedule, line_item)
select s.id, ef.id, et.id, s.amount, s.date, s.kind::money_edge_kind, f.id, s.schedule, s.line_item
from stg_edge s
join entity ef on ef.canonical_key = s.from_key
join entity et on et.canonical_key = s.to_key
join stg_filing sf on sf.filing_key = s.filing_key
join filing f on f.source = sf.source and f.filing_id = sf.filing_id and f.amendment_no = sf.amendment_no
on conflict (id) do nothing;
"""

COLUMNS = {
    "stg_filing": ("filing", ["id", "source", "filing_id", "amendment_no", "form", "filed_at", "period_start", "period_end", "url", "filing_key"]),
    "stg_entity": ("entity", ["id", "kind", "name", "canonical_key", "attrs"]),
    "stg_alias": ("entity_alias", ["id", "canonical_key", "raw_name", "source", "source_row_id", "match_score", "method"]),
    "stg_edge": ("money_edge", ["id", "amount", "date", "kind", "schedule", "line_item", "from_key", "to_key", "filing_key"]),
}  # fmt: skip


def load(staging: Path, database_url: str) -> dict[str, int]:
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(STAGING_DDL)
        for table, (name, cols) in COLUMNS.items():
            df = pl.read_parquet(staging / f"{name}.parquet", columns=cols)
            with cur.copy(f"copy {table} ({', '.join(cols)}) from stdin") as copy:
                for row in df.iter_rows():
                    copy.write_row(row)
        cur.execute(MERGE)
        counts = {}
        for t in ("filing", "entity", "entity_alias", "money_edge"):
            cur.execute(f"select count(*) from {t}")
            counts[t] = cur.fetchone()[0]
        conn.commit()
    print(f"loaded {staging.name}: {counts}")
    return counts
