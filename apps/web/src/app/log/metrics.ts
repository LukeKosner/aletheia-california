/**
 * The three database-backed series on /log.
 *
 * TODO(packages/tools): rule 4 says pages read data through `packages/tools`.
 * That package does not exist yet, so the reads live here instead — in one
 * module, SELECT only, no writes and no mutations. Move them wholesale when
 * `packages/tools` lands; nothing outside this file touches the database.
 *
 * Set `DATABASE_URL_READONLY` to point the page at a read-only Postgres role.
 * It falls back to `DATABASE_URL`. With neither set the page renders empty
 * charts rather than failing — the charts stay empty until data exists.
 */
import { createDb } from "@aletheia/db";
import { sql } from "drizzle-orm";
import { connection } from "next/server";

/** How far back the running charts look. */
export const WINDOW_DAYS = 90;

/**
 * Event names the charts count. Whatever records these must write
 * `event.name` exactly: one row per share, one row per card view.
 */
export const SHARE_EVENT = "share";
export const CARD_VIEW_EVENT = "card_view";

/**
 * `investigation.status` is free text and nothing writes it yet, so the value
 * that counts as verified is pinned here rather than guessed at each call site.
 */
export const VERIFIED_STATUS = "verified";

export type DayPoint = { day: string; value: number };

export type DbMetrics = {
  /** False when there is no database URL, or the read failed. */
  available: boolean;
  /** Daily spend across all investigations ÷ investigations verified that day, USD. */
  costPerVerified: DayPoint[];
  /** Claims the verifier marked overstated or unsupported, per day. */
  verifierCatches: DayPoint[];
  shares: DayPoint[];
  cardViews: DayPoint[];
  /** Set when a read failed, for the chart card's empty state. */
  note?: string;
};

export const EMPTY_METRICS: DbMetrics = {
  available: false,
  costPerVerified: [],
  verifierCatches: [],
  shares: [],
  cardViews: [],
};

function databaseUrl(): string {
  return process.env.DATABASE_URL_READONLY ?? process.env.AGENT_RO_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
}

// One client per process. `createDb` pools internally; building a new pool per
// request would leak connections.
let client: ReturnType<typeof createDb> | null = null;
function db() {
  if (!client) client = createDb(databaseUrl());
  return client;
}

/** postgres-js returns rows as an array; normalise whatever the driver hands back. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Postgres `numeric` arrives as a string; coerce and drop anything unusable. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDay(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  return null;
}

function toPoints(result: unknown, field: string): DayPoint[] {
  return rowsOf(result)
    .map((row) => {
      const day = toDay(row.day);
      const value = toNumber(row[field]);
      return day === null || value === null ? null : { day, value };
    })
    .filter((point): point is DayPoint => point !== null);
}

/**
 * Reads every chart series in one round trip's worth of queries.
 *
 * Always resolves: a missing URL or a failed read yields empty series with a
 * note, so /log renders before any of this data exists.
 */
export async function readDbMetrics(): Promise<DbMetrics> {
  await connection(); // request time, never prerendered

  if (!databaseUrl()) {
    return { ...EMPTY_METRICS, note: "No database configured." };
  }

  try {
    const since = sql`now() - make_interval(days => ${WINDOW_DAYS}::int)`;

    const [cost, catches, events] = await Promise.all([
      // Cost per verified investigation: the day's whole spend, including
      // investigations that did not pass verification, over the count that did.
      db().execute(sql`
        select day, total_cost / verified as cost
        from (
          select date_trunc('day', created_at)::date as day,
                 coalesce(sum(cost_usd), 0)::float8 as total_cost,
                 count(*) filter (where status = ${VERIFIED_STATUS})::float8 as verified
          from investigation
          where created_at >= ${since}
          group by 1
        ) per_day
        where verified > 0
        order by day
      `),
      db().execute(sql`
        select date_trunc('day', created_at)::date as day, count(*)::float8 as catches
        from claim
        where verdict in ('overstated', 'unsupported')
          and created_at >= ${since}
        group by 1
        order by 1
      `),
      db().execute(sql`
        select date_trunc('day', created_at)::date as day,
               count(*) filter (where name = ${SHARE_EVENT})::float8 as shares,
               count(*) filter (where name = ${CARD_VIEW_EVENT})::float8 as card_views
        from event
        where name in (${SHARE_EVENT}, ${CARD_VIEW_EVENT})
          and created_at >= ${since}
        group by 1
        order by 1
      `),
    ]);

    return {
      available: true,
      costPerVerified: toPoints(cost, "cost"),
      verifierCatches: toPoints(catches, "catches"),
      shares: toPoints(events, "shares"),
      cardViews: toPoints(events, "card_views"),
    };
  } catch (error) {
    console.error("[/log] metrics read failed", error);
    return { ...EMPTY_METRICS, note: "Metrics are unavailable right now." };
  }
}
