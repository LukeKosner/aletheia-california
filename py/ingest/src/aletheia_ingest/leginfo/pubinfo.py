"""Read tables out of a leginfo PUBINFO session zip.

Source: https://downloads.leginfo.legislature.ca.gov/ (pubinfo_YYYY.zip).
Format, from pubinfo_Readme.pdf and the LOAD DATA scripts in pubinfo_load.zip:
one ``TABLE_NAME.dat`` per table, tab separated, fields optionally enclosed in
backticks, lines ending in ``\\n``, no header row. Column order is the column
list in each ``<table>.sql`` LOAD DATA statement (copied below).
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import polars as pl

# Column lists copied from the LOAD DATA statements in pubinfo_load.zip
# (bill_tbl.sql, bill_version_tbl.sql, ...). ``@var1`` in bill_version_tbl is the
# LOB file name for the bill text, which we do not load.
COLUMNS: dict[str, list[str]] = {
    "BILL_TBL": [
        "BILL_ID", "SESSION_YEAR", "SESSION_NUM", "MEASURE_TYPE", "MEASURE_NUM",
        "MEASURE_STATE", "CHAPTER_YEAR", "CHAPTER_TYPE", "CHAPTER_SESSION_NUM",
        "CHAPTER_NUM", "LATEST_BILL_VERSION_ID", "ACTIVE_FLG", "TRANS_UID",
        "TRANS_UPDATE", "CURRENT_LOCATION", "CURRENT_SECONDARY_LOC",
        "CURRENT_HOUSE", "CURRENT_STATUS", "DAYS_31ST_IN_PRINT",
    ],
    "BILL_VERSION_TBL": [
        "BILL_VERSION_ID", "BILL_ID", "VERSION_NUM", "BILL_VERSION_ACTION_DATE",
        "BILL_VERSION_ACTION", "REQUEST_NUM", "SUBJECT", "VOTE_REQUIRED",
        "APPROPRIATION", "FISCAL_COMMITTEE", "LOCAL_PROGRAM",
        "SUBSTANTIVE_CHANGES", "URGENCY", "TAXLEVY", "BILL_XML_LOB",
        "ACTIVE_FLG", "TRANS_UID", "TRANS_UPDATE",
    ],
    "BILL_VERSION_AUTHORS_TBL": [
        "BILL_VERSION_ID", "TYPE", "HOUSE", "NAME", "CONTRIBUTION",
        "COMMITTEE_MEMBERS", "ACTIVE_FLG", "TRANS_UID", "TRANS_UPDATE",
        "PRIMARY_AUTHOR_FLG",
    ],
    "BILL_DETAIL_VOTE_TBL": [
        "BILL_ID", "LOCATION_CODE", "LEGISLATOR_NAME", "VOTE_DATE_TIME",
        "VOTE_DATE_SEQ", "VOTE_CODE", "MOTION_ID", "TRANS_UID", "TRANS_UPDATE",
        "MEMBER_ORDER", "SESSION_DATE", "SPEAKER",
    ],
    "BILL_SUMMARY_VOTE_TBL": [
        "BILL_ID", "LOCATION_CODE", "VOTE_DATE_TIME", "VOTE_DATE_SEQ",
        "MOTION_ID", "AYES", "NOES", "ABSTAIN", "VOTE_RESULT", "TRANS_UID",
        "TRANS_UPDATE", "FILE_ITEM_NUM", "FILE_LOCATION", "DISPLAY_LINES",
        "SESSION_DATE",
    ],
    "BILL_MOTION_TBL": ["MOTION_ID", "MOTION_TEXT", "TRANS_UID", "TRANS_UPDATE"],
    "LEGISLATOR_TBL": [
        "DISTRICT", "SESSION_YEAR", "LEGISLATOR_NAME", "HOUSE_TYPE",
        "AUTHOR_NAME", "FIRST_NAME", "LAST_NAME", "MIDDLE_INITIAL",
        "NAME_SUFFIX", "NAME_TITLE", "WEB_NAME_TITLE", "PARTY", "ACTIVE_FLG",
        "TRANS_UID", "TRANS_UPDATE", "ACTIVE_LEGISLATOR",
    ],
    "LOCATION_CODE_TBL": [
        "SESSION_YEAR", "LOCATION_CODE", "LOCATION_TYPE",
        "CONSENT_CALENDAR_CODE", "DESCRIPTION", "LONG_DESCRIPTION",
        "ACTIVE_FLG", "TRANS_UID", "TRANS_UPDATE", "INACTIVE_FILE_FLG",
    ],
}


def parse_dat(data: bytes, table: str) -> pl.DataFrame:
    """Parse one PUBINFO ``.dat`` file. Every column is read as a string."""
    cols = COLUMNS[table]
    if not data.strip():
        return pl.DataFrame(schema={c: pl.String for c in cols})
    df = pl.read_csv(
        io.BytesIO(data),
        separator="\t",
        quote_char="`",
        has_header=False,
        new_columns=cols,
        schema_overrides={c: pl.String for c in cols},
        infer_schema=False,
        null_values=["\\N", "NULL"],
        encoding="utf8-lossy",
    )
    if df.width != len(cols):
        raise ValueError(f"{table}: expected {len(cols)} columns, got {df.width}")
    # Empty strings mean "no value" in these dumps.
    return df.with_columns(pl.col(c).str.strip_chars().replace("", None) for c in cols)


def read_table(zip_path: Path, table: str) -> pl.DataFrame:
    """Read ``TABLE.dat`` from a pubinfo zip without unpacking the whole archive."""
    with zipfile.ZipFile(zip_path) as zf:
        names = {Path(n).name.upper(): n for n in zf.namelist()}
        member = names.get(f"{table}.DAT")
        if member is None:
            raise FileNotFoundError(f"{table}.dat not in {zip_path}")
        return parse_dat(zf.read(member), table)
