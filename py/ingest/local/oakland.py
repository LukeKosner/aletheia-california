"""Oakland: Form 460 schedules the City publishes on data.oaklandca.gov from its NetFile filings.

The NetFile public portal (agency COAK) is behind a bot challenge, so we use the
City's open data copies, which keep NetFile's CAL column names. One dataset per
schedule, plus the Form 460 summary totals.

The datasets carry address columns (tran_adr1, payee_adr1, ...). They are redacted,
and this module never requests them.
"""

from __future__ import annotations

import polars as pl

from . import cal_format, socrata
from .pipeline import RawCache

SLUG = "oakland"
NAME = "Oakland"
SOURCE = "oaklandca:coak"
DOMAIN = "data.oaklandca.gov"
PORTAL = "https://data.oaklandca.gov/browse?q=campaign%20finance"
SUMMARY = "rsxe-vvuw"
CHECK_DESCRIPTION = (
    "Per Form 460 filing, the sum of itemized non-memo rows in the Schedule A (3xq4-ermg) and Schedule E (bvfu-nq99) "
    f"datasets against line 1 of Schedule A and Schedule E in the City's Form 460 Summary Totals ({SUMMARY})."
)

DATASETS = {
    "A": "3xq4-ermg",
    "B1": "qaa7-q29f",
    "C": "ba44-jqtm",
    "D": "x5eg-xkea",
    "E": "bvfu-nq99",
    "H": "qunm-zyau",
}

COVER = ["filer_id", "filer_naml", "report_num", "rpt_date", "from_date", "thru_date", "form_type", "tran_id", "entity_cd"]

# Column families. Values: CAL name <- Oakland column.
RECEIPT = {
    "last_name": "tran_naml", "first_name": "tran_namf", "name_title": "tran_namt", "name_suffix": "tran_nams",
    "city": "tran_city", "state": "tran_state", "zip": "tran_zip4", "employer": "tran_emp", "occupation": "tran_occ",
    "tran_date": "tran_date", "amount": "tran_amt1", "cmte_id": "cmte_id", "memo": "memo_code",
}  # fmt: skip
LOAN = {
    "last_name": "lndr_naml", "first_name": "lndr_namf", "name_title": "lndr_namt", "name_suffix": "lndr_nams",
    "city": "loan_city", "state": "loan_st", "zip": "loan_zip4", "employer": "loan_emp", "occupation": "loan_occ",
    "tran_date": "loan_date1", "amount": "loan_amt1", "cmte_id": "cmte_id", "memo": "memo_code",
}  # fmt: skip
EXPENSE = {
    "last_name": "payee_naml", "first_name": "payee_namf", "name_title": "payee_namt", "name_suffix": "payee_nams",
    "city": "payee_city", "state": "payee_state", "zip": "payee_zip4", "tran_date": "expn_date", "amount": "amount",
    "cmte_id": "cmte_id", "memo": "memo_code", "expn_code": "expn_code", "sup_opp_cd": "sup_opp_cd",
    "cand_last_name": "cand_naml", "cand_first_name": "cand_namf", "ballot_name": "bal_name", "ballot_number": "bal_num",
}  # fmt: skip
FAMILY = {"A": RECEIPT, "C": RECEIPT, "B1": LOAN, "H": LOAN, "D": EXPENSE, "E": EXPENSE}


def columns(schedule: str) -> list[str]:
    return COVER + list(dict.fromkeys(FAMILY[schedule].values()))


def filing_id() -> pl.Expr:
    """Oakland's exports have no filing number: identify a filing by filer, period, filed date and amendment."""
    d = lambda c: pl.col(c).str.slice(0, 10).fill_null("")  # noqa: E731
    return pl.concat_str(
        [pl.col("filer_id").fill_null(""), d("from_date"), d("thru_date"), d("rpt_date"), pl.col("report_num").fill_null("0")],
        separator=":",
    ).alias("filing_id")


def adapt(raw: pl.DataFrame, schedule: str) -> pl.DataFrame:
    fam = FAMILY[schedule]
    # The open data copy repeats some transactions verbatim (same filing, same tran_id, every
    # column equal). A tran_id is unique within a filing, so keep one copy.
    raw = raw.unique(maintain_order=True)
    df = raw.select(
        filing_id(),
        pl.col("report_num").alias("amendment_no"),
        pl.lit("F460").alias("form"),
        pl.col("rpt_date").alias("filed_at"),
        pl.col("from_date").alias("period_start"),
        pl.col("thru_date").alias("period_end"),
        "filer_id",
        pl.col("filer_naml").alias("filer_name"),
        pl.col("form_type").alias("schedule"),
        "tran_id",
        "entity_cd",
        *[pl.col(src).alias(dst) for dst, src in fam.items()],
    )
    return cal_format.normalize(df)


def cal(cache: RawCache) -> pl.DataFrame:
    frames = []
    for sched, ds in DATASETS.items():
        raw = cache.get(
            f"schedule_{sched.lower()}",
            f"https://{DOMAIN}/resource/{ds}.csv",
            lambda ds=ds, sched=sched: socrata.fetch(DOMAIN, ds, columns(sched)),
        )
        frames.append(adapt(raw, sched))
    return pl.concat(frames)


def portal_totals(cache: RawCache) -> pl.DataFrame:
    s = cache.get(
        "summary_totals",
        f"https://{DOMAIN}/resource/{SUMMARY}.csv",
        lambda: socrata.fetch(
            DOMAIN,
            SUMMARY,
            ["filer_id", "report_num", "rpt_date", "from_date", "thru_date", "form_type", "line_item", "amount_a"],
            "form_type in ('A','E') AND line_item='1'",
        ),
    )
    # The summary dataset repeats some rows verbatim; keep one copy of each.
    return s.unique().select(
        filing_id(),
        pl.col("form_type").alias("schedule"),
        pl.col("amount_a").cast(pl.Float64, strict=False).fill_null(0).alias("portal_total"),
    )
