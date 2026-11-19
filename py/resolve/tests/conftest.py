from pathlib import Path

import polars as pl
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "calaccess_raw_sample.csv"


@pytest.fixture(scope="session")
def raw_sample() -> pl.DataFrame:
    return pl.read_csv(FIXTURE, infer_schema=False)
