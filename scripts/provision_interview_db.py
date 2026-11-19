"""One-time setup for the voter-interview prototype (human step, AGENTS.md "Dev database").

Run from py/ingest so psycopg is available:

    cd py/ingest && uv run python ../../scripts/provision_interview_db.py

What it does, in one transaction, as the database owner from packages/db/.env:
  - applies packages/db/drizzle/0004_interview_schema.sql if the `interview` schema is missing
    (a separate Postgres schema; nothing in `public` is created, changed or dropped), then each later
    interview migration (0005 studies, 0006 reward email, 0007 study fields and session profile) whose
    table or column is missing
  - creates the `interview_app` login role with SELECT, INSERT and UPDATE on the five interview tables
    and no rights anywhere else (no DELETE, no access to `public` tables)
  - sets a fresh random password and writes INTERVIEW_DATABASE_URL to apps/web/.env.local (gitignored)

Re-running is safe: it rotates the role password and rewrites that one line. No secret is printed.
With --migrate-only it applies missing migrations and stops: no role change, no password rotation.
"""

import re
import sys
import secrets
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
ROLE = "interview_app"
TABLES = ["session", "research", "payment", "payout", "study"]


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        match = re.match(r"^(?:export )?([A-Za-z0-9_]+)=(.*)$", line.strip())
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return values


def statements(path: Path) -> list[str]:
    return [s.strip() for s in path.read_text().split("--> statement-breakpoint") if s.strip()]


def main() -> None:
    db_env = read_env(ROOT / "packages/db/.env")
    owner_url, pooled_url = db_env["DATABASE_URL_UNPOOLED"], db_env["DATABASE_URL"]
    password = secrets.token_urlsafe(32)
    ident = sql.Identifier(ROLE)

    with psycopg.connect(owner_url) as conn:
        cur = conn.cursor()
        cur.execute("select 1 from information_schema.schemata where schema_name = 'interview'")
        if cur.fetchone() is None:
            for statement in statements(ROOT / "packages/db/drizzle/0004_interview_schema.sql"):
                cur.execute(statement)
            print("applied 0004 interview schema")
        else:
            print("interview schema already present")
        cur.execute("select to_regclass('interview.study')")
        if cur.fetchone()[0] is None:
            for statement in statements(ROOT / "packages/db/drizzle/0005_interview_studies.sql"):
                cur.execute(statement)
            print("applied 0005 interview studies")
        cur.execute(
            "select 1 from information_schema.columns where table_schema = 'interview' and table_name = 'session' and column_name = 'reward_email'"
        )
        if cur.fetchone() is None:
            for statement in statements(ROOT / "packages/db/drizzle/0006_interview_reward_email.sql"):
                cur.execute(statement)
            print("applied 0006 reward email")
        cur.execute(
            "select 1 from information_schema.columns where table_schema = 'interview' and table_name = 'session' and column_name = 'profile'"
        )
        if cur.fetchone() is None:
            for statement in statements(ROOT / "packages/db/drizzle/0007_keen_forgotten_one.sql"):
                cur.execute(statement)
            print("applied 0007 study fields, sizes and session profile")
        else:
            print("0007 study fields already present")
        if "--migrate-only" in sys.argv[1:]:
            conn.commit()
            print("migrations applied; role and password unchanged")
            return

        cur.execute("select 1 from pg_roles where rolname = %s", (ROLE,))
        if cur.fetchone() is None:
            cur.execute(sql.SQL("create role {}").format(ident))
        cur.execute(sql.SQL("alter role {} with login nocreatedb nocreaterole noinherit").format(ident))
        cur.execute(sql.SQL("alter role {} set statement_timeout = '10s'").format(ident))
        cur.execute(sql.SQL("alter role {} set search_path = interview").format(ident))
        cur.execute(sql.SQL("revoke all on all tables in schema public from {}").format(ident))
        cur.execute(sql.SQL("revoke create on schema public from {}").format(ident))
        cur.execute(sql.SQL("grant usage on schema interview to {}").format(ident))
        for table in TABLES:
            cur.execute(
                sql.SQL("grant select, insert, update on {} to {}").format(sql.Identifier("interview", table), ident)
            )
        cur.execute(sql.SQL("alter role {} password {}").format(ident, sql.Literal(password)))
        conn.commit()

    parts = urlsplit(pooled_url)
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    url = urlunsplit((parts.scheme, f"{ROLE}:{quote(password)}@{host}", parts.path, parts.query, ""))

    env_path = ROOT / "apps/web/.env.local"
    kept = [
        line
        for line in (env_path.read_text().splitlines() if env_path.exists() else [])
        if not line.startswith("INTERVIEW_DATABASE_URL=")
    ]
    env_path.write_text("\n".join(kept + [f'INTERVIEW_DATABASE_URL="{url}"']) + "\n")
    print("wrote INTERVIEW_DATABASE_URL to apps/web/.env.local")


if __name__ == "__main__":
    main()
