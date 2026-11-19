"""Export the CAL-ACCESS slice used by packages/tools tests.

Source: CAL-ACCESS bulk export https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip
(sha256 6b14bf50067fddd45ea5b1bf43ce6fbc62297d8ce4df1b1eaca6c82cfacc9476, Last-Modified Sun, 15 Nov 2026 09:54:02 GMT,
see data/raw/MANIFEST.csv), transformed by py/ingest (`--no-db`) into data/work/calaccess.duckdb. Ids are the
loader's deterministic ids, so they match the rows in Postgres.

Slice: every 2025+ edge to or from filer 1400190 (the California Association of Realtors ballot measure
committee), plus 2026 edges of $250,000 or more into filer 782560 (California Association of Realtors Issues
Mobilization PAC), with their entities and filings. That gives a real 3-hop chain:
782560 -> 1400190 -> 1481256 (CA HOMES COMMITTEE).

Run from py/ingest (set CALACCESS_DUCKDB when running from a worktree):
    uv run python ../../packages/tools/test/fixtures/export_calaccess_slice.py
"""
import json
import os
from pathlib import Path

import duckdb

DB = Path(os.environ.get("CALACCESS_DUCKDB") or Path(__file__).resolve().parents[4] / "data/work/calaccess.duckdb")
OUT = Path(__file__).with_name("calaccess_slice.json")

con = duckdb.connect(str(DB), read_only=True)
edges_sql = """
select id, from_key, to_key, cast(amount as varchar) amount, cast(date as varchar) date, kind, filing_id, amend_id,
       schedule, line_item
from out_money_edge
where ((from_key = 'calaccess:filer:1400190' or to_key = 'calaccess:filer:1400190') and date >= '2025-01-01')
   or (to_key = 'calaccess:filer:782560' and date >= '2026-01-01' and amount >= 250000)
order by id
"""
cols = ["id", "from_key", "to_key", "amount", "date", "kind", "filing_id", "amend_id", "schedule", "line_item"]
edges = [dict(zip(cols, r)) for r in con.sql(edges_sql).fetchall()]
keys = sorted({e["from_key"] for e in edges} | {e["to_key"] for e in edges})
fids = sorted({(e["filing_id"], e["amend_id"]) for e in edges})
ents = [
    dict(zip(["id", "kind", "name", "canonical_key", "attrs"], r))
    for r in con.execute(
        "select id, kind, name, canonical_key, cast(attrs as varchar) from out_entity where canonical_key in "
        "(select unnest(?)) order by canonical_key",
        [keys],
    ).fetchall()
]
fils = []
for f, a in fids:
    r = con.execute(
        "select id, source, filing_id, amendment_no, form, cast(filed_at as varchar), cast(period_start as varchar),"
        " cast(period_end as varchar), url from out_filing where filing_id = ? and amendment_no = ?",
        [f, a],
    ).fetchall()
    fils += [dict(zip(["id", "source", "filing_id", "amendment_no", "form", "filed_at", "period_start", "period_end", "url"], x)) for x in r]
for e in ents:
    e["attrs"] = json.loads(e["attrs"]) if e["attrs"] else {}
OUT.write_text(json.dumps({
    "_source": __doc__.strip().splitlines()[2:5],
    "entities": ents, "filings": fils, "edges": edges,
}, indent=1, ensure_ascii=False) + "\n")
print(len(ents), "entities", len(fils), "filings", len(edges), "edges")
