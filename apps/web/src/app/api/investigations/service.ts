import { runQuery, sharedDb } from "@aletheia/tools";
import { readFlags } from "../../../lib/flags";
import { isCited, type Answer, type InvestigationEvent, type InvestigationInput, type InvestigationResult, type FilingSource } from "./contract";
import { answerFrom, configuration, extractScope, getTask, runtimeEvents, runtimeResponse, startTask, tokenCount, TOO_LONG, usable, type RuntimeConfig, type RuntimeResponse } from "./runtime";
import { store, unpublishedError, type InvestigationStore, type RecordRow } from "./store";
import { InvestigationError, UUID, validateClaims } from "./validation";
import { describeFiling } from "../../../components/investigations/filing-label";
import { cachedFiling, finishedTask } from "./cached";

export interface Dependencies {
  store: InvestigationStore;
  target(input: InvestigationInput): Promise<void>;
  scope(input: InvestigationInput, config: RuntimeConfig): Promise<{ tokens: number | null }>;
  start(input: InvestigationInput, id: string, config: RuntimeConfig): Promise<Response>;
  get(id: string, config: RuntimeConfig): Promise<RuntimeResponse>;
  /** A finished run, served from cache when it was read before. Optional so tests can omit it. */
  getFinished?(id: string, type: InvestigationInput["type"]): Promise<RuntimeResponse>;
  sources?(ids: string[]): Promise<FilingSource[]>;
}
function unwrap(value: unknown): unknown {
  return value && typeof value === "object" && "untrusted_text" in value ? (value as { untrusted_text: unknown }).untrusted_text : value;
}
export async function validateTarget(input: InvestigationInput): Promise<void> {
  if (input.type === "interests" && !readFlags().FORM700) throw new InvestigationError("feature_disabled", "Official-interest investigations are not enabled.", 403);
  // General questions name no record; the scope harness and the general harness's standing rules bound them.
  if (input.type === "general") return;
  if ("bill_id" in input.target) return;
  // UUID validated before interpolation, with no question or model SQL in this statement.
  if (!UUID.test(input.target.entity_id)) throw new InvestigationError("invalid_target", "Choose a public entity.");
  const result = await runQuery(sharedDb(), `select kind from v_entities where entity_id = '${input.target.entity_id}'::uuid`);
  const kind = unwrap(result.rows[0]?.kind);
  const allowed = input.type === "measure" ? ["measure"] : input.type === "interests" ? ["official", "legislator", "candidate"] : ["org", "committee", "lobby_firm"];
  if (typeof kind !== "string" || !allowed.includes(kind)) throw new InvestigationError("private_person", "Choose a public target supported by this investigation type.", 422);
}
export const dependencies: Dependencies = { store, target: validateTarget, scope: extractScope, start: startTask, get: getTask, getFinished: finishedTask, sources: sourceMetadata };
export function pending(row: RecordRow): InvestigationResult {
  return { investigation_id: row.id, question: row.question, type: row.type as InvestigationInput["type"], status: row.status, answer: null, claims: [], verification_status: "pending", cost_usd: row.costUsd === null ? null : Number(row.costUsd), tokens: row.tokens };
}
export async function finish(row: RecordRow, response: RuntimeResponse, storage: InvestigationStore, sources?: Dependencies["sources"]): Promise<InvestigationResult> {
  await storage.assertAvailable(row.id);
  const answer: Answer = answerFrom(response), claims = await storage.claims(row.id);
  validateClaims(answer, claims);
  const usedIds = new Set(answer.sections.flatMap((s) => s.sentences.filter(isCited).map((sentence) => sentence.claim_id)));
  const sourceRows = sources ? await sources(claims.filter((c) => usedIds.has(c.claim_id)).flatMap((c) => c.filing_ids)) : [];
  const responseTokens = tokenCount(response);
  // A repeated GET must not add the extraction tokens twice. Null means unreported, never zero.
  const total = row.status === "completed" ? row.tokens : row.tokens !== null && responseTokens !== null ? row.tokens + responseTokens : null;
  await storage.update(row.id, { status: "completed", tokens: total, costUsd: null });
  await storage.assertAvailable(row.id);
  return { ...pending(row), status: "completed", answer, claims: claims.filter((c) => usedIds.has(c.claim_id)).map((c) => ({ ...c, sources: sourceRows.filter((source) => c.filing_ids.includes(source.filing_id)) })), tokens: total, cost_usd: null };
}
export async function prepare(input: InvestigationInput, deps = dependencies): Promise<{ id: string; config: RuntimeConfig }> {
  const config = configuration(input.type);
  if (deps === dependencies && !process.env.INVESTIGATION_DATABASE_URL) throw new InvestigationError("not_configured", "Investigation storage setup is pending.", 503);
  await deps.target(input);
  const extraction = await deps.scope(input, config);
  const id = crypto.randomUUID();
  await deps.store.create(id, input, extraction.tokens);
  return { id, config };
}
export async function consume(input: InvestigationInput, id: string, config: RuntimeConfig, emit: (event: InvestigationEvent) => void, deps = dependencies): Promise<void> {
  let taskId: string | undefined;
  emit({ event: "progress", data: { investigation_id: id, status: "queued", message: "Starting" } });
  try {
    await deps.store.assertAvailable(id);
    const upstream = await deps.start(input, id, config);
    for await (const event of runtimeEvents(upstream.body!)) {
      if (event.type === "response.created") {
        const response = runtimeResponse(event.response); taskId = response.id;
        await deps.store.update(id, { harnessTaskId: taskId, status: "running" });
        emit({ event: "progress", data: { investigation_id: id, status: "running", message: "Researching" } });
      } else if (event.type === "response.output_item.added") {
        emit({ event: "progress", data: { investigation_id: id, status: "running", message: "Looking through sources" } });
      } else if (["response.completed", "response.failed", "response.incomplete"].includes(String(event.type))) {
        const response = runtimeResponse(event.response);
        if (taskId && taskId !== response.id) throw new InvestigationError("invalid_stream", "The task response changed unexpectedly.", 502);
        taskId = response.id;
        await deps.store.update(id, { harnessTaskId: taskId });
        if (!usable(response)) {
          await deps.store.update(id, { status: response.status });
          throw new InvestigationError("incomplete", response.status === "incomplete" ? TOO_LONG : "This investigation stopped before it found an answer. Try asking again.", 502);
        }
        emit({ event: "progress", data: { investigation_id: id, status: "validating", message: "Checking every citation" } });
        const row = await deps.store.load(id);
        if (!row) throw new InvestigationError("not_found", "The investigation could not be found.", 404);
        const result = await finish(row, response, deps.store, deps.sources);
        await deps.store.assertAvailable(id);
        emit({ event: "result", data: result });
        return;
      }
    }
    throw new InvestigationError("interrupted", "The connection ended before the investigation finished. Reload its saved link.", 502);
  } catch (error) {
    // A known upstream task remains recoverable by GET; never start a duplicate.
    const code = error instanceof InvestigationError ? error.code : "investigation_failed";
    await deps.store.update(id, { status: code === "incomplete" ? "incomplete" : code === "interrupted" && taskId ? "running" : "failed" }).catch(() => undefined);
    emit({ event: "error", data: { investigation_id: id, code, message: error instanceof InvestigationError ? error.message : "The investigation could not finish. Reload its saved link." } });
  }
}
export async function loadResult(id: string, deps = dependencies): Promise<InvestigationResult> {
  if (!UUID.test(id)) throw new InvestigationError("not_found", "Investigation not found.", 404);
  const row = await deps.store.load(id);
  if (!row) throw new InvestigationError("not_found", "Investigation not found.", 404);
  if (row.status === "unpublished") throw unpublishedError();
  await deps.store.assertAvailable(id);
  if (!row.harnessTaskId) {
    await deps.store.assertAvailable(id);
    return pending(row);
  }
  const type = row.type as InvestigationInput["type"];
  // A completed answer reopens from the cached run; anything else asks HarnessRouter for the live status.
  const response = row.status === "completed" && deps.getFinished
    ? await deps.getFinished(row.harnessTaskId, type).catch(() => deps.get(row.harnessTaskId!, configuration(type)))
    : await deps.get(row.harnessTaskId, configuration(type));
  if (usable(response)) return finish(row, response, deps.store, deps.sources);
  const status = ["failed", "cancelled", "incomplete"].includes(response.status) ? response.status : "running";
  await deps.store.update(id, { status });
  await deps.store.assertAvailable(id);
  return { ...pending(row), status };
}
/** Optional source hydration goes through packages/tools; no page receives a database client. */
export async function sourceMetadata(filingIds: string[]) {
  const results = await Promise.all([...new Set(filingIds)].slice(0, 100).map((id) => cachedFiling(id)));
  return results.flatMap((r) => r.filings.map((f) => ({ filing_id: f.filing_uuid, title: `${f.source ?? "Filing"} ${f.filing_id ?? ""} ${f.form ?? ""}`.trim(), url: f.url, ...describeFiling(f, r.items, r.lobby_parties) })));
}
export function publicError(error: unknown): Response {
  const e = error instanceof InvestigationError ? error : new InvestigationError("unavailable", "The investigation service is temporarily unavailable.", 503);
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { "cache-control": "no-store" } });
}
