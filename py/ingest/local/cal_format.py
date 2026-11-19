"""One parser for the shared state campaign form schedules (Form 460 and friends).

Every local portal publishes the same FPPC schedules, in the Cal-Access "CAL"
electronic format or something close to it, under different column names. Each
jurisdiction adapter renames its columns to the canonical CAL record below
(`CAL_SCHEMA`), then hands the frame to `normalize()` and `to_tables()`, which
turn it into rows shaped like the `filing`, `entity`, `entity_alias` and
`money_edge` tables in `packages/db/src/schema.ts`.

Schedules loaded as money edges (Form 460):

    A   monetary contributions received   contributor -> filer   contribution
    C   non-monetary contributions        contributor -> filer   contribution
    B1  loans received                    lender      -> filer   loan
    D   contributions / IEs made          filer       -> payee   contribution, ie_support, ie_oppose
    E   payments made                     filer       -> payee   expenditure, contribution (code CTB), ie_* (code IND)
    H   loans made to others              filer       -> borrower loan

Not loaded as edges: F (unpaid bills, paid later on E), G (agent sub-payments,
already inside an E total), I (misc. increases to cash, not contributions),
B2 (guarantors), memo-coded rows (detail of another row) and unitemized lines.
Late reports (497, 496) and 461/465 repeat amounts later itemized on a 460, so
they are skipped to avoid double counting.

Street addresses are redacted by law. The canonical record has no address
column, so nothing downstream can carry or restore one.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

import polars as pl

MONEY = pl.Decimal(14, 2)

# uuid5 namespace for deterministic ids: re-running a load yields the same ids.
NAMESPACE = uuid.UUID("5d0b8f0e-6f8e-4d6b-9a52-6c6f63616c31")

LOADED_SCHEDULES = ("A", "B1", "C", "D", "E", "H")
INBOUND_SCHEDULES = ("A", "B1", "C")

CAL_SCHEMA: dict[str, pl.DataType] = {
    # filing (cover page)
    "filing_id": pl.String(),
    "amendment_no": pl.Int32(),
    "form": pl.String(),
    "filed_at": pl.Date(),
    "period_start": pl.Date(),
    "period_end": pl.Date(),
    "filing_url": pl.String(),
    "filer_id": pl.String(),  # FPPC id when the portal has one
    "filer_name": pl.String(),
    # transaction
    "schedule": pl.String(),
    "tran_id": pl.String(),
    "entity_cd": pl.String(),  # IND, COM, SCC, PTY, OTH
    "last_name": pl.String(),  # org name for non-individuals
    "first_name": pl.String(),
    "name_title": pl.String(),
    "name_suffix": pl.String(),
    "city": pl.String(),
    "state": pl.String(),
    "zip": pl.String(),
    "employer": pl.String(),
    "occupation": pl.String(),
    "tran_date": pl.Date(),
    "amount": MONEY,
    "memo": pl.Boolean(),
    "cmte_id": pl.String(),  # counterparty FPPC id
    "expn_code": pl.String(),
    "sup_opp_cd": pl.String(),
    "cand_last_name": pl.String(),
    "cand_first_name": pl.String(),
    "ballot_name": pl.String(),
    "ballot_number": pl.String(),
    "description": pl.String(),
}

_ADDRESS_COLUMN = re.compile(r"adr|addr|street", re.IGNORECASE)
_DATE_COLUMNS = [c for c, t in CAL_SCHEMA.items() if t == pl.Date()]
_STRING_COLUMNS = [c for c, t in CAL_SCHEMA.items() if t == pl.String()]


def assert_no_address_columns(columns: list[str]) -> None:
    """Fail loudly if a frame carries a street-address column."""
    bad = [c for c in columns if _ADDRESS_COLUMN.search(c)]
    if bad:
        raise ValueError(f"street address columns are not allowed: {bad}")


def normalize(df: pl.DataFrame) -> pl.DataFrame:
    """Cast an adapter frame (string columns named as in CAL_SCHEMA) to the canonical record.

    Columns not in CAL_SCHEMA are dropped; missing ones become null.
    """
    exprs: list[pl.Expr] = []
    for name, dtype in CAL_SCHEMA.items():
        if name not in df.columns:
            default = {"memo": False, "amendment_no": 0}.get(name)
            exprs.append(pl.lit(default, dtype=dtype).alias(name))
            continue
        raw = pl.col(name).cast(pl.String).str.strip_chars()
        raw = pl.when(raw == "").then(None).otherwise(raw)
        if name in _DATE_COLUMNS:
            e = raw.str.slice(0, 10).str.to_date("%Y-%m-%d", strict=False)
        elif name == "amount":
            e = raw.str.replace_all(r"[$,]", "").cast(MONEY, strict=False)
        elif name == "amendment_no":
            e = raw.cast(pl.Int32, strict=False).fill_null(0)
        elif name == "memo":
            e = raw.str.to_lowercase().is_in(["x", "true", "t", "y", "yes", "1"]).fill_null(False)
        elif name == "zip":
            e = raw.str.extract(r"^(\d{5})", 1)
        elif name in ("entity_cd", "schedule", "expn_code", "sup_opp_cd", "state"):
            e = raw.str.to_uppercase()
        else:
            e = raw
        exprs.append(e.cast(dtype).alias(name))
    out = df.select(exprs)
    assert_no_address_columns(out.columns)
    return out


def _slug(e: pl.Expr) -> pl.Expr:
    return e.str.to_lowercase().str.replace_all(r"[^a-z0-9]+", " ").str.strip_chars()


def _uuid5(kind: str) -> callable:
    def f(s: str) -> str:
        return str(uuid.uuid5(NAMESPACE, f"{kind}|{s}"))

    return f


def _uuid_col(col: str, kind: str, alias: str) -> pl.Expr:
    return pl.col(col).map_elements(_uuid5(kind), return_dtype=pl.String).alias(alias)


def _is_fppc_id(e: pl.Expr) -> pl.Expr:
    # FPPC ids are 6+ digits; shorter numbers are local ids (LA used 4-digit ids before FPPC numbers).
    return e.fill_null("").str.contains(r"^\d{6,}$")


@dataclass
class Tables:
    """Rows shaped like the db tables, plus join keys the loader resolves to ids."""

    filing: pl.DataFrame
    entity: pl.DataFrame
    entity_alias: pl.DataFrame
    money_edge: pl.DataFrame
    skipped: dict[str, int] = field(default_factory=dict)


def filing_key(source: str) -> pl.Expr:
    return pl.concat_str(
        [pl.lit(source), pl.col("filing_id"), pl.col("amendment_no").cast(pl.String)], separator="|"
    )


def counterparty_frame(cal: pl.DataFrame, source: str) -> pl.DataFrame:
    """Add counterparty name, kind and canonical key to each transaction row."""
    first = pl.col("first_name")
    last = pl.col("last_name")
    person_name = pl.concat_str([first, last, pl.col("name_suffix")], separator=" ", ignore_nulls=True)
    org_name = pl.when(first.is_null()).then(last).otherwise(pl.concat_str([first, last], separator=" ", ignore_nulls=True))
    is_cmte = _is_fppc_id(pl.col("cmte_id"))
    kind = (
        pl.when(is_cmte)
        .then(pl.lit("committee"))
        .when(pl.col("entity_cd") == "IND")
        .then(pl.lit("person"))
        .when(pl.col("entity_cd").is_in(["COM", "SCC", "PTY"]))
        .then(pl.lit("committee"))
        .otherwise(pl.lit("org"))
    )
    df = cal.with_columns(
        cp_name=pl.when(pl.col("entity_cd") == "IND").then(person_name).otherwise(org_name).str.strip_chars(),
        cp_kind=kind,
    )
    slug = _slug(pl.col("cp_name"))
    key = (
        pl.when(is_cmte)
        .then(pl.concat_str([pl.lit("calaccess:filer:"), pl.col("cmte_id")]))
        .when(pl.col("cp_kind") == "person")
        .then(pl.concat_str([pl.lit("person:" + source + ":"), slug, pl.lit("|"), pl.col("zip").fill_null("")]))
        .otherwise(pl.concat_str([pl.col("cp_kind"), pl.lit(":" + source + ":"), slug]))
    )
    return df.with_columns(cp_key=key)


def filer_key(source: str) -> pl.Expr:
    return (
        pl.when(_is_fppc_id(pl.col("filer_id")))
        .then(pl.concat_str([pl.lit("calaccess:filer:"), pl.col("filer_id")]))
        .otherwise(pl.concat_str([pl.lit("committee:" + source + ":"), _slug(pl.col("filer_name"))]))
    )


def edge_kind() -> pl.Expr:
    sched = pl.col("schedule")
    ie = sched.is_in(["D", "E"]) & (pl.col("expn_code") == "IND")
    return (
        pl.when(sched.is_in(["A", "C"]))
        .then(pl.lit("contribution"))
        .when(sched.is_in(["B1", "H"]))
        .then(pl.lit("loan"))
        .when(ie & (pl.col("sup_opp_cd") == "S"))
        .then(pl.lit("ie_support"))
        .when(ie & (pl.col("sup_opp_cd") == "O"))
        .then(pl.lit("ie_oppose"))
        .when(sched == "D")
        .then(pl.lit("contribution"))
        .when((sched == "E") & (pl.col("expn_code") == "CTB"))
        .then(pl.lit("contribution"))
        .when(sched == "E")
        .then(pl.lit("expenditure"))
        .otherwise(pl.lit(None, dtype=pl.String))
    )


def to_tables(cal: pl.DataFrame, source: str) -> Tables:
    """Turn a normalized CAL frame into filing / entity / entity_alias / money_edge rows."""
    assert_no_address_columns(cal.columns)
    cal = cal.with_columns(filing_key=filing_key(source), filer_key=filer_key(source))

    # ---- filings: one row per (filing_id, amendment_no)
    filing = (
        cal.sort("filed_at", descending=True, nulls_last=True)
        .group_by("filing_key", maintain_order=True)
        .agg(
            pl.col("filing_id").first(),
            pl.col("amendment_no").first(),
            pl.col("form").drop_nulls().first(),
            pl.col("filed_at").drop_nulls().first(),
            pl.col("period_start").drop_nulls().first(),
            pl.col("period_end").drop_nulls().first(),
            pl.col("filing_url").drop_nulls().first().alias("url"),
            pl.col("filer_key").first(),
        )
        .with_columns(pl.lit(source).alias("source"), _uuid_col("filing_key", "filing", "id"))
        .sort("filing_key")
    )

    # ---- which rows become edges
    cal = counterparty_frame(cal, source).with_columns(kind=edge_kind())
    reasons = (
        pl.when(pl.col("filer_key").is_null())
        .then(pl.lit("no_filer"))
        .when(~pl.col("schedule").is_in(list(LOADED_SCHEDULES)))
        .then(pl.lit("schedule_not_loaded"))
        .when(pl.col("memo"))
        .then(pl.lit("memo_row"))
        .when(pl.col("amount").is_null())
        .then(pl.lit("no_amount"))
        .when(pl.col("amount") == 0)
        .then(pl.lit("zero_amount"))
        .when(pl.col("cp_name").is_null() | (_slug(pl.col("cp_name")) == ""))
        .then(pl.lit("no_counterparty_name"))
        .otherwise(pl.lit(None, dtype=pl.String))
    )
    cal = cal.with_columns(skip=reasons)
    skipped = {r: n for r, n in cal.group_by("skip").len().iter_rows() if r is not None}
    rows = cal.filter(pl.col("skip").is_null())

    # ---- entities: filers + counterparties
    filers = (
        cal.drop_nulls("filer_key")
        .sort("filed_at", descending=True, nulls_last=True)
        .group_by("filer_key", maintain_order=True)
        .agg(pl.col("filer_name").drop_nulls().first().alias("name"), pl.col("filer_id").first())
        .select(
            pl.col("filer_key").alias("canonical_key"),
            pl.lit("committee").alias("kind"),
            pl.col("name").fill_null(pl.col("filer_id")),
            pl.struct(
                fppc_id=pl.when(_is_fppc_id(pl.col("filer_id"))).then(pl.col("filer_id")),
                local_id=pl.when(~_is_fppc_id(pl.col("filer_id"))).then(pl.col("filer_id")),
            )
            .struct.json_encode()
            .alias("attrs"),
            pl.col("name").alias("raw_name"),
            pl.lit(None, dtype=pl.String).alias("source_row_id"),
        )
    )
    cps = (
        rows.sort("tran_date", descending=True, nulls_last=True)
        .group_by("cp_key", maintain_order=True)
        .agg(
            pl.col("cp_kind").first().alias("kind"),
            pl.col("cp_name").first().alias("name"),
            pl.col("cmte_id").first(),
            pl.col("city").drop_nulls().first(),
            pl.col("state").drop_nulls().first(),
            pl.col("zip").drop_nulls().first(),
            pl.col("employer").drop_nulls().first(),
            pl.col("occupation").drop_nulls().first(),
            pl.col("tran_id").first().alias("source_row_id"),
        )
        .select(
            pl.col("cp_key").alias("canonical_key"),
            "kind",
            "name",
            pl.struct(
                fppc_id=pl.when(_is_fppc_id(pl.col("cmte_id"))).then(pl.col("cmte_id")),
                city=pl.col("city"),
                state=pl.col("state"),
                zip=pl.col("zip"),
                employer=pl.col("employer"),
                occupation=pl.col("occupation"),
            )
            .struct.json_encode()
            .alias("attrs"),
            pl.col("name").alias("raw_name"),
            "source_row_id",
        )
    )
    both = pl.concat([filers, cps]).unique("canonical_key", keep="first", maintain_order=True)
    entity = both.select(
        _uuid_col("canonical_key", "entity", "id"), "kind", "name", "canonical_key", "attrs"
    ).sort("canonical_key")

    # every distinct raw spelling becomes an alias
    raw_cp = rows.select(
        pl.col("cp_key").alias("canonical_key"), pl.col("cp_name").alias("raw_name"), pl.col("tran_id").alias("source_row_id")
    )
    raw_filer = cal.drop_nulls("filer_key").select(
        pl.col("filer_key").alias("canonical_key"), pl.col("filer_name").alias("raw_name"), pl.lit(None, dtype=pl.String).alias("source_row_id")
    )
    entity_alias = (
        pl.concat([raw_filer, raw_cp])
        .drop_nulls("raw_name")
        .unique(["canonical_key", "raw_name"], keep="first", maintain_order=True)
        .with_columns(
            pl.lit(source).alias("source"),
            pl.lit(1.0, dtype=pl.Float32).alias("match_score"),
            pl.lit("exact_key").alias("method"),
            pl.concat_str([pl.col("canonical_key"), pl.lit(source), pl.col("raw_name")], separator="|").alias("_k"),
        )
        .with_columns(_uuid_col("_k", "alias", "id"), _uuid_col("canonical_key", "entity", "entity_id"))
        .drop("_k")
        .sort("canonical_key", "raw_name")
    )

    # ---- money edges
    inbound = pl.col("schedule").is_in(list(INBOUND_SCHEDULES))
    natural = [
        "filing_key",
        "schedule",
        pl.col("tran_id").fill_null(""),
        "cp_key",
        pl.col("tran_date").cast(pl.String).fill_null(""),
        pl.col("amount").cast(pl.String),
    ]
    money_edge = (
        rows.with_columns(
            from_key=pl.when(inbound).then(pl.col("cp_key")).otherwise(pl.col("filer_key")),
            to_key=pl.when(inbound).then(pl.col("filer_key")).otherwise(pl.col("cp_key")),
            _occ=pl.int_range(pl.len()).over(natural),
        )
        .with_columns(
            pl.concat_str([*natural, pl.col("_occ").cast(pl.String)], separator="|").alias("_k"),
        )
        .with_columns(
            _uuid_col("_k", "edge", "id"),
            _uuid_col("from_key", "entity", "from_entity"),
            _uuid_col("to_key", "entity", "to_entity"),
            _uuid_col("filing_key", "filing", "filing_id"),
        )
        .select(
            "id",
            "from_entity",
            "to_entity",
            "amount",
            pl.col("tran_date").alias("date"),
            "kind",
            "filing_id",
            "schedule",
            pl.col("tran_id").alias("line_item"),
            "from_key",
            "to_key",
            "filing_key",
        )
    )
    return Tables(filing=filing, entity=entity, entity_alias=entity_alias, money_edge=money_edge, skipped=skipped)


def itemized_totals(cal: pl.DataFrame, schedules: tuple[str, ...] = ("A", "E")) -> pl.DataFrame:
    """Sum of itemized, non-memo amounts per filing and schedule (what summary line 1 reports)."""
    return (
        cal.filter(pl.col("schedule").is_in(list(schedules)) & ~pl.col("memo") & pl.col("amount").is_not_null())
        .group_by("filing_id", "amendment_no", "schedule")
        .agg(pl.col("amount").sum().alias("total"), pl.len().alias("n"))
        .sort("filing_id", "amendment_no", "schedule")
    )
