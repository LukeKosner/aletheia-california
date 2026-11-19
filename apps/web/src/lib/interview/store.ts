/**
 * Server-only storage for the voter-interview prototype. Connects as `interview_app`, which can read and
 * write only the `interview` schema (scripts/provision_interview_db.py). Never DATABASE_URL or agent_ro.
 */
import { createDb, interviewPayment, interviewPayout, interviewResearch, interviewSession, interviewStudy } from "@aletheia/db";
import { and, desc, eq, getTableColumns, gte, isNull, sql } from "drizzle-orm";
import { FOLLOW_ON_KINDS, PRICES, STUDY_INTERVIEWS } from "./taxonomy";

export class InterviewError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

let database: ReturnType<typeof createDb> | undefined;
function db() {
  const url = process.env.INTERVIEW_DATABASE_URL;
  if (!url) throw new InterviewError("not_configured", "Interview storage is not set up yet. Run scripts/provision_interview_db.py.", 503);
  return (database ??= createDb(url));
}

export type SessionRow = typeof interviewSession.$inferSelect;
export type ResearchRow = typeof interviewResearch.$inferSelect;
export type PaymentRow = typeof interviewPayment.$inferSelect;

/**
 * True when Postgres says a column is missing (42703): migration 0007 isn't applied yet. Reads then fall back
 * to the older columns so existing pages keep rendering until scripts/provision_interview_db.py is re-run.
 */
function missingColumn(error: unknown): boolean {
  for (let e: unknown = error, i = 0; e && typeof e === "object" && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "42703") return true;
  }
  return false;
}

function without<T extends Record<string, unknown>, K extends keyof T>(columns: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(columns).filter(([k]) => !keys.includes(k as K))) as Omit<T, K>;
}

const LEGACY_SESSION = without(getTableColumns(interviewSession), ["profile", "details"]);
const LEGACY_STUDY = without(getTableColumns(interviewStudy), ["fields", "interviewTarget", "priceCents"]);

export async function createSession(values: Pick<SessionRow, "county" | "ageRange" | "party" | "voteLikelihood" | "rewardEmail" | "profile"> & { studyId?: string | null }): Promise<string> {
  const [row] = await db().insert(interviewSession).values({ ...values, publicConsent: true }).returning({ id: interviewSession.id });
  return row.id;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  try {
    const rows = await db().select().from(interviewSession).where(eq(interviewSession.id, id)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    if (!missingColumn(error)) throw error;
    const rows = await db().select(LEGACY_SESSION).from(interviewSession).where(eq(interviewSession.id, id)).limit(1);
    return rows[0] ? { ...rows[0], profile: {}, details: {} } : null;
  }
}

export async function markStarted(id: string): Promise<void> {
  await db().update(interviewSession).set({ status: "in_progress" }).where(and(eq(interviewSession.id, id), eq(interviewSession.status, "draft")));
}

export async function completeSession(id: string, patch: Pick<SessionRow, "transcript" | "issues" | "questions" | "candidateViews" | "summary" | "wantsResearch" | "answers" | "details">): Promise<boolean> {
  const rows = await db().update(interviewSession)
    .set({ ...patch, status: "completed", completedAt: new Date() })
    .where(and(eq(interviewSession.id, id), sql`${interviewSession.status} <> 'completed'`))
    .returning({ id: interviewSession.id });
  return rows.length > 0;
}

/** Completed interviews. `publicOnly` leaves out sponsored study interviews, which belong to their sponsor's results. */
export async function completedSessions(limit = 2000, { publicOnly = false }: { publicOnly?: boolean } = {}) {
  const completed = eq(interviewSession.status, "completed");
  return db().select({
    id: interviewSession.id, county: interviewSession.county, ageRange: interviewSession.ageRange, party: interviewSession.party,
    issues: interviewSession.issues, questions: interviewSession.questions, candidateViews: interviewSession.candidateViews,
    summary: interviewSession.summary, completedAt: interviewSession.completedAt,
  }).from(interviewSession).where(publicOnly ? and(completed, isNull(interviewSession.studyId)) : completed)
    .orderBy(desc(interviewSession.completedAt)).limit(limit);
}

export async function createResearch(values: { sessionId: string | null; origin: "voter" | "periodic"; question: string }): Promise<string> {
  const [row] = await db().insert(interviewResearch).values(values).returning({ id: interviewResearch.id });
  return row.id;
}

export async function updateResearch(id: string, patch: Partial<Pick<ResearchRow, "investigationId" | "status" | "error">>): Promise<void> {
  await db().update(interviewResearch).set(patch).where(eq(interviewResearch.id, id));
}

export async function getResearch(id: string): Promise<ResearchRow | null> {
  const rows = await db().select().from(interviewResearch).where(eq(interviewResearch.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listResearch(filter: { sessionId?: string; origin?: "voter" | "periodic" } = {}, limit = 100): Promise<ResearchRow[]> {
  const where = filter.sessionId ? eq(interviewResearch.sessionId, filter.sessionId) : filter.origin ? eq(interviewResearch.origin, filter.origin) : undefined;
  return db().select().from(interviewResearch).where(where).orderBy(desc(interviewResearch.createdAt)).limit(limit);
}

export async function recentPeriodicQuestions(since: Date): Promise<string[]> {
  const rows = await db().select({ question: interviewResearch.question }).from(interviewResearch)
    .where(and(eq(interviewResearch.origin, "periodic"), gte(interviewResearch.createdAt, since), isNull(interviewResearch.sessionId)));
  return rows.map((r) => r.question);
}

/** Idempotent on the Stripe id: returns the row and whether this call inserted it. */
export async function recordPayment(values: { sessionId: string | null; product: string; stripeId: string; amountCents: number; status: string }): Promise<{ row: PaymentRow; created: boolean }> {
  const inserted = await db().insert(interviewPayment).values(values).onConflictDoNothing({ target: interviewPayment.stripeId }).returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  const rows = await db().select().from(interviewPayment).where(eq(interviewPayment.stripeId, values.stripeId)).limit(1);
  return { row: rows[0], created: false };
}

export async function getPayment(id: string): Promise<PaymentRow | null> {
  const rows = await db().select().from(interviewPayment).where(eq(interviewPayment.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listPayments(limit = 50): Promise<PaymentRow[]> {
  return db().select().from(interviewPayment).orderBy(desc(interviewPayment.createdAt)).limit(limit);
}

export async function recordPayout(values: { stripeId: string; amountCents: number; status: string; note: string | null }): Promise<void> {
  await db().insert(interviewPayout).values(values);
}

export async function listPayouts(limit = 50) {
  return db().select().from(interviewPayout).orderBy(desc(interviewPayout.createdAt)).limit(limit);
}

// ---------- sponsor studies ----------

export type StudyRow = typeof interviewStudy.$inferSelect;

export async function createStudy(values: Pick<StudyRow, "sponsorKind" | "sponsorName" | "title" | "goal" | "questions" | "fields" | "interviewTarget" | "priceCents">): Promise<string> {
  const [row] = await db().insert(interviewStudy).values(values).returning({ id: interviewStudy.id });
  return row.id;
}

export async function getStudy(id: string): Promise<StudyRow | null> {
  try {
    const rows = await db().select().from(interviewStudy).where(eq(interviewStudy.id, id)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    if (!missingColumn(error)) throw error;
    const rows = await db().select(LEGACY_STUDY).from(interviewStudy).where(eq(interviewStudy.id, id)).limit(1);
    return rows[0] ? { ...rows[0], fields: null, interviewTarget: STUDY_INTERVIEWS, priceCents: PRICES.study.cents } : null;
  }
}

export async function openStudy(id: string): Promise<void> {
  await db().update(interviewStudy).set({ status: "open" }).where(eq(interviewStudy.id, id));
}

export async function studySessions(studyId: string) {
  const columns = {
    id: interviewSession.id, county: interviewSession.county, ageRange: interviewSession.ageRange, party: interviewSession.party,
    voteLikelihood: interviewSession.voteLikelihood, answers: interviewSession.answers, summary: interviewSession.summary,
    completedAt: interviewSession.completedAt,
  };
  const where = and(eq(interviewSession.studyId, studyId), eq(interviewSession.status, "completed"));
  try {
    return await db().select({ ...columns, profile: interviewSession.profile }).from(interviewSession).where(where).orderBy(desc(interviewSession.completedAt)).limit(500);
  } catch (error) {
    if (!missingColumn(error)) throw error;
    const rows = await db().select(columns).from(interviewSession).where(where).orderBy(desc(interviewSession.completedAt)).limit(500);
    return rows.map((r) => ({ ...r, profile: {} as Record<string, string> }));
  }
}

/**
 * Interviews that count toward a study's paid total: finished ones, plus ones started in the last 30 minutes that may
 * still finish. Abandoned starts stop counting, so a sponsor who pays for 20 can get 20 finished interviews.
 */
export async function studyInterviewCount(studyId: string): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(interviewSession).where(and(eq(interviewSession.studyId, studyId), sql`(${interviewSession.status} = 'completed' or ${interviewSession.createdAt} > now() - interval '30 minutes')`));
  return row?.n ?? 0;
}

/** True when this email already took (or started) this study; each person takes a study once. */
export async function hasTakenStudy(email: string, studyId: string): Promise<boolean> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(interviewSession)
    .where(and(eq(interviewSession.studyId, studyId), eq(interviewSession.rewardEmail, email.toLowerCase())));
  return (row?.n ?? 0) > 0;
}

/**
 * One open study to offer after a general interview: a sponsor kind allowed to follow on, still short of its paid
 * total, and not yet taken by this email. Oldest first, so earlier sponsors fill up first. The offer is optional, so
 * any lookup error means no offer rather than a broken thank-you page.
 */
export async function followOnStudy(email: string): Promise<StudyRow | null> {
  try {
    const open = await db().select().from(interviewStudy)
      .where(and(eq(interviewStudy.status, "open"), sql`${interviewStudy.sponsorKind} in (${sql.join(FOLLOW_ON_KINDS.map((k) => sql`${k}`), sql`, `)})`))
      .orderBy(interviewStudy.createdAt).limit(10);
    for (const study of open) {
      if (await studyInterviewCount(study.id) >= study.interviewTarget) continue;
      if (await hasTakenStudy(email, study.id)) continue;
      return study;
    }
    return null;
  } catch (error) {
    console.error("follow-on study lookup", error);
    return null;
  }
}
