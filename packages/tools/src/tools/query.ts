import { readOnly, TEXT_DATES, type ToolsDb, type Tx } from "../db";
import { STRUCTURED_COLUMNS, TEXT_TYPE_OIDS, wrapValue } from "../untrusted";

export const QUERY_MAX_ROWS = 500;
export const QUERY_MAX_SQL_LENGTH = 20_000;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
}

/**
 * Cleans agent SQL and wraps it so only one read-only query can run:
 * - trailing semicolons and whitespace are dropped;
 * - the text is placed inside `select * from (...) limit 501`, so it must be a single SELECT, VALUES or WITH query
 *   (a data-modifying WITH is rejected by Postgres inside a subquery);
 * - it is sent over the extended protocol (`simple: false`), which refuses more than one statement.
 * The real boundary is the database: agent_ro can only SELECT from the v_* views, and the transaction is READ ONLY.
 */
export function wrapAgentSql(sql: string): string {
  const clean = sql.trim().replace(/;+\s*$/u, "").trim();
  if (!clean) throw new Error("query is empty");
  if (clean.length > QUERY_MAX_SQL_LENGTH) throw new Error(`query is longer than ${QUERY_MAX_SQL_LENGTH} characters`);
  // set_config could raise this session's statement_timeout or switch settings mid-transaction.
  if (/\bset_config\s*\(/iu.test(clean)) throw new Error("set_config is not allowed");
  return `select * from (\n${clean}\n) as agent_query limit ${QUERY_MAX_ROWS + 1}`;
}

type ColumnKey = `${number}:${number}`;
/**
 * Per connection pool, because oids differ between databases. If the views are recreated while the server runs, the
 * stale oids match nothing and every text column is wrapped: the safe direction.
 */
const structuredCache = new WeakMap<ToolsDb, Promise<Set<ColumnKey>>>();

/** (relation oid, attnum) of every STRUCTURED_COLUMNS entry, read from the catalog once per process. */
async function structuredColumns(db: ToolsDb, tx: Tx): Promise<Set<ColumnKey>> {
  const cached = structuredCache.get(db);
  if (cached) return cached;
  const loading = (async () => {
    const pairs = Object.entries(STRUCTURED_COLUMNS).flatMap(([rel, cols]) => cols.map((c) => `${rel}.${c}`));
    const rows = await tx<{ oid: number; attnum: number }[]>`
      select c.oid::int as oid, a.attnum::int as attnum
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relname || '.' || a.attname = any(${pairs})
    `;
    return new Set(rows.map((r) => `${r.oid}:${r.attnum}` as ColumnKey));
  })().catch((err) => {
    structuredCache.delete(db);
    throw err;
  });
  structuredCache.set(db, loading);
  return loading;
}

export async function runQuery(db: ToolsDb, sql: string): Promise<QueryResult> {
  const text = wrapAgentSql(sql);
  return readOnly(db, async (tx) => {
    const structured = await structuredColumns(db, tx);
    // simple: false forces the extended protocol: one statement only. (unsafe() without parameters defaults to the
    // simple protocol, which would run `...; delete ...` as a second statement.)
    const result = await tx.unsafe(text, [], { simple: false }).parsers(TEXT_DATES);
    const cols = result.columns ?? [];
    const wrap = cols.map(
      (c) => TEXT_TYPE_OIDS.has(c.type) && !structured.has(`${c.table}:${c.number}` as ColumnKey),
    );
    const rows = result.slice(0, QUERY_MAX_ROWS).map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        const v = row[c.name];
        out[c.name] = wrap[i] ? wrapValue(v) : v;
      });
      return out;
    });
    return {
      columns: cols.map((c) => c.name),
      rows,
      row_count: rows.length,
      truncated: result.length > QUERY_MAX_ROWS,
    };
  });
}
