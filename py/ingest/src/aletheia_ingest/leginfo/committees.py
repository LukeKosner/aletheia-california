"""Draft data/manual/legislator_committees.csv: each legislator's CAL-ACCESS candidate-controlled committees.

This writes a DRAFT for a human to check. Nothing reads it into the database
until a human has approved it (set ``approved`` to ``yes`` per row).

Source: CAL-ACCESS raw export https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip
- CVR_CAMPAIGN_DISCLOSURE_CD: cover pages of Forms 460/450/497/465/425. Each row
  names the filing committee (FILER_ID, FILER_NAML), its type (CMTTE_TYPE 'C' =
  candidate/officeholder controlled) and the candidate (CAND_NAML, CAND_NAMF,
  OFFICE_CD, DIST_NO).
- F501_502_CD: Form 501 candidate intention statements (candidate's own FILER_ID).

Match rule: accent-folded last name equal and first name equal or a prefix
match (e.g. 'Scott D.' ~ 'Scott'), on filings dated 2023-01-01 or later.
``match_basis`` says whether office and district also match the member's seat.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

import polars as pl

from .transform import fold

SINCE = "2023-01-01"
COVER_FORMS = ["F460", "F450", "F497", "F465", "F425"]
OFFICE = {"A": "ASM", "S": "SEN"}


def _read_tsv(zf: zipfile.ZipFile, name: str, cols: list[str]) -> pl.DataFrame:
    data = zf.read(f"CalAccess/DATA/{name}.TSV")
    df = pl.read_csv(
        io.BytesIO(data), separator="\t", quote_char=None, infer_schema=False,
        truncate_ragged_lines=True, encoding="utf8-lossy", columns=cols,
    )
    return df.with_columns(pl.col(c).str.strip_chars() for c in cols)


def _date(col: str) -> pl.Expr:
    return pl.col(col).str.split(" ").list.first().str.strptime(pl.Date, "%m/%d/%Y", strict=False)


# Common short forms, checked against this roster's misses (Tom Umberg, Tom Lackey,
# Steve Bennett, Liz Ortega, Kate Sanchez, Steve Padilla filing as Thomas/Stephen/Kathryn).
NICKNAMES = [
    {"tom", "thomas"}, {"steve", "stephen", "steven"}, {"liz", "elizabeth"}, {"kate", "kathryn", "katherine"},
    {"bill", "william"}, {"bob", "robert"}, {"mike", "michael"}, {"chris", "christopher"}, {"jim", "james"},
    {"joe", "joseph"}, {"dave", "david"}, {"ben", "benjamin"}, {"tim", "timothy"}, {"greg", "gregory"}, {"matt", "matthew"}, {"dan", "daniel"},
]
_TITLE = re.compile(r"^(dr|hon|colonel|col|ret|mr|mrs|ms|senator|assemblymember)$")


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[\s\-.,()]+", fold(s or "")) if t and not _TITLE.match(t)]


def committee_kind(name: str) -> str:
    """Rough label from the committee's own name, to speed up review."""
    n = fold(name or "")
    if "officeholder" in n:
        return "officeholder account"
    if "ballot measure" in n:
        return "ballot measure committee"
    if "legal defense" in n:
        return "legal defense fund"
    return "election committee"


def name_match(first: str, last: str, cand_first: str, cand_last: str) -> str | None:
    """'exact', 'variant' (nickname or compound surname), or None."""
    lt, ct = _tokens(last), _tokens(cand_last)
    if not lt or not ct:
        return None
    exact_last = lt == ct
    if not exact_last and not (set(lt) <= set(ct) or set(ct) <= set(lt)):
        return None
    f, cf = _tokens(first), _tokens(cand_first)
    if not f or not cf:
        return None
    if f[0] == cf[0]:
        return "exact" if exact_last else "variant"
    if any(f[0] in g and cf[0] in g for g in NICKNAMES):
        return "variant"
    return None


def draft(calaccess_zip: Path, legislators: pl.DataFrame) -> pl.DataFrame:
    with zipfile.ZipFile(calaccess_zip) as zf:
        cvr = _read_tsv(
            zf, "CVR_CAMPAIGN_DISCLOSURE_CD",
            ["FILING_ID", "FORM_TYPE", "FILER_ID", "FILER_NAML", "RPT_DATE", "CMTTE_TYPE", "CAND_NAML", "CAND_NAMF", "OFFICE_CD", "DIST_NO"],
        )
        f501 = _read_tsv(zf, "F501_502_CD", ["FILING_ID", "FILER_ID", "CAND_NAML", "CAND_NAMF", "OFFICE_CD", "DIST_NO", "YR_OF_ELEC"])

    cvr = cvr.with_columns(_date("RPT_DATE").alias("rpt")).filter(
        pl.col("FORM_TYPE").is_in(COVER_FORMS) & (pl.col("CMTTE_TYPE") == "C") & pl.col("CAND_NAML").is_not_null()
        & (pl.col("rpt") >= pl.lit(SINCE).str.to_date())
    )

    committees = cvr.group_by("FILER_ID").agg(
        pl.col("FILER_NAML").sort_by(["rpt", "FILING_ID"]).last().alias("committee_name"),
        pl.col("CAND_NAML").sort_by(["rpt", "FILING_ID"]).last(),
        pl.col("CAND_NAMF").sort_by(["rpt", "FILING_ID"]).last(),
        pl.col("OFFICE_CD").sort_by(["rpt", "FILING_ID"]).drop_nulls().last().alias("office_cd"),
        pl.col("DIST_NO").sort_by(["rpt", "FILING_ID"]).drop_nulls().last().alias("dist_no"),
        pl.len().alias("n_cover_pages"),
        pl.col("rpt").max().alias("latest_report"),
        pl.col("FILING_ID").sort_by(["rpt", "FILING_ID"]).last().alias("latest_filing_id"),
    )

    rows = []
    for leg in legislators.iter_rows(named=True):
        seat_office, seat_dist = OFFICE[leg["house"]], str(int(leg["district"][2:]))

        def how(r: dict, leg: dict = leg) -> str | None:
            return name_match(leg["first_name"], leg["last_name"], r["CAND_NAMF"], r["CAND_NAML"])

        cand_ids = ";".join(sorted({r["FILER_ID"] for r in f501.iter_rows(named=True) if r["FILER_ID"] and how(r)}))
        hits = [(h, how(h)) for h in committees.sort(["latest_report", "FILER_ID"], descending=[True, False]).iter_rows(named=True)]
        hits = [(h, m) for h, m in hits if m]
        base = {
            "legislator_key": leg["canonical_key"],
            "legislator_name": leg["name"],
            "house": leg["house"],
            "district": leg["district"],
            "party": leg["party"],
            "candidate_filer_ids_f501": cand_ids,
        }
        if not hits:
            rows.append(base | {"match_basis": "NO MATCH FOUND", "approved": ""})
            continue
        for h, method in hits:
            same_office = h["office_cd"] == seat_office
            same_dist = (h["dist_no"] or "").lstrip("0") == seat_dist
            basis = (
                "name + current office + district" if same_office and same_dist
                else "name + current office, other district" if same_office
                else f"name only (committee office {h['office_cd'] or '?'})"
            ) + ("" if method == "exact" else "; name variant")
            rows.append(
                base
                | {
                    "committee_filer_id": h["FILER_ID"],
                    "committee_name": h["committee_name"],
                    "committee_kind": committee_kind(h["committee_name"]),
                    "committee_office": h["office_cd"],
                    "committee_district": h["dist_no"],
                    "cand_name_on_filing": f"{h['CAND_NAMF']} {h['CAND_NAML']}",
                    "n_cover_pages_since_2023": h["n_cover_pages"],
                    "latest_report": h["latest_report"].isoformat() if h["latest_report"] else "",
                    "latest_filing_id": h["latest_filing_id"],
                    "match_basis": basis,
                    "approved": "",
                }
            )
    cols = [
        "legislator_key", "legislator_name", "house", "district", "party", "committee_filer_id", "committee_name", "committee_kind",
        "committee_office", "committee_district", "cand_name_on_filing", "n_cover_pages_since_2023", "latest_report",
        "latest_filing_id", "candidate_filer_ids_f501", "match_basis", "approved",
    ]
    return pl.DataFrame([{c: "" if r.get(c) is None else str(r.get(c)) for c in cols} for r in rows], schema={c: pl.String for c in cols})
