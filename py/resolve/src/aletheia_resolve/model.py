"""Splink models for raw CAL-ACCESS donors: one for people, one for organizations.

People and organizations are scored by separate models on separate tables, so a person is never compared
with (or merged into) an organization. Committees and other filers are not in either table.

Training is seeded and writes the model to `models/<kind>.json` (committed). `predict` always reads the
committed model, so reruns on the same input score every pair identically.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import duckdb
import polars as pl
import splink.comparison_level_library as cll
import splink.comparison_library as cl
from splink import DuckDBAPI, Linker, SettingsCreator, block_on

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
SEED = 20261115

PERSON_COLUMNS = [
    "canonical_key", "first_name", "middle_name", "last_name", "employer_norm", "occupation_norm",
    "city_norm", "zip5", "zip3",
]  # fmt: skip
ORG_COLUMNS = ["canonical_key", "org_name", "city_norm", "zip5"]


def _fixed(level, m: float):
    """Fix a level's m probability (share of true matches that fall in this level)."""
    return level.configure(m_probability=m, fix_m_probability=True)


def _jw_comparison(col: str, thresholds: list[float], *, tf: bool = True, fixed_m: list[float] | None = None):
    levels = [cll.ExactMatchLevel(col, term_frequency_adjustments=tf)]
    levels += [cll.JaroWinklerLevel(col, t) for t in thresholds]
    levels.append(cll.ElseLevel())
    if fixed_m is not None:
        levels = [_fixed(lv, m) for lv, m in zip(levels, fixed_m, strict=True)]
    return cl.CustomComparison(comparison_levels=[cll.NullLevel(col), *levels], output_column_name=col)


# Name m probabilities are fixed priors, not trained. Expectation maximisation on this data latches onto
# "same household or same office" (shared last name, city and ZIP) instead of "same person" when it is
# allowed to estimate name levels, which gave nonsense such as m(first name exact) = 0.05. These values say
# how often one real donor's name appears in each similarity band across two filings: most often exactly
# the same, sometimes a nickname/typo or an initial. EM still estimates employer, occupation, city and ZIP.
FIRST_NAME_M = [0.85, 0.05, 0.03, 0.04, 0.03]  # exact, JW>=0.92, JW>=0.80, initial, other
LAST_NAME_M = [0.92, 0.05, 0.03]  # exact, JW>=0.92, other
ORG_NAME_M = [0.80, 0.12, 0.08]  # exact, JW>=0.92, other


def person_settings() -> SettingsCreator:
    first_name = cl.CustomComparison(
        output_column_name="first_name",
        comparison_levels=[
            cll.NullLevel("first_name"),
            *[
                _fixed(lv, m)
                for lv, m in zip(
                    [
                        cll.ExactMatchLevel("first_name", term_frequency_adjustments=True),
                        cll.JaroWinklerLevel("first_name", 0.92),
                        cll.JaroWinklerLevel("first_name", 0.80),
                        cll.CustomLevel(
                            "(length(first_name_l) = 1 OR length(first_name_r) = 1) "
                            "AND left(first_name_l, 1) = left(first_name_r, 1)",
                            label_for_charts="Initial matches",
                        ),
                        cll.ElseLevel(),
                    ],
                    FIRST_NAME_M,
                    strict=True,
                )
            ],
        ],
    )
    middle = cl.CustomComparison(
        output_column_name="middle_name",
        comparison_levels=[
            cll.NullLevel("middle_name"),
            cll.CustomLevel("left(middle_name_l, 1) = left(middle_name_r, 1)", label_for_charts="Initial matches"),
            cll.ElseLevel(),
        ],
    )
    return SettingsCreator(
        link_type="dedupe_only",
        unique_id_column_name="canonical_key",
        comparisons=[
            first_name,
            middle,
            _jw_comparison("last_name", [0.92], fixed_m=LAST_NAME_M),
            _jw_comparison("employer_norm", [0.88]),
            _jw_comparison("occupation_norm", [0.88]),
            _jw_comparison("city_norm", [0.90]),
            cl.ExactMatch("zip5"),
        ],
        blocking_rules_to_generate_predictions=[block_on("last_name", "zip3")],
        retain_intermediate_calculation_columns=False,
        retain_matching_columns=False,
    )


def org_settings() -> SettingsCreator:
    return SettingsCreator(
        link_type="dedupe_only",
        unique_id_column_name="canonical_key",
        comparisons=[
            _jw_comparison("org_name", [0.92], fixed_m=ORG_NAME_M),
            _jw_comparison("city_norm", [0.90]),
            cl.ExactMatch("zip5"),
        ],
        blocking_rules_to_generate_predictions=[block_on("org_name")],
        retain_intermediate_calculation_columns=False,
        retain_matching_columns=False,
    )


def _db_api(tmp_dir: Path | None) -> DuckDBAPI:
    con = duckdb.connect()
    # Fixed thread count: DuckDB sums floats in parallel, and a fixed plan keeps training reproducible.
    con.execute("SET threads TO 4")
    con.execute("SET preserve_insertion_order = true")
    if tmp_dir is not None:
        tmp_dir.mkdir(parents=True, exist_ok=True)
        con.execute(f"SET temp_directory = '{tmp_dir}'")
    return DuckDBAPI(connection=con)


def _input(frame: pl.DataFrame, kind: str) -> pl.DataFrame:
    cols = PERSON_COLUMNS if kind == "person" else ORG_COLUMNS
    return frame.filter((pl.col("kind") == kind) & pl.col("resolvable")).select(cols).sort("canonical_key")


def train(frame: pl.DataFrame, kind: str, tmp_dir: Path | None = None, out: Path | None = None) -> Path:
    """Estimate model parameters (seeded) and save the model JSON. Returns the path written."""
    data = _input(frame, kind)
    db = _db_api(tmp_dir)
    df = db.register(data.to_arrow())
    settings = person_settings() if kind == "person" else org_settings()
    linker = Linker(df, settings, log_level=logging.WARNING)
    t = linker.training
    if kind == "person":
        t.estimate_probability_two_random_records_match([block_on("first_name", "last_name", "zip5")], recall=0.7)
        t.estimate_u_using_random_sampling(max_pairs=5e7, seed=SEED)
        # Same full name in the same ZIP3: mostly the same person, so EM's "match" class is the right one.
        t.estimate_parameters_using_expectation_maximisation(block_on("first_name", "last_name", "zip3"))
    else:
        t.estimate_probability_two_random_records_match([block_on("org_name", "zip5")], recall=0.6)
        t.estimate_u_using_random_sampling(max_pairs=5e7, seed=SEED)
        t.estimate_parameters_using_expectation_maximisation(block_on("org_name"))
    path = out or MODELS_DIR / f"{kind}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    linker.misc.save_model_to_json(str(path), overwrite=True)
    _canonicalize(path)
    return path


def _round(x):
    if isinstance(x, float):
        return float(f"{x:.10g}")
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_round(v) for v in x]
    return x


def _canonicalize(path: Path) -> None:
    """Make the saved model byte-identical across seeded retrains: DuckDB's parallel float sums differ in the
    last bits (~1e-15), and Splink stamps a random linker_uid."""
    m = json.loads(path.read_text())
    m.pop("linker_uid", None)
    path.write_text(json.dumps(_round(m), indent=2) + "\n")


# First-name rule for people, applied after scoring (see `predict`).
NAME_RULE_SQL = """
CASE
    WHEN a.gen_suffix <> b.gen_suffix THEN 'conflict'
    WHEN a.title_gender <> b.title_gender THEN 'conflict'
    WHEN a.first_name IS NULL OR b.first_name IS NULL THEN 'ok'
    WHEN a.first_name = b.first_name THEN 'ok'
    WHEN (length(a.first_name) = 1 OR length(b.first_name) = 1)
         AND left(a.first_name, 1) = left(b.first_name, 1) THEN 'ok'
    WHEN jaro_winkler_similarity(a.first_name, b.first_name) >= 0.92 THEN 'ok'
    WHEN jaro_winkler_similarity(a.first_name, b.first_name) >= 0.80 THEN 'weak'
    ELSE 'conflict'
END
"""


def predict(
    frame: pl.DataFrame,
    kind: str,
    floor: float = 0.2,
    tmp_dir: Path | None = None,
    model: Path | None = None,
) -> pl.DataFrame:
    """Score every blocked pair with the saved model.

    Returns pairs with match_probability >= floor: kind, key_l, key_r (key_l < key_r), match_weight,
    match_probability, name_rule.

    `name_rule` (people only; always 'ok' for organizations):
    - 'ok': first names equal, Jaro-Winkler >= 0.92, one is the other's initial, or one is missing.
    - 'weak': Jaro-Winkler 0.80-0.92 (LISA/LOIS, JUSTIN/JUAN, TOM/THOMAS). Never merged; at most "likely".
    - 'conflict': clearly different first names, different generational
      suffixes (JR vs SR), or opposite titles (MR vs MRS/MS). Never merged and never "likely". Without this rule,
      relatives and coworkers at one address with one employer score high (two correctional officers named
      LOPEZ in West Sacramento, a married couple at one company).
    """
    data = _input(frame, kind)
    db = _db_api(tmp_dir)
    df = db.register(data.to_arrow())
    linker = Linker(df, str(model or MODELS_DIR / f"{kind}.json"), log_level=logging.WARNING)
    pred = linker.inference.predict(threshold_match_probability=floor)
    con = db._con
    names = frame.filter(pl.col("kind") == kind).select("canonical_key", "first_name", "gen_suffix", "title_gender")
    con.register("names_in", names.to_arrow())
    rule = NAME_RULE_SQL if kind == "person" else "'ok'"
    out = pl.from_arrow(
        con.sql(
            f"""
            SELECT least(p.canonical_key_l, p.canonical_key_r) AS key_l,
                   greatest(p.canonical_key_l, p.canonical_key_r) AS key_r,
                   p.match_weight, p.match_probability, {rule} AS name_rule
            FROM {pred.physical_name} p
            JOIN names_in a ON a.canonical_key = p.canonical_key_l
            JOIN names_in b ON b.canonical_key = p.canonical_key_r
            """
        ).to_arrow_table()
    )
    assert isinstance(out, pl.DataFrame)
    return (
        out.with_columns(kind=pl.lit(kind))
        .select("kind", "key_l", "key_r", "match_weight", "match_probability", "name_rule")
        .sort("key_l", "key_r")
    )
