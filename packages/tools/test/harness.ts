/**
 * Throwaway Postgres for the tools tests.
 *
 * Set TOOLS_TEST_DATABASE_URL to a superuser URL on a local, disposable cluster (localhost only; the harness creates
 * and drops databases and the cluster-wide agent_ro and claim_writer roles). Without it the database tests skip.
 *
 * Setup: fresh database -> packages/db migrations -> packages/tools/sql/grants.sql (the human step, so it is tested)
 * -> real rows from fixtures/calaccess_slice.json and the leginfo SB 329 votes in
 * py/ingest/tests/leginfo/fixtures/pubinfo_votes_sample.csv.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { connect, type ToolsDb } from "../src/db";

export const ADMIN_URL = process.env.TOOLS_TEST_DATABASE_URL ?? "";
const ROOT = join(import.meta.dir, "../../..");

export interface Harness {
  admin: postgres.Sql;
  db: ToolsDb;
  dbName: string;
  investigationId: string;
  agentUrl: string;
  close: () => Promise<void>;
}

function withDb(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export async function setup(): Promise<Harness> {
  const host = new URL(ADMIN_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`TOOLS_TEST_DATABASE_URL must point at a local throwaway cluster, not ${host}`);
  }
  const root = postgres(ADMIN_URL, { max: 1, onnotice: false });
  const dbName = `aletheia_tools_test_${process.pid}_${Date.now()}`;
  // Leftovers from crashed runs hold grants that block dropping the roles.
  for (const { datname } of await root<{ datname: string }[]>`
    select datname from pg_database where datname like 'aletheia_tools_test_%'`) {
    await root.unsafe(`drop database "${datname}" with (force)`);
  }
  await root.unsafe(`drop role if exists agent_ro`);
  await root.unsafe(`drop role if exists claim_writer`);
  await root.unsafe(`create database "${dbName}"`);

  const admin = postgres(withDb(ADMIN_URL, dbName), { max: 2, onnotice: false });
  const migrations = join(ROOT, "packages/db/drizzle");
  for (const f of readdirSync(migrations).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(migrations, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await admin.unsafe(stmt);
    }
  }
  await admin.unsafe(readFileSync(join(import.meta.dir, "../sql/grants.sql"), "utf8")).simple();
  const agentPw = randomUUID();
  const writerPw = randomUUID();
  await admin.unsafe(`alter role agent_ro password '${agentPw}'`);
  await admin.unsafe(`alter role claim_writer password '${writerPw}'`);

  await loadCalaccess(admin);
  await loadVotes(admin);
  const investigationId = randomUUID();
  await admin`insert into investigation (id, type, question, status)
              values (${investigationId}, 'test', 'Who funds CA HOMES COMMITTEE?', 'running')`;

  const agentUrl = withDb(ADMIN_URL, dbName, "agent_ro", agentPw);
  const db = connect(agentUrl, withDb(ADMIN_URL, dbName, "claim_writer", writerPw));
  return {
    admin,
    db,
    dbName,
    investigationId,
    agentUrl,
    close: async () => {
      await db.reader.end();
      await db.writer.end();
      await admin.end();
      await root.unsafe(`drop database if exists "${dbName}" with (force)`);
      await root.end();
    },
  };
}

interface Slice {
  entities: { id: string; kind: string; name: string; canonical_key: string; attrs: Record<string, unknown> }[];
  filings: {
    id: string; source: string; filing_id: string; amendment_no: number; form: string; filed_at: string | null;
    period_start: string | null; period_end: string | null; url: string;
  }[];
  edges: {
    id: string; from_key: string; to_key: string; amount: string; date: string | null; kind: string; filing_id: string;
    amend_id: number; schedule: string; line_item: string;
  }[];
}

export const SLICE: Slice = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/calaccess_slice.json"), "utf8"));

/** Same column mapping as py/ingest/src/ingest/calaccess/load.py. */
async function loadCalaccess(sql: postgres.Sql) {
  for (const e of SLICE.entities) {
    await sql`insert into entity (id, kind, name, canonical_key, attrs)
              values (${e.id}, ${e.kind}::entity_kind, ${e.name}, ${e.canonical_key}, ${sql.json(e.attrs as never)})`;
  }
  for (const f of SLICE.filings) {
    await sql`insert into filing (id, source, filing_id, amendment_no, form, filed_at, period_start, period_end, url)
              values (${f.id}, ${f.source}, ${f.filing_id}, ${f.amendment_no}, ${f.form},
                      ${f.filed_at}::timestamp at time zone 'America/Los_Angeles', ${f.period_start}::date,
                      ${f.period_end}::date, ${f.url})`;
  }
  for (const e of SLICE.edges) {
    await sql`insert into money_edge (id, from_entity, to_entity, amount, date, kind, filing_id, schedule, line_item)
              select ${e.id}, fe.id, te.id, ${e.amount}::numeric, ${e.date}::date, ${e.kind}::money_edge_kind, f.id,
                     ${e.schedule}, ${e.line_item}
              from entity fe, entity te, filing f
              where fe.canonical_key = ${e.from_key} and te.canonical_key = ${e.to_key}
                and f.source = 'calaccess' and f.filing_id = ${e.filing_id} and f.amendment_no = ${e.amend_id}`;
  }
}

export const SB329 = {
  sourceBillId: "202520260SB329",
  session: "2025-2026",
  measure: "SB-329",
  // leginfo Bill Votes page, copied in py/ingest/tests/leginfo/fixtures/leginfo_web_votes.json
  title: "SB-329 Alcohol and drug recovery: licensed treatment facilities and certified programs: investigations.",
};

/**
 * SB 329 roll calls from pubinfo_2025.zip (BILL_DETAIL_VOTE_TBL), as staged by the leginfo transform.
 * Legislators are keyed by house and the roll-call name here; the real loader resolves them to
 * leginfo:legislator:<house>:<district>:<name> entities through LEGISLATOR_TBL.
 */
async function loadVotes(sql: postgres.Sql) {
  const rows = parseCsv(
    readFileSync(join(ROOT, "py/ingest/tests/leginfo/fixtures/pubinfo_votes_sample.csv"), "utf8"),
  ).filter((r) => r.source_bill_id === SB329.sourceBillId);
  const [{ id: billId }] = await sql<{ id: string }[]>`
    insert into bill (session, measure, title) values (${SB329.session}, ${SB329.measure}, ${SB329.title}) returning id`;
  const legislators = new Map<string, string>();
  for (const r of rows) {
    const house = /^(A|CX)/u.test(r.location_code) ? "assembly" : "senate";
    const key = `leginfo:vote_name:${house}:${r.raw_name}`;
    let id = legislators.get(key);
    if (!id) {
      [{ id }] = await sql<{ id: string }[]>`
        insert into entity (kind, name, canonical_key) values ('legislator', ${r.raw_name}, ${key})
        on conflict (canonical_key) do update set name = excluded.name returning id`;
      legislators.set(key, id);
    }
    await sql`insert into vote (bill_id, legislator_entity, vote_date, motion, location, result)
              values (${billId}, ${id}, ${r.vote_date}::date, ${r.motion}, ${r.location}, ${r.result}::vote_result)`;
  }
}
