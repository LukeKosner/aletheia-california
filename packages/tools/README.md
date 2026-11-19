# @aletheia/tools

The MCP server agents use to read data. It is the only way agents touch the database (AGENTS.md rule 4). Mounted at
`/api/mcp` in `apps/web` (`apps/web/src/app/api/mcp/route.ts`).

- Transport: MCP streamable HTTP, official TypeScript SDK v2 (`@modelcontextprotocol/server`). Serves the 2026-07-28
  per-request protocol and, statelessly, 2025-era clients. A fresh server is built per request.
- Auth: `Authorization: Bearer $MCP_BEARER_TOKEN`. With the variable unset every request gets 503.
- `cite` needs `X-Aletheia-Investigation-Id: <investigation uuid>`.

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `query` | `sql` | One read-only SELECT/VALUES/WITH over the six views, at most 500 rows, 10 s timeout |
| `trace_money` | `entity_id`, `direction` (`up` = sources, `down` = recipients), `max_depth` 1–5, `min_amount` | Paths with entity ids and hops carrying edge ids; the edges with amount, date, schedule, line, filing |
| `get_filing` | `filing_id` (uuid or CAL-ACCESS filing id) | Form, filed date, period, PDF URL, and every itemized line: schedule, line, amount, parties |
| `vote_base_rate` | `bill_id` (uuid or `SB 329`), `motion` (substring, empty = all) | Each roll call's counts and every member's vote |
| `cite` | `sentence`, `edge_ids` | Inserts a `claim` row and returns its id |

Free text that comes from filings (names, motions, bill titles, entity `attrs`) is returned as
`{"untrusted_text": "..."}`. In `query` results every text or JSON value is wrapped unless it comes straight from a
column listed in `STRUCTURED_COLUMNS` (`src/untrusted.ts`: codes, keys, ids and URLs built by the loaders).

`trace_money` follows at most 10 counterparties per entity (largest single edge first) and returns at most 500 path
prefixes. Each hop lists all edges between the two entities, because one contribution is often reported on several
schedules (F497P1, F497P2, Form 460 Schedule A, and the giver's Schedule E or D). Never add amounts across schedules.

## Database access

| Role | Can | Used by |
| --- | --- | --- |
| `agent_ro` | SELECT on `v_money`, `v_lobby`, `v_votes`, `v_bill_authors`, `v_entities`, `v_interests`; 10 s statement timeout; read-only by default | every read, including agent SQL |
| `claim_writer` | INSERT on `claim` | `cite` only, with SQL the server writes |

The views and both roles are defined in `packages/db/src/schema.ts` (migration `0001_agent_views`). The views run
with their owner's rights, so `agent_ro` never needs access to a table. Agent SQL is wrapped in
`select * from (...) limit 501`, sent over the extended protocol (one statement only), inside a `READ ONLY`
transaction with `SET LOCAL statement_timeout`. The grants are the real boundary; the rest is defense in depth.
`agent_ro` can still read the system catalogs (`pg_catalog`, `information_schema`), as every Postgres role can.

## Setup (human step)

drizzle-kit creates the roles and views (`bun run db:push`), but it cannot express GRANTs, LOGIN or role settings.
After pushing, run as the database owner:

```bash
psql "$DATABASE_URL" -f packages/tools/sql/grants.sql
psql "$DATABASE_URL" -c "alter role agent_ro password '<long random>'"
psql "$DATABASE_URL" -c "alter role claim_writer password '<another long random>'"
```

Then set, wherever the web app runs:

```bash
AGENT_RO_DATABASE_URL=postgres://agent_ro:<password>@<host>/<db>?sslmode=require
CLAIM_WRITER_DATABASE_URL=postgres://claim_writer:<password>@<host>/<db>?sslmode=require
MCP_BEARER_TOKEN=<long random>
```

## Tests

```bash
bun test packages/tools                      # unit tests; database tests skip
TOOLS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres bun test packages/tools
```

`TOOLS_TEST_DATABASE_URL` must be a superuser on a local throwaway cluster (the harness refuses any other host). It
creates a database, applies the migrations and `sql/grants.sql`, and loads real rows: a CAL-ACCESS slice
(`test/fixtures/calaccess_slice.json`, exported by `test/fixtures/export_calaccess_slice.py`) and the SB 329 roll
calls from `py/ingest/tests/leginfo/fixtures/pubinfo_votes_sample.csv`. Run one test process at a time per cluster:
the harness drops leftover `aletheia_tools_test_*` databases and recreates the cluster-wide roles.
