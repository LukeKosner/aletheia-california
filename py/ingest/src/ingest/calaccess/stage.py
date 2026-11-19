"""Stage CAL-ACCESS raw tables into DuckDB as text, straight from the export zip.

Every physical line of every staged table ends up in exactly one place:
- a row in the staged table (possibly after joining lines split by an embedded line break), or
- a row in `_rejects` with the reason and the raw text.

Per-table counts go to `_load_log`. Nothing is dropped silently.

Table guide: https://calaccess.californiacivicdata.org/documentation/raw-files/
"""

from __future__ import annotations

import io
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import polars as pl

# Tables we stage, by CCDC group. Names are the TSV file stems inside CalAccess/DATA/.
FILER_TABLES = ["FILERS_CD", "FILERNAME_CD", "FILER_XREF_CD", "FILER_FILINGS_CD"]
CAMPAIGN_TABLES = [
    "CVR_CAMPAIGN_DISCLOSURE_CD",  # campaign cover pages
    "RCPT_CD",  # receipts (460 A, A-1, C, I; 496 P3; 401 A; 900; E530)
    "EXPN_CD",  # expenditures (460 D, E, G; 450 P5; 461 P5; 465 P3)
    "S497_CD",  # late contributions (497)
    "S496_CD",  # late independent expenditures (496)
    "LOAN_CD",  # loans (460 B1, B2, H)
]
LOBBY_TABLES = [
    "CVR_LOBBY_DISCLOSURE_CD",  # lobbying disclosure covers (615, 625, 635, 645)
    "CVR_REGISTRATION_CD",  # lobbying registration covers (601, 602, 603, 604, 606, 607)
    "LPAY_CD",  # payments to / received by lobbying firms
    "LEXP_CD",  # lobbying activity expenses
    "LCCM_CD",  # lobbyist campaign contributions
    "LEMP_CD",  # lobbyist employers and subcontracted clients
    "LOTH_CD",  # payments to other lobbying firms
    "TEXT_MEMO_CD",  # text memos (long lobbying activity descriptions)
]
TABLES = FILER_TABLES + CAMPAIGN_TABLES + LOBBY_TABLES

CHUNK_ROWS = 250_000
MAX_JOIN_LINES = 20  # give up joining a broken row after this many physical lines


class ArrowStream:
    """Hand a polars frame to DuckDB through the Arrow PyCapsule interface (no pyarrow needed)."""

    def __init__(self, df: pl.DataFrame) -> None:
        self.df = df

    def __arrow_c_stream__(self, requested_schema: object = None) -> object:
        return self.df.__arrow_c_stream__(requested_schema)


@dataclass
class TableStats:
    table: str
    columns: int = 0
    physical_lines: int = 0  # data lines, excluding the header
    rows_loaded: int = 0
    rows_repaired: int = 0  # loaded rows built from more than one physical line
    lines_joined: int = 0  # physical lines consumed by repaired rows
    rows_rejected: int = 0
    lines_rejected: int = 0
    non_utf8_lines: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    def check(self) -> None:
        accounted = (self.rows_loaded - self.rows_repaired) + self.lines_joined + self.lines_rejected
        if accounted != self.physical_lines:
            raise RuntimeError(
                f"{self.table}: {self.physical_lines} lines read but {accounted} accounted for; refusing to continue"
            )


def decode(raw: bytes, stats: TableStats) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        stats.non_utf8_lines += 1
        # The export mixes encodings; Windows-1252 is the common case, latin-1 never fails.
        try:
            return raw.decode("cp1252")
        except UnicodeDecodeError:
            return raw.decode("latin-1")


def iter_rows(fh: io.BufferedIOBase, ncols: int, stats: TableStats, rejects: list[tuple[str, int, str, str]]):
    """Yield lists of exactly `ncols` fields. Joins lines broken by embedded newlines; rejects the rest."""
    pending: list[str] | None = None  # fields of the row being assembled
    pending_lines: list[str] = []
    pending_start = 0

    def reject(reason: str) -> None:
        stats.rows_rejected += 1
        stats.lines_rejected += len(pending_lines)
        stats.reasons[reason] = stats.reasons.get(reason, 0) + 1
        rejects.append((stats.table, pending_start, reason, "\n".join(pending_lines)[:10_000]))

    line_no = 1  # header is line 1
    for raw in fh:
        line_no += 1
        stats.physical_lines += 1
        text = decode(raw, stats).rstrip("\r\n").replace("\x00", "")
        fields = text.split("\t")
        if pending is not None and len(fields) == ncols:
            # This line is a complete row by itself, so the pending fragment cannot be repaired.
            reject("too_few_fields")
            pending = None
        if pending is not None:
            # Continue a broken row: the first field of this line continues the last field of the row.
            pending[-1] = pending[-1] + " " + fields[0]
            pending.extend(fields[1:])
            pending_lines.append(text)
        else:
            pending, pending_lines, pending_start = fields, [text], line_no

        n = len(pending)
        if n == ncols:
            if len(pending_lines) > 1:
                stats.rows_repaired += 1
                stats.lines_joined += len(pending_lines)
            stats.rows_loaded += 1
            yield pending
            pending, pending_lines = None, []
        elif n > ncols:
            # One extra trailing empty field is a known export quirk; trim it, anything else is a reject.
            if all(f == "" for f in pending[ncols:]):
                if len(pending_lines) > 1:
                    stats.rows_repaired += 1
                    stats.lines_joined += len(pending_lines)
                stats.rows_loaded += 1
                yield pending[:ncols]
            else:
                reject("too_many_fields" if len(pending_lines) == 1 else "too_many_fields_after_join")
            pending, pending_lines = None, []
        elif len(pending_lines) >= MAX_JOIN_LINES:
            reject("too_few_fields")
            pending, pending_lines = None, []
    if pending is not None:
        reject("too_few_fields_at_eof")


def iter_rows_free_text_last(
    fh: io.BufferedIOBase, ncols: int, stats: TableStats, rejects: list[tuple[str, int, str, str]]
):
    """For tables whose last column is free text (TEXT_MEMO_CD): tabs and line breaks inside that text split
    the record. A line with at least `ncols` fields starts a record (extra fields are rejoined into the text);
    a shorter line continues the text of the record before it."""
    held: list[str] | None = None
    held_lines = 0
    held_merged = False

    def emit() -> list[str]:
        stats.rows_loaded += 1
        if held_lines > 1 or held_merged:
            stats.rows_repaired += 1
            stats.lines_joined += held_lines
        return held  # type: ignore[return-value]

    line_no = 1
    for raw in fh:
        line_no += 1
        stats.physical_lines += 1
        text = decode(raw, stats).rstrip("\r\n").replace("\x00", "")
        fields = text.split("\t")
        if len(fields) >= ncols:
            if held is not None:
                yield emit()
            held_merged = len(fields) > ncols
            held = fields[: ncols - 1] + ["\t".join(fields[ncols - 1 :])]
            held_lines = 1
        elif held is not None:
            held[-1] = held[-1] + "\n" + text
            held_lines += 1
        else:
            stats.rows_rejected += 1
            stats.lines_rejected += 1
            stats.reasons["fragment_before_first_row"] = stats.reasons.get("fragment_before_first_row", 0) + 1
            rejects.append((stats.table, line_no, "fragment_before_first_row", text[:10_000]))
    if held is not None:
        yield emit()


FREE_TEXT_LAST = {"TEXT_MEMO_CD"}


def stage_table(con: duckdb.DuckDBPyConnection, zf: zipfile.ZipFile, table: str) -> TableStats:
    stats = TableStats(table)
    rejects: list[tuple[str, int, str, str]] = []
    with zf.open(f"CalAccess/DATA/{table}.TSV") as member:
        fh = io.BufferedReader(member, buffer_size=1 << 22)
        header = fh.readline().decode("utf-8-sig").rstrip("\r\n").split("\t")
        cols = [c.strip().lower() for c in header]
        stats.columns = len(cols)
        con.execute(f'DROP TABLE IF EXISTS "{table.lower()}"')
        col_sql = ", ".join(f'"{c}" VARCHAR' for c in cols)
        con.execute(f'CREATE TABLE "{table.lower()}" (_line BIGINT, {col_sql})')
        schema = {"_line": pl.Int64, **{c: pl.Utf8 for c in cols}}

        buf: list[list[str]] = []
        seq = 0

        def flush() -> None:
            nonlocal seq
            if not buf:
                return
            columns = list(zip(*buf, strict=True))
            data = {"_line": list(range(seq, seq + len(buf)))}
            data.update({c: columns[i] for i, c in enumerate(cols)})
            seq += len(buf)
            df = pl.DataFrame(data, schema=schema).with_columns(
                [pl.when(pl.col(c).str.strip_chars() == "").then(None).otherwise(pl.col(c)).alias(c) for c in cols]
            )
            con.register("_chunk", ArrowStream(df))
            con.execute(f'INSERT INTO "{table.lower()}" SELECT * FROM _chunk')
            con.unregister("_chunk")
            buf.clear()

        rows = iter_rows_free_text_last if table in FREE_TEXT_LAST else iter_rows
        for row in rows(fh, len(cols), stats, rejects):
            buf.append(row)
            if len(buf) >= CHUNK_ROWS:
                flush()
        flush()

    if rejects:
        con.executemany("INSERT INTO _rejects VALUES (?, ?, ?, ?)", rejects)
    stats.check()
    return stats


def stage(zip_path: Path, sha256: str, db_path: Path, tables: list[str] | None = None) -> duckdb.DuckDBPyConnection:
    """Stage all tables unless this zip (by SHA-256) is already fully staged in db_path."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS _load_log (
            zip_sha256 VARCHAR, table_name VARCHAR, columns INTEGER, physical_lines BIGINT,
            rows_loaded BIGINT, rows_repaired BIGINT, lines_joined BIGINT, rows_rejected BIGINT,
            lines_rejected BIGINT, non_utf8_lines BIGINT, reasons VARCHAR, seconds DOUBLE,
            loaded_at TIMESTAMP DEFAULT current_timestamp
        )
        """
    )
    con.execute("CREATE TABLE IF NOT EXISTS _rejects (table_name VARCHAR, line_no BIGINT, reason VARCHAR, raw VARCHAR)")
    wanted = tables or TABLES
    done = {
        r[0]
        for r in con.execute("SELECT table_name FROM _load_log WHERE zip_sha256 = ?", [sha256]).fetchall()
    }
    todo = [t for t in wanted if t not in done]
    if not todo:
        print(f"[stage] all {len(wanted)} tables already staged from {sha256[:12]}")
        return con
    with zipfile.ZipFile(zip_path) as zf:
        for table in todo:
            t0 = time.time()
            con.execute("DELETE FROM _rejects WHERE table_name = ?", [table])
            con.execute("DELETE FROM _load_log WHERE table_name = ?", [table])
            s = stage_table(con, zf, table)
            secs = time.time() - t0
            con.execute(
                "INSERT INTO _load_log (zip_sha256, table_name, columns, physical_lines, rows_loaded, rows_repaired,"
                " lines_joined, rows_rejected, lines_rejected, non_utf8_lines, reasons, seconds)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    sha256, table, s.columns, s.physical_lines, s.rows_loaded, s.rows_repaired, s.lines_joined,
                    s.rows_rejected, s.lines_rejected, s.non_utf8_lines, str(s.reasons), secs,
                ],
            )
            print(
                f"[stage] {table}: {s.rows_loaded:,} rows loaded ({s.rows_repaired:,} repaired), "
                f"{s.rows_rejected:,} rejected {s.reasons or ''}, {s.non_utf8_lines:,} non-UTF-8 lines, {secs:.0f}s",
                flush=True,
            )
    return con
