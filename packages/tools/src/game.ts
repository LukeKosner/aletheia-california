/** Restricted, read-only aggregate/activity surface. No roster or email is exposed. */
import postgres from "postgres";
import { STATEMENT_TIMEOUT_MS } from "./db";
export type CampusKey = "stanford" | "berkeley" | "neither" | "unassigned";
export type GameCount = { campus: CampusKey; verifiedInvestigations: number; cardViews: number };
export const GAME_CAMPUSES: CampusKey[] = ["stanford", "berkeley", "neither", "unassigned"];
export function gameReaderURL(value: string | undefined): string | null {
  try { const url = new URL(value ?? ""); return ["postgres:", "postgresql:"].includes(url.protocol) && decodeURIComponent(url.username) === "game_reader" ? url.href : null; } catch { return null; }
}
let reader: postgres.Sql | undefined;
function client() {
  const url = gameReaderURL(process.env.GAME_READER_DATABASE_URL);
  if (!url) throw new Error("Restricted game reader is not configured.");
  return reader ??= postgres(url, { max: 2, prepare: false, idle_timeout: 30, onnotice: false });
}
export function normalizeGameRows(rows: Record<string, unknown>[]): GameCount[] {
  return GAME_CAMPUSES.map((campus) => {
    const row = rows.find((item) => item.campus === campus);
    const count = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid activity aggregate."); return n; };
    return { campus, verifiedInvestigations: row ? count(row.verified_investigations) : 0, cardViews: row ? count(row.card_views) : 0 };
  });
}
/** The trusted host must persist final P12 claims before recording verified events. */
export async function getGameSummary(): Promise<GameCount[]> {
  const rows = await client().begin("read only", async (tx) => {
    await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return tx`
      with verified as (
        select distinct on (e.props->>'investigation_id') e.props->>'investigation_id' as id, coalesce(e.campus, 'unassigned') as campus
        from event e join investigation i on i.id::text = e.props->>'investigation_id'
        where e.name = 'investigation_verified' and e.props->>'verification_status' = 'verified'
          and i.status = 'completed'
          and not exists (select 1 from event withdrawn where withdrawn.name in ('report_unpublished', 'correction_fixed') and withdrawn.props->>'investigationId' = i.id::text)
          and exists (select 1 from claim c where c.investigation_id = i.id)
          and not exists (select 1 from claim c where c.investigation_id = i.id
            and (c.verdict is distinct from 'supported' or nullif(trim(c.verifier_model), '') is null))
        order by e.props->>'investigation_id', e.created_at, e.id
      ), views as (
        select coalesce(e.campus, 'unassigned') as campus, count(*) as n
        from event e join card c on c.id::text = e.props->>'card_id' join investigation i on i.id = c.investigation_id
        where e.name = 'card_viewed' and c.published = true and i.status = 'completed'
          and not exists (select 1 from event withdrawn where withdrawn.name in ('report_unpublished', 'correction_fixed') and withdrawn.props->>'investigationId' = i.id::text)
          and not exists (select 1 from correction r where r.card_id = c.id and r.status = 'open')
        group by 1
      )
      select campus, count(distinct id)::integer as verified_investigations, 0::integer as card_views
      from verified group by campus
      union all select campus, 0::integer, n::integer from views`;
  });
  const combined = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const existing = combined.get(row.campus) ?? { campus: row.campus, verified_investigations: 0, card_views: 0 };
    existing.verified_investigations = Number(existing.verified_investigations) + Number(row.verified_investigations);
    existing.card_views = Number(existing.card_views) + Number(row.card_views);
    combined.set(row.campus, existing);
  }
  return normalizeGameRows([...combined.values()]);
}
export type GameActivity = { investigationId: string; status: string; userId: string | null; claims: { id: string; sentence: string; verdict: string | null; verifierModel: string | null; edgeIds: string[]; filingIds: string[]; confidence: string | null }[] };
/** Used only by trusted server event hooks, not an agent callable query. */
export async function getGameActivity(id: string): Promise<GameActivity | null> {
  return await client().begin("read only", async (tx) => {
    await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const rows = await tx`select id, status, user_id from investigation where id::text = ${id}`;
    if (!rows[0]) return null;
    const claims = await tx`select id, sentence, verdict, verifier_model, edge_ids, filing_ids, confidence from claim where investigation_id::text = ${id}`;
    return { investigationId: rows[0].id, status: rows[0].status, userId: rows[0].user_id, claims: claims.map((c) => ({ id: c.id, sentence: c.sentence, verdict: c.verdict, verifierModel: c.verifier_model, edgeIds: c.edge_ids, filingIds: c.filing_ids, confidence: c.confidence })) };
  }) as GameActivity | null;
}
