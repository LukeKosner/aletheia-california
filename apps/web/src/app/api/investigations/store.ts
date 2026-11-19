/** Server-owned lifecycle only. Never passed to an agent, page, or arbitrary SQL tool. */
import { createDb, investigation, claim } from "@aletheia/db";
import { and, eq, sql } from "drizzle-orm";
import type { Claim, InvestigationInput } from "./contract";
import { InvestigationError } from "./validation";
export type RecordRow = {
  id: string; question: string; type: string; status: string; harnessTaskId: string | null;
  costUsd: string | null; tokens: number | null;
};
export interface InvestigationStore {
  create(id: string, input: InvestigationInput, extractionTokens: number | null): Promise<void>;
  load(id: string): Promise<RecordRow | null>;
  assertAvailable(id: string): Promise<void>;
  update(id: string, patch: { status?: string; harnessTaskId?: string; tokens?: number | null; costUsd?: string | null }): Promise<void>;
  claims(id: string): Promise<Claim[]>;
}
export function unpublishedError() {
  return new InvestigationError("unpublished", "This report is unpublished while the team reviews its evidence.", 410);
}
// Fixed control-plane metadata only. P15 withdrawal events are append-only and
// remain authoritative even if another lifecycle writer changes the status.
function available() {
  return sql`${investigation.status} <> 'unpublished' and not exists (
    select 1 from event e where e.name in ('report_unpublished', 'correction_fixed')
    and e.props->>'investigationId' = ${investigation.id}::text
  )`;
}
let database: ReturnType<typeof createDb> | undefined;
function db() {
  const url = process.env.INVESTIGATION_DATABASE_URL;
  if (!url) throw new InvestigationError("not_configured", "Investigation storage setup is pending.", 503);
  // A separate human-provisioned role, never DATABASE_URL or agent_ro.
  return database ??= createDb(url);
}
export const store: InvestigationStore = {
  async create(id, input, extractionTokens) {
    await db().insert(investigation).values({ id, type: input.type, question: input.question, status: "queued", userId: "aletheia-private-team", methodVersion: "p9-v1", tokens: extractionTokens });
  },
  async load(id) {
    const rows = await db().select().from(investigation).where(and(eq(investigation.id, id), eq(investigation.userId, "aletheia-private-team"))).limit(1);
    return rows[0] ?? null;
  },
  async assertAvailable(id) {
    const rows = await db().select({ id: investigation.id }).from(investigation).where(and(eq(investigation.id, id), eq(investigation.userId, "aletheia-private-team"), available())).limit(1);
    if (!rows.length) throw unpublishedError();
  },
  async update(id, patch) {
    // The conditional UPDATE serializes with P15's investigation UPDATE. A
    // concurrent withdrawal wins without a read-then-write status race.
    const rows = await db().update(investigation).set(patch).where(and(eq(investigation.id, id), eq(investigation.userId, "aletheia-private-team"), available())).returning({ id: investigation.id });
    if (!rows.length) throw unpublishedError();
  },
  async claims(id) {
    const rows = await db().select().from(claim).where(eq(claim.investigationId, id));
    return rows.map((r) => ({ claim_id: r.id, text: r.sentence, edge_ids: r.edgeIds, filing_ids: r.filingIds, verdict: r.verdict, confidence: r.confidence, verifier_model: r.verifierModel }));
  },
};
