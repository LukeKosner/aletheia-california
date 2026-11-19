"""Loader cleanup regression tests using real CAL-ACCESS records.

The fixture records the export URL, SHA-256 and filing IDs. Tests deliberately
omit existing real rows to exercise corrected-export cleanup; no public facts
are invented. A dedicated, localhost-only Postgres URL is required.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import duckdb
import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from ingest.calaccess.load import load

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((Path(__file__).parent / "fixtures/calaccess_load_slice.json").read_text())
TEST_URL = os.environ.get("CALACCESS_LOAD_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_URL, reason="no dedicated local loader test database")


@pytest.fixture
def database():
    assert TEST_URL
    host = conninfo_to_dict(TEST_URL).get("host")
    assert host in {"127.0.0.1", "localhost", "::1"}, "loader tests refuse nonlocal databases"
    name = "calaccess_cleanup_" + uuid.uuid4().hex
    with psycopg.connect(TEST_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    url = make_conninfo(TEST_URL, dbname=name)
    try:
        with psycopg.connect(url) as pg:
            pg.execute((ROOT / "packages/db/drizzle/0000_init.sql").read_text())
        yield url
    finally:
        with psycopg.connect(TEST_URL, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def stage(filing_ids=None, omitted_edges=(), omitted_lobby=()):
    con = duckdb.connect()
    for table, fixture in FIXTURE["tables"].items():
        columns = [(c[0], c[1]) for c in fixture["schema"]]
        con.execute(f"CREATE TABLE {table} (" + ",".join(f'"{n}" {t}' for n, t in columns) + ")")
        values = []
        for record in fixture["rows"]:
            if filing_ids is not None and table in {"out_filing", "out_money_edge", "out_lobby_activity"}:
                if record["filing_id"] not in filing_ids:
                    continue
            if table == "out_money_edge" and record["id"] in omitted_edges:
                continue
            if table == "out_lobby_activity" and record["id"] in omitted_lobby:
                continue
            values.append(tuple(record[n] for n, _ in columns))
        if values:
            con.executemany(f"INSERT INTO {table} VALUES (" + ",".join("?" for _ in columns) + ")", values)
    return con


def ids(database, table):
    with psycopg.connect(database) as pg:
        return {str(r[0]) for r in pg.execute(sql.SQL("SELECT id FROM {}").format(sql.Identifier(table)))}


def test_current_filing_removes_only_omitted_money_and_lobby(database):
    initial = stage()
    load(initial, database, full=True)
    edge = FIXTURE["tables"]["out_money_edge"]["rows"][0]["id"]
    lobby = FIXTURE["tables"]["out_lobby_activity"]["rows"][0]["id"]
    before_edges, before_lobby = ids(database, "money_edge"), ids(database, "lobby_activity")
    corrected = stage(omitted_edges={edge}, omitted_lobby={lobby})
    stats = load(corrected, database, full=False)
    assert stats["money_edge_deleted"] == 1
    assert stats["lobby_activity_deleted"] == 1
    assert ids(database, "money_edge") == before_edges - {edge}
    assert ids(database, "lobby_activity") == before_lobby - {lobby}
    assert stats["filing_deleted"] == 0
    rerun = load(corrected, database, full=False)
    assert all(value == 0 for key, value in rerun.items() if not key.startswith("staged_"))


def test_partial_retains_unseen_filings_full_removes_them(database):
    initial = stage()
    load(initial, database, full=True)
    kept = {FIXTURE["source"]["filing_ids"][0]}
    partial = stage(filing_ids=kept)
    before_filings = ids(database, "filing")
    before_edges = ids(database, "money_edge")
    before_lobby = ids(database, "lobby_activity")
    stats = load(partial, database, full=False)
    assert stats["filing_deleted"] == 0
    assert ids(database, "filing") == before_filings
    assert ids(database, "money_edge") == before_edges
    assert ids(database, "lobby_activity") == before_lobby
    stats = load(partial, database, full=True)
    assert stats["filing_deleted"] == len(before_filings) - len(kept)
    for table, fixture_table in [("filing", "out_filing"), ("money_edge", "out_money_edge"),
                                  ("lobby_activity", "out_lobby_activity")]:
        expected = {r["id"] for r in FIXTURE["tables"][fixture_table]["rows"] if r["filing_id"] in kept}
        assert ids(database, table) == expected
