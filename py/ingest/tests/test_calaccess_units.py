"""Unit tests for the CAL-ACCESS stager and transform helpers. No network, no database, no raw export needed.

Fixture lines are copied byte-for-byte from the CAL-ACCESS raw export downloaded 2026-11-15
(https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip, sha256 6b14bf50...cc9476, see data/raw/MANIFEST.csv).
"""

from __future__ import annotations

import io
import re
import uuid

import duckdb

from ingest.calaccess.stage import TableStats, iter_rows, iter_rows_free_text_last
from ingest.calaccess.transform import MACROS, bills_sql

# FILERNAME_CD header and filer 1475433 (lobbying client "POLAR TANKERS, INC., AN AFFILIATE OF CONOCOPHILLIPS
# COMPANY"). The export breaks the name across two physical lines.
FILERNAME_HEADER = (
    "XREF_FILER_ID\tFILER_ID\tFILER_TYPE\tSTATUS\tEFFECT_DT\tNAML\tNAMF\tNAMT\tNAMS\tADR1\tADR2\tCITY\tST\tZIP4"
    "\tPHON\tFAX\tEMAIL"
)
FILERNAME_BROKEN = (
    b"1475433\t1475433\tCLIENT\tINACTIVE\t01/01/2025\tPOLAR TANKERS, INC., AN \r\n"
    b"AFFILIATE OF CONOCOPHILLIPS COMPANY\t\t\t\t\t\tHOUSTON\tTX\t77079    \t2812931000\t\t\r\n"
)
# FILERNAME_CD filer 1419401 (SOOTHE), a normal one-line row.
FILERNAME_OK = (
    b"1419401\t1419401\tCLIENT\tINACTIVE\t01/01/2025\tSOOTHE \t\t\t\t\t\tWEST HOLLYWOOD, CA 90069\tCA\t90069    "
    b"\t2134007044\t\tjeff@soothe.com\r\n"
)

# LPAY_CD filing 624015, amendment 0, line 3 (Form 625 Part 2, payment to a lobbying firm from Blue Cross of
# California). https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=624015&amendid=0
LPAY_ACTIVITY_624015_3 = (
    "AB 1751; SB 2007. GOV's ofc re: pending legis. Pertaining to binding arbitration & collective bargaining as "
    "it relates to health insurance policies."
)


def _run(lines: bytes, ncols: int, fn=iter_rows) -> tuple[list[list[str]], TableStats, list]:
    stats = TableStats("T")
    rejects: list = []
    rows = list(fn(io.BytesIO(lines), ncols, stats, rejects))
    stats.check()
    return rows, stats, rejects


def test_broken_row_is_rejoined() -> None:
    ncols = len(FILERNAME_HEADER.split("\t"))
    rows, stats, rejects = _run(FILERNAME_OK + FILERNAME_BROKEN + FILERNAME_OK, ncols)
    assert len(rows) == 3 and not rejects
    assert stats.rows_repaired == 1 and stats.lines_joined == 2 and stats.physical_lines == 4
    assert rows[1][5] == "POLAR TANKERS, INC., AN  AFFILIATE OF CONOCOPHILLIPS COMPANY"
    assert rows[1][11] == "HOUSTON"


def test_extra_field_is_rejected_not_dropped() -> None:
    # The SOOTHE row with one extra non-empty field spliced in (a stray tab inside a value): it cannot be
    # placed safely, so it must land in rejects and be counted.
    ncols = len(FILERNAME_HEADER.split("\t"))
    bad = FILERNAME_OK.replace(b"SOOTHE \t", b"SOOTHE \tX\t")
    rows, stats, rejects = _run(FILERNAME_OK + bad, ncols)
    assert len(rows) == 1
    assert stats.rows_rejected == 1 and rejects[0][2] == "too_many_fields"


def test_unrepairable_fragment_does_not_swallow_next_row() -> None:
    ncols = len(FILERNAME_HEADER.split("\t"))
    first_half = FILERNAME_BROKEN.split(b"\r\n")[0] + b"\r\n"
    rows, stats, rejects = _run(first_half + FILERNAME_OK, ncols)
    assert [r[1] for r in rows] == ["1419401"]
    assert stats.rows_rejected == 1 and rejects[0][2] == "too_few_fields"


def test_free_text_memo_continuation_lines() -> None:
    # TEXT_MEMO_CD-shaped record built from the LPAY_CD 624015 activity text, split by an embedded line break
    # and an embedded tab inside the last (free text) column.
    head = b"624015\t0\t3\tTEXT\tF625P2\tLPAY3\t"
    text = LPAY_ACTIVITY_624015_3.encode()
    lines = head + text[:40] + b"\r\n" + text[40:80] + b"\t" + text[80:] + b"\r\n" + head + b"AB 1751\r\n"
    rows, stats, _ = _run(lines, 7, iter_rows_free_text_last)
    assert len(rows) == 2 and stats.rows_repaired == 1
    assert rows[0][6].replace("\n", "").replace("\t", "") == LPAY_ACTIVITY_624015_3


def test_bill_extraction() -> None:
    con = duckdb.connect()
    got = con.execute(f"SELECT {bills_sql('t')} FROM (SELECT ? AS t)", [LPAY_ACTIVITY_624015_3]).fetchone()[0]
    assert got == ["AB 1751", "SB 2007"]
    # Spacing/dash variants allowed by the task regex, and no match inside longer numbers or words.
    assert con.execute(f"SELECT {bills_sql('t')} FROM (SELECT 'AB-1751, sb 2007, ACA 5, SB12345, MASB 3' AS t)").fetchone()[0] == [
        "AB 1751", "ACA 5", "SB 2007",
    ]


def test_det_uuid_is_stable_and_valid() -> None:
    con = duckdb.connect()
    con.execute(MACROS)
    a, b = con.execute("SELECT det_uuid('calaccess:filer:1419401'), det_uuid('calaccess:filer:1419401')").fetchone()
    assert a == b
    assert uuid.UUID(a).version == 3
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", a)
