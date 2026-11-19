"""Turn PUBINFO tables into rows for ``entity`` (legislators), ``bill``, ``bill_author`` and ``vote``.

Rules this module enforces:

* A vote row exists only where BILL_DETAIL_VOTE_TBL records one. Nothing is
  inferred: a member with no row on a roll call gets no vote row, and is never
  counted as a no.
* VOTE_CODE maps AYE -> aye, NOE -> no, ABS -> nvr ("not voting / absent",
  which the leginfo site labels NVR). Any other code is an error.
* Every vote and author name must resolve to exactly one legislator, or the
  transform fails.

Count source: leginfo's Bill Votes pages show counts that match the per-member
rows in BILL_DETAIL_VOTE_TBL. BILL_SUMMARY_VOTE_TBL's ABSTAIN column
disagrees with them on about 2,100 roll calls (mostly Senate committees, where
it reads 0), and on one roll call its AYES differ too (SB 329, Assembly Floor,
2026-08-25: summary 77-0-2, members and website 76-0-3). So member rows are
the record and the summary table is used only as a cross-check.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import polars as pl

from .pubinfo import read_table

SOURCE = "leginfo_pubinfo"

VOTE_CODES = {"AYE": "aye", "NOE": "no", "ABS": "nvr"}

# Former names recorded in vote or author rows, mapped to the member's current
# AUTHOR_NAME. Each one is checked against the data: same house, the old name
# stops before the new one starts, and the two never appear on the same roll call.
#   Senate "Weber": 4 SFLOOR votes on 2024-12-02 only; "Weber Pierson" (SD39)
#   votes from 2025-01-09. LEGISLATOR_TBL lists one Senate Weber: SD39.
RENAMED: dict[tuple[str, str], str] = {
    ("S", "Weber"): "Weber Pierson",
}

# Author-name prefixes seen in BILL_VERSION_AUTHORS_TBL.NAME, e.g. ": Ahrens",
# "Senator Seyarto".
_AUTHOR_PREFIX = re.compile(r"^(?::\s*|Senator\s+|Assembly\s*Member\s+|Assemblymember\s+)", re.I)


def fold(s: str) -> str:
    """Lowercase and strip accents, for matching 'Avila Farias' to 'Ávila Farías'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).casefold().strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")


def session_label(session_year: str) -> str:
    """'20252026' -> '2025-2026'."""
    return f"{session_year[:4]}-{session_year[4:]}"


def measure_label(measure_type: str, measure_num: str, session_num: str) -> str:
    """Match leginfo's display: 'AB-1', and 'SBX1-1' for the first extraordinary session."""
    x = "" if session_num == "0" else f"X{session_num}"
    return f"{measure_type}{x}-{int(measure_num)}"


def house_of_location(code: str) -> str:
    """AFLOOR and Assembly committees (CX..) -> 'A'; SFLOOR and Senate committees (CS..) -> 'S'."""
    if code == "AFLOOR" or code.startswith("CX"):
        return "A"
    if code == "SFLOOR" or code.startswith("CS"):
        return "S"
    raise ValueError(f"unknown location code {code!r}")


@dataclass
class Tables:
    bill: pl.DataFrame
    bill_version: pl.DataFrame
    bill_version_authors: pl.DataFrame
    bill_detail_vote: pl.DataFrame
    bill_summary_vote: pl.DataFrame
    bill_motion: pl.DataFrame
    legislator: pl.DataFrame
    location_code: pl.DataFrame

    @classmethod
    def from_zip(cls, zip_path: Path) -> Tables:
        return cls(**{f: read_table(zip_path, f.upper() + "_TBL") for f in cls.__dataclass_fields__})


# ---------- legislators ----------


def legislators(t: Tables) -> pl.DataFrame:
    """One row per member. Columns: canonical_key, name, house, district, author_name, aliases, attrs fields.

    LEGISLATOR_TBL has one row per member per seat, plus empty rows for vacant
    seats. A member re-entered under a new spelling (AD15 'Avila Farias' and
    'Ávila Farías') becomes one entity: same house, district, first name and
    accent-folded last name.
    """
    rows = t.legislator.filter(pl.col("AUTHOR_NAME").is_not_null())
    people: dict[tuple[str, str, str, str], list[dict]] = {}
    for r in rows.iter_rows(named=True):
        key = (r["HOUSE_TYPE"], r["DISTRICT"], fold(r["FIRST_NAME"] or ""), fold(r["LAST_NAME"] or ""))
        people.setdefault(key, []).append(r)

    out = []
    for recs in people.values():
        # Prefer the active row for display fields.
        recs.sort(key=lambda r: (r["ACTIVE_LEGISLATOR"] != "Y", r["TRANS_UPDATE"] or ""))
        p = recs[0]
        house, district = p["HOUSE_TYPE"], p["DISTRICT"]
        name = " ".join(x for x in [p["FIRST_NAME"], p["LAST_NAME"], p["NAME_SUFFIX"]] if x)
        aliases = sorted({a for r in recs for a in (r["AUTHOR_NAME"], r["LEGISLATOR_NAME"]) if a})
        aliases += sorted(old for (h, old), new in RENAMED.items() if h == house and new == p["AUTHOR_NAME"])
        out.append(
            {
                "canonical_key": f"leginfo:legislator:{house}:{district}:{slug(p['LAST_NAME'])}-{slug(p['FIRST_NAME'])}",
                "name": name,
                "house": house,
                "district": district,
                "party": p["PARTY"],
                "author_name": p["AUTHOR_NAME"],
                "legislator_name": p["LEGISLATOR_NAME"],
                "first_name": p["FIRST_NAME"],
                "last_name": p["LAST_NAME"],
                "active": p["ACTIVE_LEGISLATOR"] == "Y",
                "session": session_label(p["SESSION_YEAR"]),
                "aliases": aliases,
            }
        )
    df = pl.DataFrame(out).sort("house", "district", "name")
    if df["canonical_key"].n_unique() != df.height:
        raise ValueError("duplicate legislator canonical_key")
    return df


def name_index(legs: pl.DataFrame) -> dict[tuple[str, str], str]:
    """(house, folded name) -> canonical_key, over author names and aliases. Fails on ambiguity."""
    idx: dict[tuple[str, str], str] = {}
    for r in legs.iter_rows(named=True):
        for a in [r["author_name"], *r["aliases"]]:
            k = (r["house"], fold(a))
            if idx.get(k, r["canonical_key"]) != r["canonical_key"]:
                raise ValueError(f"name {a!r} in house {r['house']} matches two legislators")
            idx[k] = r["canonical_key"]
    return idx


def resolve(idx: dict[tuple[str, str], str], house: str, name: str) -> str:
    key = idx.get((house, fold(name)))
    if key is None:
        raise KeyError(f"no legislator named {name!r} in house {house}")
    return key


# ---------- bills ----------


def bills(t: Tables) -> pl.DataFrame:
    """One row per BILL_TBL row. title = subject of the latest version; status = CURRENT_STATUS, else MEASURE_STATE."""
    subj = t.bill_version.select(pl.col("BILL_VERSION_ID").alias("LATEST_BILL_VERSION_ID"), "SUBJECT")
    df = t.bill.join(subj, on="LATEST_BILL_VERSION_ID", how="left")
    return df.select(
        pl.col("BILL_ID").alias("source_bill_id"),
        pl.col("SESSION_YEAR").map_elements(session_label, return_dtype=pl.String).alias("session"),
        pl.struct("MEASURE_TYPE", "MEASURE_NUM", "SESSION_NUM")
        .map_elements(lambda s: measure_label(s["MEASURE_TYPE"], s["MEASURE_NUM"], s["SESSION_NUM"]), return_dtype=pl.String)
        .alias("measure"),
        pl.col("SUBJECT").alias("title"),
        pl.coalesce("CURRENT_STATUS", "MEASURE_STATE").alias("status"),
        pl.col("LATEST_BILL_VERSION_ID").alias("latest_version_id"),
    ).sort("source_bill_id")


def bill_authors(t: Tables, idx: dict[tuple[str, str], str]) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Authors of each bill's latest version.

    CONTRIBUTION LEAD_AUTHOR -> 'lead'; COAUTHOR and PRINCIPAL_COAUTHOR -> 'coauthor'
    (the schema has no principal-coauthor role; the source value is kept in
    ``contribution``). Committee authors (TYPE='Committee') are not legislators,
    so they are returned separately and not loaded into bill_author.
    """
    latest = t.bill.select("BILL_ID", pl.col("LATEST_BILL_VERSION_ID").alias("BILL_VERSION_ID"))
    a = t.bill_version_authors.join(latest, on="BILL_VERSION_ID", how="inner")
    committees = a.filter(pl.col("TYPE") != "Legislator").select(
        pl.col("BILL_ID").alias("source_bill_id"), pl.col("NAME").alias("committee"), pl.col("HOUSE").alias("house")
    )
    rows = []
    for r in a.filter(pl.col("TYPE") == "Legislator").iter_rows(named=True):
        house = {"ASSEMBLY": "A", "SENATE": "S"}[r["HOUSE"]]
        name = _AUTHOR_PREFIX.sub("", r["NAME"]).strip()
        rows.append(
            {
                "source_bill_id": r["BILL_ID"],
                "legislator_key": resolve(idx, house, name),
                "role": "lead" if r["CONTRIBUTION"] == "LEAD_AUTHOR" else "coauthor",
                "contribution": r["CONTRIBUTION"],
                "raw_name": r["NAME"],
            }
        )
    df = pl.DataFrame(rows)
    # One row per (bill, legislator); if listed twice keep 'lead' over 'coauthor'.
    df = df.sort("role", descending=True).unique(["source_bill_id", "legislator_key"], keep="first", maintain_order=True)
    return df.sort("source_bill_id", "role", "legislator_key", descending=[False, True, False]), committees


# ---------- votes ----------

ROLL_CALL = ["BILL_ID", "LOCATION_CODE", "VOTE_DATE_TIME", "VOTE_DATE_SEQ", "MOTION_ID"]


def votes(t: Tables, idx: dict[tuple[str, str], str]) -> pl.DataFrame:
    """One row per member vote recorded in BILL_DETAIL_VOTE_TBL, and no others."""
    d = t.bill_detail_vote
    bad = d.filter(~pl.col("VOTE_CODE").is_in(list(VOTE_CODES)) | pl.col("VOTE_CODE").is_null())
    if bad.height:
        raise ValueError(f"unknown VOTE_CODE values: {bad['VOTE_CODE'].unique().to_list()}")
    motions = t.bill_motion.select("MOTION_ID", pl.col("MOTION_TEXT").alias("motion"))
    locs = t.location_code.select("LOCATION_CODE", pl.col("DESCRIPTION").alias("location")).unique("LOCATION_CODE")
    d = d.join(motions, on="MOTION_ID", how="left").join(locs, on="LOCATION_CODE", how="left")
    if d["location"].null_count():
        raise ValueError("vote at a location missing from LOCATION_CODE_TBL")

    house = d["LOCATION_CODE"].map_elements(house_of_location, return_dtype=pl.String)
    keys = [resolve(idx, h, n) for h, n in zip(house, d["LEGISLATOR_NAME"], strict=True)]
    out = d.select(
        pl.col("BILL_ID").alias("source_bill_id"),
        pl.Series("legislator_key", keys),
        pl.col("VOTE_DATE_TIME").str.slice(0, 10).str.to_date().alias("vote_date"),
        "motion",
        "location",
        pl.col("VOTE_CODE").replace_strict(VOTE_CODES).alias("result"),
        # Source roll-call key and raw name, kept for audit and checks (no column for them in `vote` yet).
        pl.col("LOCATION_CODE").alias("location_code"),
        pl.col("VOTE_DATE_TIME").alias("vote_date_time"),
        pl.col("VOTE_DATE_SEQ").cast(pl.Int32).alias("vote_date_seq"),
        pl.col("MOTION_ID").alias("motion_id"),
        pl.col("LEGISLATOR_NAME").alias("raw_name"),
        pl.col("VOTE_CODE").alias("vote_code"),
    )
    if out.height != t.bill_detail_vote.height:
        raise AssertionError("vote rows must equal detail rows")
    return out.sort("source_bill_id", "vote_date_time", "vote_date_seq", "location_code", "raw_name")


def roll_call_counts(v: pl.DataFrame) -> pl.DataFrame:
    """Ayes, noes and NVR per roll call, counted from member vote rows."""
    return (
        v.group_by("source_bill_id", "location_code", "location", "vote_date_time", "vote_date_seq", "motion_id", "motion")
        .agg(
            (pl.col("result") == "aye").sum().alias("ayes"),
            (pl.col("result") == "no").sum().alias("noes"),
            (pl.col("result") == "nvr").sum().alias("nvr"),
        )
        .sort("source_bill_id", "vote_date_time", "vote_date_seq")
    )


def summary_mismatches(t: Tables, counts: pl.DataFrame) -> pl.DataFrame:
    """Roll calls where member-row counts differ from BILL_SUMMARY_VOTE_TBL."""
    s = t.bill_summary_vote.select(
        pl.col("BILL_ID").alias("source_bill_id"),
        pl.col("LOCATION_CODE").alias("location_code"),
        pl.col("VOTE_DATE_TIME").alias("vote_date_time"),
        pl.col("VOTE_DATE_SEQ").cast(pl.Int32).alias("vote_date_seq"),
        pl.col("MOTION_ID").alias("motion_id"),
        pl.col("AYES").cast(pl.Int64).alias("summary_ayes"),
        pl.col("NOES").cast(pl.Int64).alias("summary_noes"),
        pl.col("ABSTAIN").cast(pl.Int64).alias("summary_abstain"),
    )
    j = counts.join(s, on=["source_bill_id", "location_code", "vote_date_time", "vote_date_seq", "motion_id"], how="full", coalesce=True)
    return j.filter(
        (pl.col("ayes") != pl.col("summary_ayes")).fill_null(True)
        | (pl.col("noes") != pl.col("summary_noes")).fill_null(True)
        | (pl.col("nvr") != pl.col("summary_abstain")).fill_null(True)
    )


@dataclass
class Staged:
    legislators: pl.DataFrame
    bills: pl.DataFrame
    bill_authors: pl.DataFrame
    committee_authors: pl.DataFrame
    votes: pl.DataFrame


def stage(t: Tables) -> Staged:
    legs = legislators(t)
    idx = name_index(legs)
    ba, comm = bill_authors(t, idx)
    return Staged(legs, bills(t), ba, comm, votes(t, idx))


def write_parquet(s: Staged, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in Staged.__dataclass_fields__:
        getattr(s, name).write_parquet(out_dir / f"{name}.parquet")
