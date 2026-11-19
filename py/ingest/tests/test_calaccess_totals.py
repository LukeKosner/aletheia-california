"""2025-2026 contribution totals for three committees must be within 1% of the state's Power Search.

Runs against the loaded Postgres tables when TEST_DATABASE_URL (or DATABASE_URL) is set, and against the DuckDB
out_* tables built by `python -m ingest.calaccess` when data/work/calaccess.duckdb exists. Skips otherwise
(CI has neither).

How Power Search totals a committee (worked out from its CSV export for the three committees below):
- Form 460 Schedule A (monetary) and Schedule C (non-monetary) itemized contributions, plus
- Form 497 Part 1 late contributions dated after the end of the committee's last Form 460 period (late
  contributions inside a 460 period are already itemized on that 460), plus
- the 460's unitemized (under $100) lump sums. Those are summary-page totals, not itemized rows, so they are not
  money_edge rows; they are why our totals can sit slightly under Power Search's.
"""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

import pytest

from ingest.calaccess.download import data_dir

# From https://powersearch.sos.ca.gov/advanced.php: "Contributions To" -> "Just these committees" (CAL-ACCESS ID),
# "Dates" -> range 01/01/2025 to 12/31/2026; the "Results Summary" total. Checked on 2026-11-15, against the
# export downloaded the same day (data/raw/MANIFEST.csv, sha256 6b14bf50...cc9476).
POWER_SEARCH: list[tuple[str, str, Decimal, str]] = [  # (filer_id, name, total, checked_on)
    # 3,265 contributions; includes $47,120.27 of unitemized lump sums.
    ("1486858", "Mahan for Governor 2026", Decimal("15996265.19"), "2026-11-15"),
    # 461 contributions; includes $32,679.47 unitemized and 3 late contributions ($1,815,000).
    ("1485077", "Steyer for Governor 2026", Decimal("222776724.67"), "2026-11-15"),
    # 290 contributions; includes 75 late contributions ($1,581,694.35), no unitemized.
    ("1493991", "No on 39 - Block Election Rigging", Decimal("21342316.24"), "2026-11-15"),
]

START, END = "2025-01-01", "2026-12-31"

# Same query for both backends; {edges} and {filings} are the edge and filing tables, :key the committee key.
TOTAL_SQL = """
WITH e AS (
    SELECT m.amount, m.date, m.schedule, f.form, f.period_end
    FROM {edges} m JOIN {filings} f ON {join}
    WHERE {to_committee} AND m.kind = 'contribution' AND m.schedule IN ('A', 'C', 'F497P1')
),
last460 AS (SELECT max(period_end) AS pe FROM e WHERE form = 'F460')
SELECT coalesce(sum(amount), 0) FROM e, last460
WHERE date BETWEEN DATE '{start}' AND DATE '{end}'
  AND (schedule IN ('A', 'C') OR (schedule = 'F497P1' AND (last460.pe IS NULL OR date > last460.pe)))
"""


def _pg_url() -> str | None:
    return os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")


def _duckdb_path() -> Path:
    return data_dir() / "work" / "calaccess.duckdb"


def _total_pg(filer_id: str) -> Decimal:
    import psycopg

    sql = TOTAL_SQL.format(edges="money_edge", filings="filing", join="f.id = m.filing_id",
                           to_committee="m.to_entity = (SELECT id FROM entity WHERE canonical_key = %(key)s)",
                           start=START, end=END)
    with psycopg.connect(_pg_url()) as pg:
        row = pg.execute(sql, {"key": "calaccess:filer:" + filer_id}).fetchone()
    return Decimal(row[0])


def _total_duckdb(filer_id: str) -> Decimal:
    import duckdb

    sql = TOTAL_SQL.format(edges="out_money_edge", filings="out_filing", join="f.filing_id = m.filing_id",
                           to_committee="m.to_key = $key", start=START, end=END)
    con = duckdb.connect(str(_duckdb_path()), read_only=True)
    row = con.execute(sql, {"key": "calaccess:filer:" + filer_id}).fetchone()
    return Decimal(row[0])


BACKENDS = [
    pytest.param(_total_pg, marks=pytest.mark.skipif(not _pg_url(), reason="no TEST_DATABASE_URL/DATABASE_URL"),
                 id="postgres"),
    pytest.param(_total_duckdb, marks=pytest.mark.skipif(not _duckdb_path().exists(), reason="no staged DuckDB"),
                 id="duckdb"),
]


@pytest.mark.parametrize("total", BACKENDS)
@pytest.mark.parametrize(("filer_id", "name", "expected", "checked_on"), POWER_SEARCH)
def test_within_one_percent_of_power_search(total, filer_id: str, name: str, expected: Decimal, checked_on: str) -> None:
    got = total(filer_id)
    assert abs(got - expected) <= expected * Decimal("0.01"), (
        f"{name} ({filer_id}): ours {got} vs Power Search {expected} (checked {checked_on})"
    )
