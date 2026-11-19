"""Name, employer, place and ZIP normalization for raw CAL-ACCESS parties.

Pure functions, no I/O, so reruns on the same input give the same output.

CAL-ACCESS stores person names in separate fields (last, first, title, suffix). The ingest joins them as
"TITLE FIRST LAST SUFFIX" (`person_name` in `py/ingest/src/ingest/calaccess/transform.py`), so after removing
titles and suffixes the last token is the last name and the first token is the first name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import polars as pl

# Titles that come before a person's name.
# Titles that say whether the filer called the donor Mr. or Mrs./Ms. Two records with opposite ones are
# different people (often spouses with near-identical first names, e.g. "Jane" and "Mr. Jan").
TITLE_GENDER = {"MR": "M", "MRS": "F", "MS": "F", "MISS": "F"}

TITLES = frozenset({"MR", "MRS", "MS", "MISS", "MX", "DR", "HON", "HONORABLE", "REV", "PROF", "SIR", "JUDGE"})

# Generational and professional suffixes that come after a person's name.
PERSON_SUFFIXES = frozenset(
    {
        "JR", "SR", "II", "III", "IV", "MD", "PHD", "ESQ", "DDS", "DMD", "CPA", "RN", "DO", "JD", "MBA",
        "DVM", "OD", "DC", "RET", "MPH", "LCSW", "MFT", "PE", "NP", "PA", "FACS", "2ND", "3RD",
    }
)  # fmt: skip

# Generational suffixes. Two records with different ones (JR vs SR) are different people.
GENERATIONAL = {"JR": "JR", "SR": "SR", "II": "II", "III": "III", "IV": "IV", "2ND": "II", "3RD": "III"}

# Legal-form words at the end of an organization's name. "THE" is removed at the start.
ORG_SUFFIXES = frozenset(
    {
        "INC", "INCORPORATED", "LLC", "LLP", "LP", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED",
        "PC", "PLLC", "APC", "PLC", "NA",
    }
)  # fmt: skip

# Values that mean "no name", "no employer" or "no occupation". These never match anything.
PLACEHOLDERS = frozenset(
    {
        "", "NA", "N A", "NONE", "NULL", "UNKNOWN", "NOT APPLICABLE", "INFORMATION REQUESTED", "INFO REQUESTED",
        "REQUESTED", "BEST EFFORT", "BEST EFFORTS", "NO NAME GIVEN", "ANONYMOUS", "VARIOUS", "UNITEMIZED",
        "NOT PROVIDED", "REFUSED", "X",
    }
)  # fmt: skip

_DROP = re.compile(r"[.'`’]")  # O'BRIEN -> OBRIEN, U.S. -> US
_JOIN_HYPHEN = re.compile(r"(?<=\w)-(?=\w)")  # SMITH-JONES -> SMITHJONES
_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")
_SPACES = re.compile(r"\s+")
_DIGITS = re.compile(r"[^0-9]")


def clean(text: str | None) -> str:
    """Uppercase, drop periods and apostrophes, join hyphenated words, turn other punctuation into spaces."""
    if text is None:
        return ""
    s = _DROP.sub("", text.upper().replace("&", " AND "))
    s = _JOIN_HYPHEN.sub("", s)
    s = _NON_ALNUM.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def clean_or_none(text: str | None) -> str | None:
    s = clean(text)
    return None if s in PLACEHOLDERS else s


@dataclass(frozen=True)
class PersonName:
    first: str | None
    middle: str | None
    last: str | None
    full: str | None
    suffix: str | None = None  # generational: JR, SR, II, III, IV
    title_gender: str | None = None  # M for MR, F for MRS/MS/MISS


def person_name(raw: str | None) -> PersonName:
    """Split a person's name into first, middle and last after removing titles and suffixes."""
    s = clean(raw)
    if s in PLACEHOLDERS:
        return PersonName(None, None, None, None)
    tokens = s.split(" ")
    # Joint gifts ("MICHAEL AND ELISA LEVY", "MR & MRS JOHN SMITH") name two people: never merged.
    if "AND" in tokens[1:-1]:
        return PersonName(None, None, None, None)
    title_gender = None
    while len(tokens) > 1 and tokens[0] in TITLES:
        title_gender = title_gender or TITLE_GENDER.get(tokens[0])
        tokens.pop(0)
    suffix = None
    while len(tokens) > 1 and tokens[-1] in PERSON_SUFFIXES:
        suffix = suffix or GENERATIONAL.get(tokens[-1])
        tokens.pop()
    # A generational suffix typed into the middle ("Charles T. Jr. Munger").
    if len(tokens) > 2:
        inner = [t for t in tokens[1:-1] if t not in GENERATIONAL]
        if len(inner) != len(tokens) - 2:
            suffix = suffix or next(GENERATIONAL[t] for t in tokens[1:-1] if t in GENERATIONAL)
            tokens = [tokens[0], *inner, tokens[-1]]
    last = tokens[-1]
    first = tokens[0] if len(tokens) > 1 else None
    middle = " ".join(tokens[1:-1]) or None
    return PersonName(first, middle, last, " ".join(tokens), suffix, title_gender)


def org_name(raw: str | None) -> str | None:
    """Organization name without leading THE and trailing legal-form words (INC, LLC, CORP...)."""
    s = clean(raw)
    if s in PLACEHOLDERS:
        return None
    tokens = s.split(" ")
    if len(tokens) > 1 and tokens[0] == "THE":
        tokens.pop(0)
    while len(tokens) > 1 and tokens[-1] in ORG_SUFFIXES:
        tokens.pop()
    # "L L C", "L P", "P C" written with spaces
    joined = " ".join(tokens)
    for spaced in (" L L C", " L L P", " L P", " P C", " N A"):
        if joined.endswith(spaced) and len(joined) > len(spaced):
            joined = joined[: -len(spaced)]
    return joined or None


def employer(raw: str | None) -> str | None:
    """Employer, normalized like an organization name. Placeholders become None."""
    s = clean_or_none(raw)
    return org_name(s) if s else None


def occupation(raw: str | None) -> str | None:
    return clean_or_none(raw)


def city(raw: str | None) -> str | None:
    return clean_or_none(raw)


def zip5(raw: str | None) -> str | None:
    d = _DIGITS.sub("", raw or "")
    return d[:5] if len(d) >= 5 else None


def zip3(raw: str | None) -> str | None:
    z = zip5(raw)
    return z[:3] if z else None


# ---------- polars ----------

RESOLVABLE_KINDS = ("person", "org")


def normalize_frame(raw: pl.DataFrame) -> pl.DataFrame:
    """Add normalized columns to raw entities.

    Input columns: canonical_key, kind, name, city, state, zip, employer, occupation (others are kept).
    Output adds: first_name, middle_name, last_name, full_name, gen_suffix, title_gender, org_name, employer_norm, occupation_norm,
    city_norm, state_norm, zip5, zip3, and `resolvable` (False for committees, candidates, measures,
    lobbying firms and rows without a usable name; those are never merged).
    """
    names = raw.select("name", "kind").rows()
    persons = [person_name(n) if k == "person" else PersonName(None, None, None, None) for n, k in names]
    orgs = [org_name(n) if k == "org" else None for n, k in names]

    def col(fn, src: str) -> pl.Series:
        return pl.Series(src, [fn(v) for v in raw[src].to_list()], dtype=pl.Utf8)

    out = raw.with_columns(
        pl.Series("first_name", [p.first for p in persons], dtype=pl.Utf8),
        pl.Series("middle_name", [p.middle for p in persons], dtype=pl.Utf8),
        pl.Series("last_name", [p.last for p in persons], dtype=pl.Utf8),
        pl.Series("full_name", [p.full for p in persons], dtype=pl.Utf8),
        pl.Series("gen_suffix", [p.suffix for p in persons], dtype=pl.Utf8),
        pl.Series("title_gender", [p.title_gender for p in persons], dtype=pl.Utf8),
        pl.Series("org_name", orgs, dtype=pl.Utf8),
        col(employer, "employer").alias("employer_norm"),
        col(occupation, "occupation").alias("occupation_norm"),
        col(city, "city").alias("city_norm"),
        col(clean_or_none, "state").alias("state_norm"),
        col(zip5, "zip").alias("zip5"),
        col(zip3, "zip").alias("zip3"),
    )
    return out.with_columns(
        resolvable=(
            ((pl.col("kind") == "person") & pl.col("last_name").is_not_null())
            | ((pl.col("kind") == "org") & pl.col("org_name").is_not_null())
        )
    )
