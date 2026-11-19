"""Loader against a throwaway Postgres built from packages/db/drizzle/0000_init.sql.

Skips unless TEST_DATABASE_URL is set. The test truncates `entity` (cascades to aliases), so never point it at
a real database.
"""

import json
import os

import polars as pl
import pytest

from aletheia_resolve import load, normalize
from aletheia_resolve.cluster import cluster

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def db(raw_sample):
    import psycopg

    with psycopg.connect(URL) as con:
        con.execute("TRUNCATE entity CASCADE")
        for r in raw_sample.iter_rows(named=True):
            attrs = {k: r[k] for k in ("entity_cd", "city", "state", "zip", "employer", "occupation")}
            attrs |= {"source": "calaccess", "temporary": True}
            con.execute(
                "INSERT INTO entity (id, kind, name, canonical_key, attrs) VALUES (md5(%s)::uuid, %s, %s, %s, %s)",
                (r["canonical_key"], r["kind"], r["name"], r["canonical_key"], json.dumps(attrs)),
            )
            con.execute(
                "INSERT INTO entity_alias (id, entity_id, raw_name, source, source_row_id, method) "
                "VALUES (md5(%s || ':alias')::uuid, md5(%s)::uuid, %s, 'calaccess', %s, 'raw')",
                (r["canonical_key"], r["canonical_key"], r["name"], r["row_ref"]),
            )
        con.commit()
    yield URL


def _resolution(raw_sample, out):
    f = normalize.normalize_frame(raw_sample)
    key = dict(f.select("name", "canonical_key").iter_rows())
    a, b, m = key["John A. Sobrato"], key["John Albert Sobrato"], key["John M. Sobrato"]
    h1, h2 = key["Hal Robertson Farms LLC"], key["HAL ROBERTSON FARMS"]
    pairs = pl.DataFrame(
        [
            ("person", *sorted([a, b]), 0.99, "ok"),
            ("person", *sorted([a, m]), 0.85, "ok"),
            ("org", *sorted([h1, h2]), 0.99, "ok"),
        ],
        schema=["kind", "key_l", "key_r", "match_probability", "name_rule"],
        orient="row",
    )
    ms, ls = [], []
    for kind in ("person", "org", "committee"):
        ents = f.filter(pl.col("kind") == kind).select("canonical_key", "kind", "first_name", "middle_name", "gen_suffix")
        mm, ll = cluster(ents, pairs.filter(pl.col("kind") == kind), 0.95, 0.80)
        ms.append(mm)
        ls.append(ll)
    pl.concat(ms).write_parquet(out / "members.parquet")
    pl.concat(ls).write_parquet(out / "likely_links.parquet")
    return a, b, m, h1, h2


def _attrs(url, key):
    import psycopg

    with psycopg.connect(url) as con:
        return con.execute("SELECT attrs FROM entity WHERE canonical_key = %s", (key,)).fetchone()[0]


def _splink_aliases(url):
    import psycopg

    with psycopg.connect(url) as con:
        return con.execute("SELECT count(*) FROM entity_alias WHERE method = 'splink'").fetchone()[0]


def test_load_is_additive_and_idempotent(db, raw_sample, tmp_path) -> None:
    a, b, m, h1, h2 = _resolution(raw_sample, tmp_path)

    dry = load.load(db, tmp_path, dry_run=True)
    assert dry["entities_marked"] == 4 and dry["committed"] == 0
    assert "resolved_entity_key" not in _attrs(db, a)

    s1 = load.load(db, tmp_path)
    assert s1 == {**s1, "entities_marked": 4, "aliases_added": 2, "likely_entities_marked": 2, "committed": 1}
    root = min(a, b)
    for k in (a, b):
        at = _attrs(db, k)
        assert at["resolved_entity_key"] == root
        assert at["confidence"] == "high"
        assert at["temporary"] is True  # existing attrs kept
    links = _attrs(db, m)["likely_same_donor"]
    assert links == [{"entity_key": root, "match_probability": 0.85, "label": "likely the same donor"}]
    assert _attrs(db, min(h1, h2))["resolved_member_count"] == 2

    s2 = load.load(db, tmp_path)  # rerun replaces, never accumulates
    assert s2["aliases_cleared"] == 2 and s2["aliases_added"] == 2
    assert _splink_aliases(db) == 2


def test_load_refuses_other_data(db, raw_sample, tmp_path) -> None:
    _resolution(raw_sample, tmp_path)
    members = pl.read_parquet(tmp_path / "members.parquet")
    fake = members.with_columns(canonical_key=pl.lit("calaccess:raw:") + pl.col("canonical_key").str.slice(14).str.reverse())
    pl.concat([members, fake, fake.with_columns(canonical_key=pl.col("canonical_key") + "x")]).write_parquet(
        tmp_path / "members.parquet"
    )
    with pytest.raises(SystemExit, match="raw entities"):
        load.load(db, tmp_path)
