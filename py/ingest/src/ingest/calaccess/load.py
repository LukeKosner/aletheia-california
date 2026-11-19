"""Write the out_* tables from DuckDB into Postgres, idempotently, in one transaction.

- Rows carry deterministic ids, so a rerun updates in place and inserts nothing new.
- entity is upserted on canonical_key; edges and lobby rows find entity ids through canonical_key, so an
  entity created earlier by someone else under the same key is reused, not duplicated.
- filing is upserted on (source, filing_id, amendment_no). When a filing gets a newer amendment, the older
  version's filing row and its money_edge / lobby_activity rows are deleted.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import duckdb
import psycopg

BATCH = 50_000


def _rows(con: duckdb.DuckDBPyConnection, sql: str) -> Iterator[tuple]:
    cur = con.execute(sql)
    while True:
        batch = cur.fetchmany(BATCH)
        if not batch:
            return
        yield from batch


def _copy(pg: psycopg.Connection, table: str, cols: list[str], rows: Iterator[tuple]) -> int:
    n = 0
    with pg.cursor().copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)
            n += 1
    return n


def load(con: duckdb.DuckDBPyConnection, database_url: str, *, full: bool) -> dict[str, int]:
    """`full` is True when the out_* tables hold every CAL-ACCESS filing (no --since filter); only then are
    CAL-ACCESS filings missing from this export deleted."""
    stats: dict[str, int] = {}
    t0 = time.time()
    with psycopg.connect(database_url, autocommit=False) as pg:
        x = pg.execute
        x("SET LOCAL synchronous_commit = off")
        x(
            """
            CREATE TEMP TABLE s_entity (id uuid, kind text, name text, canonical_key text PRIMARY KEY, attrs jsonb)
                ON COMMIT DROP;
            CREATE TEMP TABLE s_alias (id uuid PRIMARY KEY, entity_key text, raw_name text, source text,
                source_row_id text, method text) ON COMMIT DROP;
            CREATE TEMP TABLE s_filing (id uuid, source text, filing_id text, amendment_no int, form text,
                filed_at timestamp, period_start date, period_end date, url text, raw_sha256 text,
                PRIMARY KEY (filing_id)) ON COMMIT DROP;
            CREATE TEMP TABLE s_edge (id uuid PRIMARY KEY, from_key text, to_key text, amount numeric(14,2),
                date date, kind text, filing_id text, amend_id int, schedule text, line_item text) ON COMMIT DROP;
            CREATE TEMP TABLE s_lobby (id uuid PRIMARY KEY, employer_key text, firm_key text, period_start date,
                period_end date, amount numeric(14,2), filing_id text, amend_id int, bills text[]) ON COMMIT DROP;
            """
        )
        stats["staged_entity"] = _copy(
            pg, "s_entity", ["id", "kind", "name", "canonical_key", "attrs"],
            _rows(con, "SELECT id, kind, name, canonical_key, CAST(attrs AS VARCHAR) FROM out_entity"),
        )
        stats["staged_alias"] = _copy(
            pg, "s_alias", ["id", "entity_key", "raw_name", "source", "source_row_id", "method"],
            _rows(con, "SELECT id, entity_key, raw_name, source, source_row_id, method FROM out_entity_alias"),
        )
        stats["staged_filing"] = _copy(
            pg, "s_filing",
            ["id", "source", "filing_id", "amendment_no", "form", "filed_at", "period_start", "period_end", "url",
             "raw_sha256"],
            _rows(con, "SELECT id, source, filing_id, amendment_no, form, filed_at, period_start, period_end, url,"
                       " raw_sha256 FROM out_filing"),
        )
        stats["staged_edge"] = _copy(
            pg, "s_edge",
            ["id", "from_key", "to_key", "amount", "date", "kind", "filing_id", "amend_id", "schedule", "line_item"],
            _rows(con, "SELECT id, from_key, to_key, amount, date, kind, filing_id, amend_id, schedule, line_item"
                       " FROM out_money_edge"),
        )
        stats["staged_lobby"] = _copy(
            pg, "s_lobby",
            ["id", "employer_key", "firm_key", "period_start", "period_end", "amount", "filing_id", "amend_id",
             "bills"],
            _rows(con, "SELECT id, employer_key, firm_key, period_start, period_end, amount, filing_id, amend_id,"
                       " bills FROM out_lobby_activity"),
        )
        print(f"[load] staged in Postgres in {time.time() - t0:.0f}s: {stats}", flush=True)
        x("ANALYZE s_entity; ANALYZE s_alias; ANALYZE s_filing; ANALYZE s_edge; ANALYZE s_lobby")

        def run(label: str, *statements: str) -> None:
            t = time.time()
            n = sum(x(sql).rowcount for sql in statements)
            stats[label] = n
            print(f"[load] {label}: {n:,} rows ({time.time() - t:.0f}s)", flush=True)

        # ---- entities ----
        run(
            "entity_upserted",
            """
            INSERT INTO entity (id, kind, name, canonical_key, attrs)
            SELECT id, kind::entity_kind, name, canonical_key, attrs FROM s_entity
            ON CONFLICT (canonical_key) DO UPDATE
                SET kind = EXCLUDED.kind, name = EXCLUDED.name, attrs = EXCLUDED.attrs
                WHERE (entity.kind, entity.name, entity.attrs) IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.name, EXCLUDED.attrs)
            """,
        )
        x(
            """
            CREATE TEMP TABLE keymap ON COMMIT DROP AS
            SELECT e.canonical_key AS key, e.id FROM entity e JOIN s_entity s USING (canonical_key);
            ALTER TABLE keymap ADD PRIMARY KEY (key);
            ANALYZE keymap;
            """
        )
        run(
            "entity_alias_upserted",
            """
            INSERT INTO entity_alias (id, entity_id, raw_name, source, source_row_id, method)
            SELECT a.id, k.id, a.raw_name, a.source, a.source_row_id, a.method
            FROM s_alias a JOIN keymap k ON k.key = a.entity_key
            ON CONFLICT (id) DO UPDATE
                SET entity_id = EXCLUDED.entity_id, raw_name = EXCLUDED.raw_name, source_row_id = EXCLUDED.source_row_id
                WHERE (entity_alias.entity_id, entity_alias.raw_name, entity_alias.source_row_id)
                    IS DISTINCT FROM (EXCLUDED.entity_id, EXCLUDED.raw_name, EXCLUDED.source_row_id)
            """,
        )

        # ---- filings ----
        run(
            "filing_upserted",
            """
            INSERT INTO filing (id, source, filing_id, amendment_no, form, filed_at, period_start, period_end, url,
                                raw_sha256)
            SELECT id, source, filing_id, amendment_no, form, filed_at AT TIME ZONE 'America/Los_Angeles',
                   period_start, period_end, url, raw_sha256
            FROM s_filing
            ON CONFLICT (source, filing_id, amendment_no) DO UPDATE
                SET form = EXCLUDED.form, filed_at = EXCLUDED.filed_at, period_start = EXCLUDED.period_start,
                    period_end = EXCLUDED.period_end, url = EXCLUDED.url, raw_sha256 = EXCLUDED.raw_sha256
                WHERE (filing.form, filing.filed_at, filing.period_start, filing.period_end, filing.url)
                    IS DISTINCT FROM (EXCLUDED.form, EXCLUDED.filed_at, EXCLUDED.period_start, EXCLUDED.period_end,
                                      EXCLUDED.url)
            """,
        )
        x(
            """
            CREATE TEMP TABLE filingmap ON COMMIT DROP AS
            SELECT f.filing_id, f.amendment_no, f.id FROM filing f JOIN s_filing s USING (filing_id, amendment_no)
            WHERE f.source = 'calaccess';
            ALTER TABLE filingmap ADD PRIMARY KEY (filing_id, amendment_no);
            CREATE UNIQUE INDEX ON filingmap (id);
            ANALYZE filingmap;
            """
        )
        # Filing rows this run replaces: older amendments of filings in this export and, on a full run,
        # CAL-ACCESS filings no longer in the export at all.
        x(
            f"""
            CREATE TEMP TABLE stale_filing ON COMMIT DROP AS
            SELECT f.id FROM filing f
            WHERE f.source = 'calaccess'
              AND NOT EXISTS (SELECT 1 FROM filingmap m WHERE m.id = f.id)
              AND ({'TRUE' if full else 'FALSE'} OR EXISTS (SELECT 1 FROM s_filing s WHERE s.filing_id = f.filing_id));
            ANALYZE stale_filing;
            """
        )

        # Keep stale-filing and current-filing cleanup as separate joins. An OR of IN subqueries
        # prevents semi/anti-join planning; at full-export size, a UUID membership subplan can
        # exceed work_mem and repeatedly materialize filingmap for every money/lobby row.
        # Both maps contain only CAL-ACCESS filings, so other sources remain outside cleanup.

        # ---- money edges ----
        run(
            "money_edge_upserted",
            """
            INSERT INTO money_edge (id, from_entity, to_entity, amount, date, kind, filing_id, schedule, line_item)
            SELECT e.id, kf.id, kt.id, e.amount, e.date, e.kind::money_edge_kind, fm.id, e.schedule, e.line_item
            FROM s_edge e
            JOIN keymap kf ON kf.key = e.from_key
            JOIN keymap kt ON kt.key = e.to_key
            JOIN filingmap fm ON fm.filing_id = e.filing_id AND fm.amendment_no = e.amend_id
            ON CONFLICT (id) DO UPDATE
                SET from_entity = EXCLUDED.from_entity, to_entity = EXCLUDED.to_entity, amount = EXCLUDED.amount,
                    date = EXCLUDED.date, kind = EXCLUDED.kind, filing_id = EXCLUDED.filing_id,
                    schedule = EXCLUDED.schedule, line_item = EXCLUDED.line_item
                WHERE (money_edge.from_entity, money_edge.to_entity, money_edge.amount, money_edge.date,
                       money_edge.kind, money_edge.filing_id, money_edge.schedule, money_edge.line_item)
                    IS DISTINCT FROM (EXCLUDED.from_entity, EXCLUDED.to_entity, EXCLUDED.amount, EXCLUDED.date,
                       EXCLUDED.kind, EXCLUDED.filing_id, EXCLUDED.schedule, EXCLUDED.line_item)
            """,
        )
        run(
            "money_edge_deleted",
            """
            DELETE FROM money_edge m
            USING stale_filing f
            WHERE m.filing_id = f.id
            """,
            """
            DELETE FROM money_edge m
            USING filingmap f
            WHERE m.filing_id = f.id
              AND NOT EXISTS (SELECT 1 FROM s_edge s WHERE s.id = m.id)
            """,
        )

        # ---- lobbying ----
        run(
            "lobby_activity_upserted",
            """
            INSERT INTO lobby_activity (id, employer_entity, firm_entity, period_start, period_end, amount, filing_id,
                                        bills)
            SELECT l.id, ke.id, kf.id, l.period_start, l.period_end, l.amount, fm.id, l.bills
            FROM s_lobby l
            JOIN keymap ke ON ke.key = l.employer_key
            LEFT JOIN keymap kf ON kf.key = l.firm_key
            JOIN filingmap fm ON fm.filing_id = l.filing_id AND fm.amendment_no = l.amend_id
            ON CONFLICT (id) DO UPDATE
                SET employer_entity = EXCLUDED.employer_entity, firm_entity = EXCLUDED.firm_entity,
                    period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, amount = EXCLUDED.amount,
                    filing_id = EXCLUDED.filing_id, bills = EXCLUDED.bills
                WHERE (lobby_activity.employer_entity, lobby_activity.firm_entity, lobby_activity.period_start,
                       lobby_activity.period_end, lobby_activity.amount, lobby_activity.filing_id, lobby_activity.bills)
                    IS DISTINCT FROM (EXCLUDED.employer_entity, EXCLUDED.firm_entity, EXCLUDED.period_start,
                       EXCLUDED.period_end, EXCLUDED.amount, EXCLUDED.filing_id, EXCLUDED.bills)
            """,
        )
        run(
            "lobby_activity_deleted",
            """
            DELETE FROM lobby_activity a
            USING stale_filing f
            WHERE a.filing_id = f.id
            """,
            """
            DELETE FROM lobby_activity a
            USING filingmap f
            WHERE a.filing_id = f.id
              AND NOT EXISTS (SELECT 1 FROM s_lobby s WHERE s.id = a.id)
            """,
        )
        run("filing_deleted", "DELETE FROM filing f USING stale_filing s WHERE f.id = s.id")

        # Every staged edge and lobby row must have landed; a silent join miss would lose money.
        missing = x(
            "SELECT (SELECT count(*) FROM s_edge e WHERE NOT EXISTS (SELECT 1 FROM money_edge m WHERE m.id = e.id)),"
            " (SELECT count(*) FROM s_lobby l WHERE NOT EXISTS (SELECT 1 FROM lobby_activity a WHERE a.id = l.id))"
        ).fetchone()
        if missing != (0, 0):
            raise RuntimeError(f"rows failed to load (edges, lobby): {missing}; rolling back")
        pg.commit()
    print(f"[load] committed in {time.time() - t0:.0f}s", flush=True)
    return stats
