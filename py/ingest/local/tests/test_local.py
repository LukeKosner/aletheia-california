"""Tests for the local campaign finance ingest.

Every fixture row is copied from a real public record (fetched 2026-11-15):

- SF rows: DataSF Campaign Finance - Transactions, https://data.sf.gov/d/pitq-e56w
  filings 217902822 (Clean Up The Charter - Yes on A), 217902364 (DJ Brookter for Supervisor 2026),
  217861766 (Leah LaCroix for City College Board 2026). Summary totals for 217902822 from
  https://data.sf.gov/d/9ggq-m8hp.
- Oakland rows: data.oaklandca.gov Form 460 Schedule A (3xq4-ermg, filer 1482492, tran_id fooBiSgil2ur),
  Schedule D (x5eg-xkea, filer 1342695, tran_id EXP18905), Schedule H (qunm-zyau, filer 1467180, tran_id RCV6).
- LA rows: data.lacity.org City Campaign Contributions (m6g2-gc6c, Hahn for Mayor 2005, cmt_id 1254386)
  and City Campaign Expenditures (5mrt-4zhe, Friends of Mark Ridley-Thomas, cmt_id 4357).
"""

from __future__ import annotations

import re

import polars as pl
import pytest

from local import __main__ as cli
from local import cal_format, la, oakland, pipeline, sf


def frame(rows: list[dict[str, str | None]], columns: list[str]) -> pl.DataFrame:
    return pl.DataFrame([{c: r.get(c) for c in columns} for r in rows], schema={c: pl.String for c in columns})


SF_ROWS = [
    {  # Schedule A, committee contributor
        "filing_id_number": "217902822", "filing_version": "4", "filing_date": "2026-11-12T00:00:00.000",
        "start_date": "2026-09-20T00:00:00.000", "end_date": "2026-10-17T00:00:00.000", "fppc_id": "1493867",
        "filer_nid": "217079174", "filer_name": "Clean Up The Charter - Yes on A", "form_type": "A",
        "transaction_id": "INC50", "entity_code": "SCC",
        "transaction_last_name": "Operating Engineers Local 3 Issues Advocacy/Ballot Initiative PAC",
        "transaction_city": "Concord", "transaction_state": "CA", "transaction_zip": "94519",
        "transaction_date": "2026-09-22T00:00:00.000", "transaction_amount_1": "10000.0", "committee_id": "1345344",
        "memo_code": "false",
    },
    {  # Schedule E, vendor payment
        "filing_id_number": "217902822", "filing_version": "4", "filing_date": "2026-11-12T00:00:00.000",
        "start_date": "2026-09-20T00:00:00.000", "end_date": "2026-10-17T00:00:00.000", "fppc_id": "1493867",
        "filer_nid": "217079174", "filer_name": "Clean Up The Charter - Yes on A", "form_type": "E",
        "transaction_id": "EXP110", "entity_code": "OTH", "transaction_last_name": "Viewpoint Media LLC",
        "transaction_city": "Berkeley", "transaction_state": "CA", "transaction_zip": "94704",
        "transaction_date": "2026-10-13T00:00:00.000", "transaction_amount_1": "18750.0", "memo_code": "false",
    },
    {  # Schedule D, monetary contribution to a committee
        "filing_id_number": "217902364", "filing_version": "3", "filing_date": "2026-11-12T00:00:00.000",
        "start_date": "2026-09-20T00:00:00.000", "end_date": "2026-10-17T00:00:00.000", "fppc_id": "1481892",
        "filer_nid": "214443884", "filer_name": "DJ Brookter for Supervisor 2026", "form_type": "D",
        "transaction_id": "EXP942", "entity_code": "COM", "transaction_last_name": "Affordable Housing Alliance PAC",
        "transaction_city": "San Francisco", "transaction_state": "CA", "transaction_zip": "94110",
        "transaction_date": "2026-09-28T00:00:00.000", "transaction_amount_1": "1000.0", "transaction_code": "MON",
        "support_oppose_code": "S", "memo_code": "false",
    },
    {  # Schedule B1, loan with nothing received this period
        "filing_id_number": "217861766", "filing_version": "2", "filing_date": "2026-10-30T00:00:00.000",
        "start_date": "2026-10-18T00:00:00.000", "end_date": "2026-10-28T00:00:00.000", "fppc_id": "1495579",
        "filer_name": "Leah LaCroix for City College Board 2026", "form_type": "B1", "transaction_id": "xzo8Mqhkjjqf",
        "entity_code": "IND", "transaction_first_name": "Leah", "transaction_last_name": "LaCroix",
        "transaction_city": "San Francisco", "transaction_state": "CA", "transaction_zip": "94112",
        "transaction_occupation": "Not Employed", "transaction_employer": "Not Employed", "loan_amount_1": "0.0",
        "memo_code": "false",
    },
]  # fmt: skip

OAKLAND_A = {
    "filer_id": "1482492", "filer_naml": "Charlene Wang for Oakland Council D2 2026", "report_num": "1",
    "rpt_date": "2026-08-19T00:00:00.000", "from_date": "2026-01-01T00:00:00.000", "thru_date": "2026-06-30T00:00:00.000",
    "form_type": "A", "tran_id": "fooBiSgil2ur", "entity_cd": "IND", "tran_naml": "Barclay", "tran_namf": "Jerry",
    "tran_city": "Oakland", "tran_state": "CA", "tran_zip4": "94610", "tran_emp": "N/A", "tran_occ": "Not Employed",
    "tran_date": "2026-01-05T00:00:00.000", "tran_amt1": "50.0",
}  # fmt: skip
OAKLAND_D = {
    "filer_id": "1342695", "filer_naml": "East Bay Rental Housing Association PAC", "report_num": "1",
    "rpt_date": "2026-08-18T00:00:00.000", "from_date": "2026-01-01T00:00:00.000", "thru_date": "2026-04-18T00:00:00.000",
    "form_type": "D", "tran_id": "EXP18905", "entity_cd": "COM", "payee_naml": "Johnson for Judge 2026",
    "payee_city": "Inglewood", "payee_state": "CA", "payee_zip4": "90301", "expn_date": "2026-02-26T00:00:00.000",
    "amount": "1500.0", "expn_code": "MON", "cand_naml": "Michael Johnson", "sup_opp_cd": "S",
}  # fmt: skip
OAKLAND_H = {
    "filer_id": "1467180", "filer_naml": "Foundational Oakland Unites (nonprofit 501(c)(4))", "report_num": "0",
    "rpt_date": "2025-01-31T00:00:00.000", "from_date": "2024-10-20T00:00:00.000", "thru_date": "2024-12-31T00:00:00.000",
    "form_type": "H", "tran_id": "RCV6", "entity_cd": "COM", "lndr_naml": "Oakland United To Recall Sheng Thao",
    "loan_city": "Oakland", "loan_st": "CA", "loan_zip4": "94607", "loan_date1": "2024-04-09T00:00:00.000",
    "loan_amt1": "0.0", "cmte_id": "1466653",
}  # fmt: skip

LA_CONTRIBUTION = {
    "cmt_id": "1254386", "cmt_nm": "Hahn for Mayor 2005", "form": "CA460", "schedule": "A",
    "con_type": "Monetary Contributions (Itemized)", "per_beg_date": "2003-01-01T00:00:00.000",
    "per_end_date": "2003-06-30T00:00:00.000", "con_date": "2003-06-16T00:00:00.000", "con_name": "Patricia Cuevas",
    "con_city_nm": "Ontario", "con_state_nm": "CA", "con_zip_cd": "91761", "con_occp": "Vice President",
    "con_empr": "Burrito King", "con_amount": "250.00",
}  # fmt: skip
LA_EXPENDITURE = {
    "cmt_id": "4357", "cmt_name": "Friends of Mark Ridley-Thomas", "form": "CA460",
    "exp_type": "Payment Made [Form 460, Schedule E]", "per_beg_date": "1998-04-01T00:00:00.000",
    "per_end_date": "1998-06-30T00:00:00.000", "payee_name": "American Express", "payee_lname": "American Express",
    "payee_addr_cty": "Chicago", "payee_addr_st": "IL", "payee_addr_zip": "60679-0001", "exp_amount": "815.63",
}  # fmt: skip


def edges_by_line(t: cal_format.Tables) -> dict[str, dict]:
    return {r["line_item"]: r for r in t.money_edge.iter_rows(named=True)}


# ---------- no street addresses ----------


def test_cal_record_has_no_address_column() -> None:
    cal_format.assert_no_address_columns(list(cal_format.CAL_SCHEMA))
    with pytest.raises(ValueError):
        cal_format.assert_no_address_columns(["tran_adr1"])


def test_adapters_never_request_street_addresses_or_free_text_memos() -> None:
    street = re.compile(r"adr[12]|street", re.IGNORECASE)
    requested = sf.TRANSACTION_COLUMNS + la.CONTRIBUTION_COLUMNS + la.EXPENDITURE_COLUMNS + la.STATEMENT_COLUMNS
    for sched in oakland.DATASETS:
        requested += oakland.columns(sched)
    assert not [c for c in requested if street.search(c)]
    # LA's free-text memo sometimes holds an address; it is never requested.
    assert "memo" not in la.CONTRIBUTION_COLUMNS + la.EXPENDITURE_COLUMNS


def test_normalize_drops_address_columns_even_if_present() -> None:
    raw = frame([{**OAKLAND_A, "tran_adr1": "redacted"}], [*oakland.columns("A"), "tran_adr1"])
    out = oakland.adapt(raw, "A")
    assert not [c for c in out.columns if "adr" in c]


# ---------- San Francisco ----------


def sf_tables() -> cal_format.Tables:
    cal = sf.adapt(frame(SF_ROWS, sf.TRANSACTION_COLUMNS))
    return cal_format.to_tables(cal, sf.SOURCE)


def test_sf_edges() -> None:
    t = sf_tables()
    e = edges_by_line(t)
    a = e["INC50"]
    assert (a["from_key"], a["to_key"], a["kind"], str(a["amount"])) == (
        "calaccess:filer:1345344",
        "calaccess:filer:1493867",
        "contribution",
        "10000.00",
    )
    assert (e["EXP110"]["from_key"], e["EXP110"]["kind"]) == ("calaccess:filer:1493867", "expenditure")
    assert e["EXP110"]["to_key"] == "org:datasf:sfo:viewpoint media llc"
    assert (e["EXP942"]["to_key"], e["EXP942"]["kind"]) == (
        "committee:datasf:sfo:affordable housing alliance pac",  # entity code COM, no committee id on the row
        "contribution",
    )
    assert "xzo8Mqhkjjqf" not in e  # loan with 0 received this period
    assert t.skipped == {"zero_amount": 1}


def test_sf_filings_tagged_with_source() -> None:
    t = sf_tables()
    assert set(t.filing["source"]) == {"datasf:sfo"}
    f = t.filing.filter(pl.col("filing_id") == "217902822").row(0, named=True)
    assert f["amendment_no"] == 4 and f["form"] == "F460" and str(f["period_end"]) == "2026-10-17"


def test_referential_integrity() -> None:
    t = sf_tables()
    keys = set(t.entity["canonical_key"])
    assert set(t.money_edge["from_key"]) | set(t.money_edge["to_key"]) <= keys
    assert set(t.money_edge["filing_id"]) <= set(t.filing["id"])
    assert set(t.entity_alias["entity_id"]) <= set(t.entity["id"])


def test_ids_are_deterministic() -> None:
    a, b = sf_tables(), sf_tables()
    assert a.money_edge["id"].to_list() == b.money_edge["id"].to_list()
    assert a.entity["id"].to_list() == b.entity["id"].to_list()


def test_sf_totals_check_against_summary() -> None:
    cal = sf.adapt(frame(SF_ROWS, sf.TRANSACTION_COLUMNS))
    ours = cal_format.itemized_totals(cal)
    # 9ggq-m8hp, filing 217902822: schedulea_line_1 = 127500.0. Our fixture holds 1 of its A rows.
    portal = pl.DataFrame({"filing_id": ["217902822"], "schedule": ["A"], "portal_total": [127500.0]})
    cmp = pipeline.compare_totals(ours, portal)
    assert cmp.row(0, named=True)["diff"] == -117500.0
    assert not pipeline.passed(pipeline.summarize(cmp))
    exact = pl.DataFrame({"filing_id": ["217902822"], "schedule": ["A"], "portal_total": [10000.0]})
    assert pipeline.passed(pipeline.summarize(pipeline.compare_totals(ours, exact)))


# ---------- Oakland ----------


def test_oakland_person_contribution_and_dedup() -> None:
    raw = frame([OAKLAND_A, OAKLAND_A], oakland.columns("A"))  # verbatim repeat, as in the open data copy
    cal = oakland.adapt(raw, "A")
    assert cal.height == 1
    t = cal_format.to_tables(cal, oakland.SOURCE)
    edge = t.money_edge.row(0, named=True)
    assert edge["from_key"] == "person:oaklandca:coak:jerry barclay|94610"
    assert edge["to_key"] == "calaccess:filer:1482492"
    assert t.filing.row(0, named=True)["filing_id"] == "1482492:2026-01-01:2026-06-30:2026-08-19:1"
    person = t.entity.filter(pl.col("kind") == "person").row(0, named=True)
    assert person["name"] == "Jerry Barclay"


def test_oakland_schedule_d_and_zero_loan() -> None:
    cal = pl.concat(
        [
            oakland.adapt(frame([OAKLAND_D], oakland.columns("D")), "D"),
            oakland.adapt(frame([OAKLAND_H], oakland.columns("H")), "H"),
        ]
    )
    t = cal_format.to_tables(cal, oakland.SOURCE)
    e = edges_by_line(t)
    assert e["EXP18905"]["kind"] == "contribution"
    assert e["EXP18905"]["from_key"] == "calaccess:filer:1342695"
    assert "RCV6" not in e and t.skipped == {"zero_amount": 1}


# ---------- Los Angeles ----------


def test_la_contribution_and_expenditure() -> None:
    unitemized = {**LA_CONTRIBUTION, "con_type": "Monetary Contributions (Untemized)", "con_name": None, "con_occp": None, "con_empr": None}
    cal = pl.concat(
        [
            la.adapt_contributions(frame([LA_CONTRIBUTION, unitemized], la.CONTRIBUTION_COLUMNS)),
            la.adapt_expenditures(frame([LA_EXPENDITURE], la.EXPENDITURE_COLUMNS)),
        ]
    )
    t = cal_format.to_tables(cal, la.SOURCE)
    rows = {r["kind"]: r for r in t.money_edge.iter_rows(named=True)}
    c = rows["contribution"]
    assert (c["from_key"], c["to_key"], str(c["amount"])) == (
        "person:lacity:lac:patricia cuevas|91761",
        "calaccess:filer:1254386",
        "250.00",
    )
    x = rows["expenditure"]
    # 4-digit LA committee id is a local id, not an FPPC id.
    assert x["from_key"] == "committee:lacity:lac:friends of mark ridley thomas"
    assert x["to_key"] == "org:lacity:lac:american express"
    assert t.skipped == {"schedule_not_loaded": 1}  # the unitemized line
    assert set(t.filing["filing_id"]) == {"1254386:2003-01-01:2003-06-30", "4357:1998-04-01:1998-06-30"}
    # LA has no memo column: rows must default to non-memo so they count toward itemized totals.
    totals = cal_format.itemized_totals(cal)
    assert totals.filter(pl.col("schedule") == "A")["total"].to_list() == [pytest.approx(250)]


def test_rows_without_a_filer_are_skipped() -> None:
    # 14 rows in m6g2-gc6c have neither cmt_id nor cmt_nm; they cannot be attributed to anyone.
    orphan = {**LA_CONTRIBUTION, "cmt_id": None, "cmt_nm": None}
    t = cal_format.to_tables(la.adapt_contributions(frame([orphan], la.CONTRIBUTION_COLUMNS)), la.SOURCE)
    assert t.money_edge.height == 0 and t.skipped == {"no_filer": 1}
    assert t.entity["canonical_key"].null_count() == 0


def test_la_subvendor_rows_are_memo() -> None:
    sub = {**LA_EXPENDITURE, "exp_type": "Payment Made/Subvendor [Form 460, Schedule E]"}
    cal = la.adapt_expenditures(frame([sub], la.EXPENDITURE_COLUMNS))
    assert cal["memo"].to_list() == [True]
    assert cal_format.itemized_totals(cal).height == 0


# ---------- flag ----------


def test_local_filers_flag_defaults_off(monkeypatch: pytest.MonkeyPatch) -> None:
    assert not pipeline.flag_on({})
    assert pipeline.flag_on({"LOCAL_FILERS": "on"})
    monkeypatch.delenv("LOCAL_FILERS", raising=False)
    assert cli.main(["run", "sf"]) == 2
