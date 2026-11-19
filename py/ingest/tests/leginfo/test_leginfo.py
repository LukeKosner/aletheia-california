"""Tests for the leginfo PUBINFO ingest.

Fixture rows are copied from public records:
- pubinfo_2025.zip (https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip,
  sha256 5a3ee868..., see data/raw/MANIFEST.csv): BILL_DETAIL_VOTE_TBL.dat and LEGISLATOR_TBL.dat.
- fixtures/pubinfo_votes_sample.csv: staged vote rows for SB 329, SB 2, AB 1, AB 13 and SBX1-1
  produced by transform.votes() from that zip.
- fixtures/leginfo_web_votes.json: the same bills' Bill Votes pages on leginfo.legislature.ca.gov,
  copied 2026-11-15 (URL per bill inside the file).
"""

from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import pytest

from aletheia_ingest.leginfo import pubinfo, transform, verify

FIX = Path(__file__).parent / "fixtures"
ZIP = Path(__file__).parents[4] / "data/raw/leginfo/pubinfo_2025.zip"

# Two real rows of BILL_DETAIL_VOTE_TBL.dat (SB 2, Sen Environmental Quality, 2025-03-19).
DETAIL_ROWS = (
    "`202520260SB2`\t`CS64`\t`Blakespear`\t2025-03-19 00:00:00\t2\t`AYE`\t183788\t`committee_service`\t2025-03-19 13:15:44\t1\t2025-03-19 00:00:00\tNULL\n"
    "`202520260SB2`\t`CS64`\t`Valladares`\t2025-03-19 00:00:00\t2\t`AYE`\t183788\t`committee_service`\t2025-03-19 13:15:44\t2\t2025-03-19 00:00:00\tNULL\n"
).encode()

# Two real rows of LEGISLATOR_TBL.dat: the AD15 member listed with and without accents.
LEGISLATOR_ROWS = (
    "`AD15`\t`20252026`\t`Ávila Farías, Anamarie`\t`A`\t`Ávila Farías`\t`Anamarie`\t`Ávila Farías`\tNULL\tNULL\t`Assembly Member`\t`Assembly Member`\t`DEM`\t`Y`\t`carrolth`\t2025-01-30 08:19:08\t`Y`\n"
    "`AD15`\t`20252026`\t`Avila Farias, Anamarie`\t`A`\t`Avila Farias`\t`Anamarie`\t`Avila Farias`\tNULL\tNULL\t`Assembly Member`\t`Assembly Member`\t`DEM`\t`Y`\t`carrolth`\t2025-01-30 08:19:02\t`N`\n"
).encode()


def test_parse_dat_reads_backtick_fields_and_nulls() -> None:
    df = pubinfo.parse_dat(DETAIL_ROWS, "BILL_DETAIL_VOTE_TBL")
    assert df.shape == (2, 12)
    assert df["LEGISLATOR_NAME"].to_list() == ["Blakespear", "Valladares"]
    assert df["SPEAKER"].null_count() == 2


def test_labels() -> None:
    assert transform.measure_label("AB", "1", "0") == "AB-1"
    assert transform.measure_label("SB", "1", "1") == "SBX1-1"
    assert transform.session_label("20252026") == "2025-2026"
    assert transform.house_of_location("CS64") == "S"
    assert transform.house_of_location("CX02") == "A"
    assert transform.house_of_location("AFLOOR") == "A"
    with pytest.raises(ValueError):
        transform.house_of_location("ZZ01")


def _tables(detail: bytes, legislators: bytes) -> transform.Tables:
    empty = {f: pubinfo.parse_dat(b"", f.upper() + "_TBL") for f in transform.Tables.__dataclass_fields__}
    empty["bill_detail_vote"] = pubinfo.parse_dat(detail, "BILL_DETAIL_VOTE_TBL")
    empty["legislator"] = pubinfo.parse_dat(legislators, "LEGISLATOR_TBL")
    empty["location_code"] = pl.DataFrame(
        {c: [None] for c in pubinfo.COLUMNS["LOCATION_CODE_TBL"]}, schema={c: pl.String for c in pubinfo.COLUMNS["LOCATION_CODE_TBL"]}
    ).with_columns(LOCATION_CODE=pl.lit("CS64"), DESCRIPTION=pl.lit("Sen Environmental Quality"))
    return transform.Tables(**empty)


def test_accent_variants_are_one_legislator() -> None:
    legs = transform.legislators(_tables(b"", LEGISLATOR_ROWS))
    assert legs.height == 1
    row = legs.row(0, named=True)
    assert row["name"] == "Anamarie Ávila Farías"
    assert row["active"] is True
    idx = transform.name_index(legs)
    assert transform.resolve(idx, "A", "Avila Farias") == transform.resolve(idx, "A", "Ávila Farías")


def test_unmatched_vote_name_fails() -> None:
    t = _tables(DETAIL_ROWS, LEGISLATOR_ROWS)  # Senate votes, only an Assembly member known
    idx = transform.name_index(transform.legislators(t))
    with pytest.raises(KeyError):
        transform.votes(t, idx)


def test_unknown_vote_code_fails() -> None:
    t = _tables(DETAIL_ROWS.replace(b"`AYE`", b"`ABST`", 1), LEGISLATOR_ROWS)
    with pytest.raises(ValueError, match="VOTE_CODE"):
        transform.votes(t, {})


def _sample_votes() -> pl.DataFrame:
    return pl.read_csv(FIX / "pubinfo_votes_sample.csv", try_parse_dates=True, infer_schema_length=0).with_columns(
        pl.col("vote_date").str.to_date()
    )


def test_five_bills_match_leginfo_website() -> None:
    web = verify.load_web(FIX / "leginfo_web_votes.json")
    assert len([k for k in web if not k.startswith("_")]) == 5
    assert verify.compare(_sample_votes(), web) == []


def test_compare_catches_a_changed_vote() -> None:
    web = verify.load_web(FIX / "leginfo_web_votes.json")
    v = _sample_votes()
    # Flip Dixon's recorded NVR on SB 329 (Assembly Floor, 2026-08-25) to a no.
    v = v.with_columns(
        pl.when((pl.col("source_bill_id") == "202520260SB329") & (pl.col("raw_name") == "Dixon") & (pl.col("location_code") == "AFLOOR"))
        .then(pl.lit("no"))
        .otherwise(pl.col("result"))
        .alias("result")
    )
    problems = verify.compare(v, web)
    assert len(problems) == 1 and "202520260SB329" in problems[0]


def test_compare_catches_a_dropped_vote() -> None:
    web = verify.load_web(FIX / "leginfo_web_votes.json")
    v = _sample_votes().filter(~((pl.col("source_bill_id") == "202520260SB2") & (pl.col("raw_name") == "Pérez")))
    assert verify.compare(v, web)


@pytest.mark.skipif(not ZIP.exists() or os.environ.get("CI") == "true", reason="needs data/raw/leginfo/pubinfo_2025.zip")
def test_full_session_from_zip() -> None:
    t = transform.Tables.from_zip(ZIP)
    s = transform.stage(t)
    # One vote row per recorded member vote, and no more.
    assert s.votes.height == t.bill_detail_vote.height
    assert s.legislators.height == 121
    assert s.bills.height == t.bill.height
    assert verify.compare(s.votes, verify.load_web(FIX / "leginfo_web_votes.json")) == []
    # Ayes and noes agree with the summary table on every roll call but one (SB 329, see transform docstring).
    mm = transform.summary_mismatches(t, transform.roll_call_counts(s.votes))
    aye_no = mm.filter((pl.col("ayes") != pl.col("summary_ayes")) | (pl.col("noes") != pl.col("summary_noes")))
    assert aye_no["source_bill_id"].to_list() == ["202520260SB329"]


# Names below are from CAL-ACCESS Form 460 cover pages (CVR_CAMPAIGN_DISCLOSURE_CD in
# https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip) and LEGISLATOR_TBL in pubinfo_2025.zip.
@pytest.mark.parametrize(
    ("first", "last", "cand_first", "cand_last", "expected"),
    [
        ("Scott", "Wiener", "Scott D.", "Wiener", "exact"),  # filer 1434666
        ("Jasmeet", "Bains", "Dr. Jasmeet", "Bains", "exact"),  # filer 1477778
        ("Thomas", "Umberg", "Tom", "Umberg", "variant"),  # filer 1415628
        ("Liz", "Ortega", "Liz", "Ortega-Toro", "variant"),  # filer 1476938
        ("Akilah", "Weber Pierson", "Akilah", "Weber", "variant"),  # filer 1459901
        ("Suzette", "Martinez Valladares", "Suzette", "Martinez Valladares", "exact"),  # filer 1458770
        ("Akilah", "Weber Pierson", "Shirley", "Weber", None),  # filer 1456658, a different person
        ("Kate", "Sanchez", "Dennis", "Sanchez", None),  # filer 1487349, a different person
    ],
)
def test_name_match(first: str, last: str, cand_first: str, cand_last: str, expected: str | None) -> None:
    from aletheia_ingest.leginfo.committees import name_match

    assert name_match(first, last, cand_first, cand_last) == expected


def test_committee_kind() -> None:
    from aletheia_ingest.leginfo.committees import committee_kind

    assert committee_kind("Scott Wiener State Senate 2024 Officeholder Account") == "officeholder account"  # filer 1476801
    assert committee_kind("Colonel (Ret.) Tom Umberg Ballot Measure Committee") == "ballot measure committee"  # filer 1467830
    assert committee_kind("Re-Elect Scott Wiener for State Senate 2024") == "election committee"  # filer 1434666


CSV = Path(__file__).parents[4] / "data/manual/legislator_committees.csv"


def test_approved_links_only_use_yes_rows() -> None:
    from aletheia_ingest.leginfo.load import approved_links

    links = approved_links(CSV)
    assert len(links) == 121
    # CAL-ACCESS filers 1434666 and 1476801 (CVR_CAMPAIGN_DISCLOSURE_CD, CAND_NAML Wiener, SEN 11).
    assert links["leginfo:legislator:S:SD11:wiener-scott"]["calaccess_committee_filer_ids"] == ["1434666", "1476801"]
    rejected = set(pl.read_csv(CSV, infer_schema=False).filter(pl.col("approved") == "no")["committee_filer_id"])
    assert not rejected & {c for v in links.values() for c in v["calaccess_committee_filer_ids"]}


def test_committees_command_keeps_approvals() -> None:
    from aletheia_ingest.leginfo.__main__ import main

    before = CSV.read_bytes()
    assert main(["committees"]) == 1
    assert CSV.read_bytes() == before
