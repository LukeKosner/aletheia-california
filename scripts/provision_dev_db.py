"""One-time dev database setup (human step, AGENTS.md "Dev database").

Run from py/ingest so psycopg is available:

    cd py/ingest && uv run python ../../scripts/provision_dev_db.py

What it does, in one transaction, as the database owner from packages/db/.env:
  - creates the agent views from migration 0001 (v_money, v_lobby, v_votes, v_entities, v_interests)
  - applies migration 0002 (auth tables) if they are missing
  - creates eight least-privilege login roles and their grants (packages/tools/sql/grants.sql plus the
    grants listed in agents/README.md, apps/web/src/app/(auth)/README.md and
    apps/web/src/components/feedback/INTEGRATION.md)
  - sets a fresh random password on each role and writes the eight connection strings, plus
    MCP_BEARER_TOKEN and BETTER_AUTH_SECRET if absent, to apps/web/.env.local (gitignored)

Re-running is safe: it rotates the role passwords and rewrites the local env file. No secret is printed.
"""

import re
import secrets
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
ROLES = [
    "agent_ro",
    "claim_writer",
    "investigation_runtime",
    "auth_server",
    "event_writer",
    "game_reader",
    "corrections_reader",
    "corrections_writer",
]
GRANTS = [
    "grant select, insert, update on investigation to investigation_runtime",
    "grant select on claim to investigation_runtime",
    "grant select (name, props) on event to investigation_runtime",
    "grant select, insert, update, delete on auth_user, auth_session, auth_account, auth_verification,"
    " auth_rate_limit to auth_server",
    "grant insert on event to event_writer",
    "grant select on event, investigation, claim, card, correction to game_reader",
    "grant select on correction, card, investigation, event, filing, money_edge to corrections_reader",
    "grant select, insert on feedback, correction to corrections_writer",
    "grant select on card, investigation, claim to corrections_writer",
    "grant update (status, resolution) on correction to corrections_writer",
    "grant update (published) on card to corrections_writer",
    "grant update (status) on investigation to corrections_writer",
    "grant update (sentence, edge_ids, filing_ids, confidence, verdict, verifier_model) on claim"
    " to corrections_writer",
    "grant insert on event to corrections_writer",
]


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
    passwords = {role: secrets.token_urlsafe(32) for role in ROLES}

    with psycopg.connect(owner_url) as conn:
        cur = conn.cursor()
        cur.execute("select rolname from pg_roles")
        existing = {row[0] for row in cur.fetchall()}
        for role in ROLES:
            if role not in existing:
                cur.execute(sql.SQL("create role {}").format(sql.Identifier(role)))

        for statement in statements(ROOT / "packages/db/drizzle/0001_agent_views.sql"):
            if statement.upper().startswith("CREATE ROLE"):
                continue
            cur.execute(statement.replace("CREATE VIEW", "CREATE OR REPLACE VIEW", 1))

        cur.execute("select to_regclass('public.auth_user')")
        if cur.fetchone()[0] is None:
            for statement in statements(ROOT / "packages/db/drizzle/0002_mysterious_sir_ram.sql"):
                cur.execute(statement)
            print("applied 0002 auth tables")
        else:
            print("auth tables already present")

        for chunk in (ROOT / "packages/tools/sql/grants.sql").read_text().split(";"):
            body = "\n".join(l for l in chunk.splitlines() if not l.strip().startswith("--")).strip()
            if body:
                # Neon's owner role is not a superuser and may not name these attributes; new roles
                # already default to NOSUPERUSER, NOREPLICATION and NOBYPASSRLS.
                cur.execute(re.sub(r"\s+(nosuperuser|noreplication|nobypassrls)\b", "", body))

        for role in ROLES[2:]:
            ident = sql.Identifier(role)
            cur.execute(
                sql.SQL(
                    "alter role {} with login nocreatedb nocreaterole noinherit"
                ).format(ident)
            )
            cur.execute(sql.SQL("alter role {} set statement_timeout = '10s'").format(ident))
            cur.execute(sql.SQL("alter role {} set search_path = public").format(ident))
            cur.execute(sql.SQL("revoke all on all tables in schema public from {}").format(ident))
            cur.execute(sql.SQL("revoke create on schema public from {}").format(ident))
            cur.execute(sql.SQL("grant usage on schema public to {}").format(ident))
        for role in ("game_reader", "corrections_reader"):
            cur.execute(sql.SQL("alter role {} set default_transaction_read_only = on").format(sql.Identifier(role)))
        for grant in GRANTS:
            cur.execute(grant)
        for role in ROLES:
            cur.execute(
                sql.SQL("alter role {} password {}").format(sql.Identifier(role), sql.Literal(passwords[role]))
            )
        conn.commit()
        cur.execute("select table_name from information_schema.views where table_schema = 'public' order by 1")
        print("views:", [row[0] for row in cur.fetchall()])

    parts = urlsplit(pooled_url)

    def role_url(role: str) -> str:
        host = parts.hostname + (f":{parts.port}" if parts.port else "")
        return urlunsplit((parts.scheme, f"{role}:{quote(passwords[role])}@{host}", parts.path, parts.query, ""))

    new = {
        "AGENT_RO_DATABASE_URL": role_url("agent_ro"),
        "CLAIM_WRITER_DATABASE_URL": role_url("claim_writer"),
        "INVESTIGATION_DATABASE_URL": role_url("investigation_runtime"),
        "AUTH_DATABASE_URL": role_url("auth_server"),
        "EVENT_WRITER_DATABASE_URL": role_url("event_writer"),
        "GAME_READER_DATABASE_URL": role_url("game_reader"),
        "CORRECTIONS_READER_DATABASE_URL": role_url("corrections_reader"),
        "CORRECTIONS_WRITER_DATABASE_URL": role_url("corrections_writer"),
    }
    env_path = ROOT / "apps/web/.env.local"
    current = read_env(env_path) if env_path.exists() else {}
    for key in ("MCP_BEARER_TOKEN", "BETTER_AUTH_SECRET"):
        if key not in current:
            new[key] = secrets.token_urlsafe(48)
    kept = [
        line
        for line in (env_path.read_text().splitlines() if env_path.exists() else [])
        if not any(line.startswith(key + "=") for key in new)
    ]
    env_path.write_text("\n".join(kept + [f'{key}="{value}"' for key, value in new.items()]) + "\n")
    print("wrote to apps/web/.env.local:", sorted(new))


if __name__ == "__main__":
    main()
