"""Los Angeles (city): City Ethics Commission campaign data on data.lacity.org.

- City Campaign Contributions (and Misc Increases to Cash)  m6g2-gc6c
- City Campaign Expenditures                                5mrt-4zhe
- City Campaign Statements Filed                            br3a-db9a (statement links)

LA's exports are flattened Form 460 schedules, not CAL records: there is no
transaction id, no entity code and no filing number, and unitemized totals are
mixed in as rows. This module maps them onto the CAL record so the shared parser
does the rest. The free-text `memo` column is never requested (it sometimes holds
street addresses); only city, state and ZIP are.
"""

from __future__ import annotations

import polars as pl

from . import cal_format, socrata
from .pipeline import RawCache

SLUG = "la"
NAME = "Los Angeles (city)"
SOURCE = "lacity:lac"
DOMAIN = "data.lacity.org"
PORTAL = "https://data.lacity.org/browse?q=campaign"
CONTRIBUTIONS = "m6g2-gc6c"
EXPENDITURES = "5mrt-4zhe"
STATEMENTS = "br3a-db9a"
CHECK_DESCRIPTION = (
    "LA publishes no filed summary totals, so this check compares our loaded itemized Schedule A and Schedule E sums "
    f"per committee and statement period against the same sums computed server-side by data.lacity.org "
    f"(SoQL sum/group by on {CONTRIBUTIONS} and {EXPENDITURES}). It proves the load is complete and amounts parse "
    "exactly; it does not cross-check the filer's own summary page."
)

CONTRIBUTION_COLUMNS = [
    "cmt_id", "cmt_nm", "form", "schedule", "con_type", "per_beg_date", "per_end_date", "con_date", "con_name",
    "con_city_nm", "con_state_nm", "con_zip_cd", "con_occp", "con_empr", "con_amount",
]  # fmt: skip
EXPENDITURE_COLUMNS = [
    "cmt_id", "cmt_name", "form", "exp_type", "per_beg_date", "per_end_date", "exp_date", "payee_name",
    "payee_fname", "payee_lname", "payee_cmt_id", "payee_addr_cty", "payee_addr_st", "payee_addr_zip", "exp_amount",
]  # fmt: skip
STATEMENT_COLUMNS = ["cmt_id", "period_from_date", "period_to_date", "stmt_link"]

ITEMIZED_A = "schedule='A' AND con_type like '%(Itemized)%'"
SCHEDULE_E = "exp_type='Payment Made [Form 460, Schedule E]'"


def filing_id(cmt: str = "cmt_id", beg: str = "per_beg_date", end: str = "per_end_date") -> pl.Expr:
    """LA rows carry no statement number: identify a statement by committee and period."""
    d = lambda c: pl.col(c).str.slice(0, 10).fill_null("")  # noqa: E731
    return pl.concat_str([pl.col(cmt).fill_null(""), d(beg), d(end)], separator=":").alias("filing_id")


def statement_links(statements: pl.DataFrame) -> pl.DataFrame:
    """Statement PDF link per filing_id, only where exactly one statement matches."""
    s = statements.select(filing_id("cmt_id", "period_from_date", "period_to_date"), pl.col("stmt_link").alias("filing_url"))
    return s.filter(pl.len().over("filing_id") == 1)


def adapt_contributions(raw: pl.DataFrame) -> pl.DataFrame:
    unitemized = pl.col("con_type").str.to_lowercase().str.contains("unitemized|untemized")
    sched = pl.when(pl.col("schedule") == "B").then(pl.lit("B1")).otherwise(pl.col("schedule"))
    df = raw.select(
        filing_id(),
        pl.lit("0").alias("amendment_no"),
        pl.col("form").str.replace("^CA", "F").alias("form"),
        pl.col("per_beg_date").alias("period_start"),
        pl.col("per_end_date").alias("period_end"),
        pl.col("cmt_id").alias("filer_id"),
        pl.col("cmt_nm").alias("filer_name"),
        # Unitemized lines are per-statement totals with no counterparty; keep them out of the itemized schedules.
        pl.when(unitemized).then(pl.concat_str([sched, pl.lit("_UNITEMIZED")])).otherwise(sched).alias("schedule"),
        # No entity code in LA's export: a listed occupation or employer marks an individual.
        pl.when(pl.col("con_occp").is_not_null() | pl.col("con_empr").is_not_null())
        .then(pl.lit("IND"))
        .otherwise(pl.lit("OTH"))
        .alias("entity_cd"),
        pl.col("con_name").alias("last_name"),
        pl.col("con_city_nm").alias("city"),
        pl.col("con_state_nm").alias("state"),
        pl.col("con_zip_cd").alias("zip"),
        pl.col("con_empr").alias("employer"),
        pl.col("con_occp").alias("occupation"),
        pl.col("con_date").alias("tran_date"),
        pl.col("con_amount").alias("amount"),
    )
    return cal_format.normalize(df)


def adapt_expenditures(raw: pl.DataFrame) -> pl.DataFrame:
    sched = pl.col("exp_type").str.extract(r"Schedule ([A-Z])", 1)
    subvendor = pl.col("exp_type").str.contains("Subvendor")
    df = raw.select(
        filing_id(),
        pl.lit("0").alias("amendment_no"),
        pl.col("form").str.replace("^CA", "F").alias("form"),
        pl.col("per_beg_date").alias("period_start"),
        pl.col("per_end_date").alias("period_end"),
        pl.col("cmt_id").alias("filer_id"),
        pl.col("cmt_name").alias("filer_name"),
        sched.alias("schedule"),
        pl.when(pl.col("payee_cmt_id").is_not_null())
        .then(pl.lit("COM"))
        .when(pl.col("payee_fname").is_not_null())
        .then(pl.lit("IND"))
        .otherwise(pl.lit("OTH"))
        .alias("entity_cd"),
        pl.coalesce(pl.col("payee_lname"), pl.col("payee_name")).alias("last_name"),
        pl.col("payee_fname").alias("first_name"),
        pl.col("payee_addr_cty").alias("city"),
        pl.col("payee_addr_st").alias("state"),
        pl.col("payee_addr_zip").alias("zip"),
        pl.col("exp_date").alias("tran_date"),
        pl.col("exp_amount").alias("amount"),
        pl.col("payee_cmt_id").alias("cmte_id"),
        # Subvendor rows itemize a payment already reported on its own row: treat as memo.
        subvendor.cast(pl.String).alias("memo"),
    )
    return cal_format.normalize(df)


def cal(cache: RawCache) -> pl.DataFrame:
    c = cache.get(
        "contributions",
        f"https://{DOMAIN}/resource/{CONTRIBUTIONS}.csv",
        lambda: socrata.fetch(DOMAIN, CONTRIBUTIONS, CONTRIBUTION_COLUMNS),
    )
    e = cache.get(
        "expenditures",
        f"https://{DOMAIN}/resource/{EXPENDITURES}.csv",
        lambda: socrata.fetch(DOMAIN, EXPENDITURES, EXPENDITURE_COLUMNS),
    )
    s = cache.get(
        "statements",
        f"https://{DOMAIN}/resource/{STATEMENTS}.csv",
        lambda: socrata.fetch(DOMAIN, STATEMENTS, STATEMENT_COLUMNS),
    )
    df = pl.concat([adapt_contributions(c), adapt_expenditures(e)])
    links = statement_links(s)
    return df.drop("filing_url").join(links, on="filing_id", how="left").select(df.columns)


def portal_totals(cache: RawCache) -> pl.DataFrame:
    group = "cmt_id,per_beg_date,per_end_date"
    frames = []
    for sched, ds, where, amount in (
        ("A", CONTRIBUTIONS, ITEMIZED_A, "con_amount"),
        ("E", EXPENDITURES, SCHEDULE_E, "exp_amount"),
    ):
        agg = cache.get(
            f"portal_sum_{sched.lower()}",
            f"https://{DOMAIN}/resource/{ds}.csv?$select={group},sum({amount})&$where={where}&$group={group}",
            lambda ds=ds, where=where, amount=amount: socrata.query(
                DOMAIN,
                ds,
                {"$select": f"{group},sum({amount}) as portal_total", "$where": where, "$group": group},
            ),
        )
        frames.append(
            agg.select(
                filing_id(),
                pl.lit(sched).alias("schedule"),
                pl.col("portal_total").cast(pl.Float64, strict=False).fill_null(0),
            )
        )
    return pl.concat(frames)
