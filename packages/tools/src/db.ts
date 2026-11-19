/**
 * Database connections for the MCP tools.
 *
 * - `reader`: connects as `agent_ro`, which can SELECT from the six v_* views and nothing else. Every read runs in a
 *   READ ONLY transaction with a 10 s statement timeout (also set on the role itself).
 * - `writer`: connects as `claim_writer`, which can only INSERT into `claim`. Used by the `cite` tool alone, with
 *   statements the server writes; agent SQL never reaches it.
 *
 * Neither connection may be a database owner or superuser. See README.md for the role setup.
 */
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export const STATEMENT_TIMEOUT_MS = 10_000;

/** Keep dates and timestamps as Postgres prints them (no local-timezone Date objects). */
export const TEXT_DATES = { 1082: null, 1114: null, 1184: null } as const;

export interface ToolsDb {
  reader: Sql;
  writer: Sql;
}

export function connect(readerUrl: string, writerUrl: string): ToolsDb {
  if (!readerUrl) throw new Error("AGENT_RO_DATABASE_URL is not set");
  if (!writerUrl) throw new Error("CLAIM_WRITER_DATABASE_URL is not set");
  const common = { max: 5, idle_timeout: 30, onnotice: false as const, prepare: false };
  return {
    reader: postgres(readerUrl, { ...common, connection: { application_name: "aletheia-mcp-reader" } }),
    writer: postgres(writerUrl, { ...common, max: 2, connection: { application_name: "aletheia-mcp-cite" } }),
  };
}

let shared: ToolsDb | undefined;

/** Connections from AGENT_RO_DATABASE_URL and CLAIM_WRITER_DATABASE_URL, created once per process. */
export function sharedDb(env: Record<string, string | undefined> = process.env): ToolsDb {
  shared ??= connect(env.AGENT_RO_DATABASE_URL ?? "", env.CLAIM_WRITER_DATABASE_URL ?? "");
  return shared;
}

/** Runs `fn` in a READ ONLY transaction on the reader with the statement timeout set locally. */
export async function readOnly<T>(db: ToolsDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db.reader.begin("read only", async (tx) => {
    await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return fn(tx);
  })) as T;
}
