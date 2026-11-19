"""San Francisco: DataSF campaign finance datasets (SF Ethics Commission).

- Transactions  pitq-e56w  https://data.sf.gov/d/pitq-e56w
- Summary Totals 9ggq-m8hp https://data.sf.gov/d/9ggq-m8hp
- Filings       qizs-bwft  https://data.sf.gov/d/qizs-bwft (for the filing's PDF link)

DataSF publishes the CAL fields under its own names; this module only renames them.
The transactions dataset has no street-address columns.
"""

from __future__ import annotations

import polars as pl

from . import cal_format, socrata
from .pipeline import RawCache

SLUG = "sf"
NAME = "San Francisco"
SOURCE = "datasf:sfo"
DOMAIN = "data.sf.gov"
PORTAL = "https://data.sf.gov/d/pitq-e56w"
TRANSACTIONS = "pitq-e56w"
SUMMARY = "9ggq-m8hp"
FILINGS = "qizs-bwft"
CHECK_DESCRIPTION = (
    "Per Form 460 filing, the sum of itemized non-memo Schedule A and Schedule E rows in Transactions "
    f"({TRANSACTIONS}) against line 1 of Schedule A and Schedule E in SF Ethics' Summary Totals ({SUMMARY})."
)

TRANSACTION_COLUMNS = [
    "filing_id_number", "filing_version", "filing_date", "start_date", "end_date", "fppc_id", "filer_nid",
    "filer_name", "form_type", "transaction_id", "entity_code", "transaction_last_name", "transaction_first_name",
    "transaction_name_title", "transaction_name_suffix", "transaction_city", "transaction_state", "transaction_zip",
    "transaction_employer", "transaction_occupation", "transaction_date", "transaction_amount_1", "loan_amount_1",
    "transaction_code", "support_oppose_code", "committee_id", "memo_code", "candidate_last_name",
    "candidate_first_name", "ballot_name", "ballot_number",
]  # fmt: skip

RENAME = {
    "filing_id_number": "filing_id",
    "filing_version": "amendment_no",
    "filing_date": "filed_at",
    "start_date": "period_start",
    "end_date": "period_end",
    "filer_name": "filer_name",
    "form_type": "schedule",
    "transaction_id": "tran_id",
    "entity_code": "entity_cd",
    "transaction_last_name": "last_name",
    "transaction_first_name": "first_name",
    "transaction_name_title": "name_title",
    "transaction_name_suffix": "name_suffix",
    "transaction_city": "city",
    "transaction_state": "state",
    "transaction_zip": "zip",
    "transaction_employer": "employer",
    "transaction_occupation": "occupation",
    "transaction_date": "tran_date",
    "transaction_code": "expn_code",
    "support_oppose_code": "sup_opp_cd",
    "committee_id": "cmte_id",
    "memo_code": "memo",
    "candidate_last_name": "cand_last_name",
    "candidate_first_name": "cand_first_name",
    "ballot_name": "ballot_name",
    "ballot_number": "ballot_number",
}


def _where_schedules() -> str:
    scheds = ",".join(f"'{s}'" for s in cal_format.LOADED_SCHEDULES)
    return f"form_type in ({scheds}) AND cal_transaction_type like 'F460%'"


def raw_transactions(cache: RawCache) -> pl.DataFrame:
    return cache.get(
        "transactions",
        f"https://{DOMAIN}/resource/{TRANSACTIONS}.csv",
        lambda: socrata.fetch(DOMAIN, TRANSACTIONS, TRANSACTION_COLUMNS, _where_schedules()),
    )


def adapt(raw: pl.DataFrame, filings: pl.DataFrame | None = None) -> pl.DataFrame:
    """DataSF transaction rows (strings) -> normalized CAL frame."""
    loan = pl.col("form_type").is_in(["B1", "H"])
    df = raw.with_columns(
        amount=pl.when(loan).then(pl.col("loan_amount_1")).otherwise(pl.col("transaction_amount_1")),
        # Local-only filers have no FPPC id; fall back to the SF filer id (keyed by name downstream).
        filer_id=pl.coalesce(pl.col("fppc_id"), pl.concat_str([pl.lit("sfo-nid-"), pl.col("filer_nid")])),
        form=pl.lit("F460"),
    ).rename({k: v for k, v in RENAME.items() if k != v})
    if filings is not None:
        df = df.join(
            filings.select(pl.col("filing_id_number").alias("filing_id"), pl.col("rendering_url").alias("filing_url"))
            .unique("filing_id"),
            on="filing_id",
            how="left",
        )
    return cal_format.normalize(df)


def cal(cache: RawCache) -> pl.DataFrame:
    filings = cache.get(
        "filings",
        f"https://{DOMAIN}/resource/{FILINGS}.csv",
        lambda: socrata.fetch(DOMAIN, FILINGS, ["filing_id_number", "rendering_url"], "form_type='FPPC460'"),
    )
    return adapt(raw_transactions(cache), filings)


def portal_totals(cache: RawCache) -> pl.DataFrame:
    s = cache.get(
        "summary_totals",
        f"https://{DOMAIN}/resource/{SUMMARY}.csv",
        lambda: socrata.fetch(
            DOMAIN, SUMMARY, ["filing_id_number", "schedulea_line_1", "schedulee_line_1"], "form_type='FPPC460'"
        ),
    )
    return pl.concat(
        [
            s.select(
                pl.col("filing_id_number").alias("filing_id"),
                pl.lit(sched).alias("schedule"),
                pl.col(col).cast(pl.Float64, strict=False).fill_null(0).alias("portal_total"),
            )
            for sched, col in (("A", "schedulea_line_1"), ("E", "schedulee_line_1"))
        ]
    )
