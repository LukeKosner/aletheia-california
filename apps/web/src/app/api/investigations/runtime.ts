import models from "../../../../../../agents/models.json";import { InvestigationError, object, parseAnswer } from "./validation";
import type { Answer, InvestigationInput } from "./contract";

type Json = Record<string, unknown>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type RuntimeResponse = Json & { id: string; status: string };
export type RuntimeConfig = { key: string; scopeHarnessId: string; harnessId: string };
export function configuration(type: InvestigationInput["type"], env = process.env): RuntimeConfig {
  // General questions go to the ask harness (Aletheia records plus web sources) once it is synced; until then, the
  // records-only general harness keeps working.
  const harnessId = type === "general" ? env.HR_ASK_HARNESS_ID || env.HR_GENERAL_HARNESS_ID : env[`HR_${type.toUpperCase()}_HARNESS_ID`];
  // This attests a reviewed remote setup; an instruction-only disabled tool is insufficient.
  if (env.INVESTIGATIONS_RUNTIME_READY !== "1" || !env.HR_API_KEY || !env.HR_SCOPE_HARNESS_ID || !harnessId) {
    throw new InvestigationError("not_configured", "Private investigation runtime setup is pending.", 503);
  }
  return { key: env.HR_API_KEY, scopeHarnessId: env.HR_SCOPE_HARNESS_ID, harnessId };
}
export function lastText(response: Json): string {
  const messages = Array.isArray(response.output) ? response.output.filter((v) => v && typeof v === "object" && (v as Json).type === "message") : [];
  const last = messages.at(-1) as Json | undefined;
  return Array.isArray(last?.content) ? last.content.filter((v) => v && typeof v === "object" && (v as Json).type === "output_text").map((v) => (v as Json).text).filter((v): v is string => typeof v === "string").join("") : "";
}
export function tokenCount(response: Json): number | null {
  const usage = response.usage;
  const total = usage && typeof usage === "object" ? (usage as Json).total_tokens : null;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null;
}
export async function extractScope(input: InvestigationInput, config: RuntimeConfig, fetcher: Fetcher = fetch): Promise<{ tokens: number | null }> {
  // The scope harness has every built-in tool disabled and no MCP server. Its standing instruction (agents/instructions/scope.md)
  // is stored in the harness, per agents/harnessrouter.json; only the user's input travels with the task.
  const response = await fetcher("https://api.harnessrouter.ai/v1/responses", {
    method: "POST", headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json", "UHP-Version": "2026-09-28" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ input: JSON.stringify(input), user: "aletheia-private-team", metadata: { harness_id: config.scopeHarnessId }, stream: false, max_step: models.extraction.max_step, timeout_seconds: 60, max_cost_usd: 0.1 }),
  });
  if (!response.ok) throw new InvestigationError("runtime_unavailable", "The investigation service is unavailable.", 502);
  const result = object(await response.json());
  let scope: unknown;
  try { scope = object(JSON.parse(lastText(result).trim().replace(/^```(?:json)?\s*|\s*```$/gu, ""))).scope; }
  catch { throw new InvestigationError("scope_unconfirmed", "The request's public-record scope could not be confirmed.", 422); }
  if (scope === "out_of_scope") throw new InvestigationError("out_of_scope", "Ask covers California government, politics, policy and public affairs.", 422);
  if (scope !== "public_target") throw new InvestigationError("private_person", "Investigations cover public institutional activity, not private-person information.", 422);
  return { tokens: tokenCount(result) };
}
/** Official data-only SSE. Bounded frames; no tool arguments or text deltas escape to the browser. */
export async function* runtimeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Json> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/gu, "\n");
      if (buffer.length > 2_000_000) throw new InvestigationError("invalid_stream", "The investigation service returned too much data.", 502);
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let event: Json;
        try { event = object(JSON.parse(data)); } catch { throw new InvestigationError("invalid_stream", "The investigation service returned an invalid event.", 502); }
        yield event;
      }
      if (done) break;
    }
    if (buffer.trim()) throw new InvestigationError("interrupted", "The investigation stream was interrupted. Reload its saved link.", 502);
  } finally { reader.releaseLock(); }
}
/** Per-task limits, shared with agents/sync-harnesses.ts through agents/models.json so harness and request agree.
 * Ask (type "general") is bounded tighter: scope check (up to 60 s) plus the task must fit the route's 300 s maxDuration. */
export function taskLimits(type: InvestigationInput["type"]): { max_step: number; timeout_seconds: number; max_cost_usd: number } {
  return type === "general" ? models.task_limits.ask : models.task_limits.records;
}
export async function startTask(input: InvestigationInput, id: string, config: RuntimeConfig, fetcher: Fetcher = fetch): Promise<Response> {
  const response = await fetcher("https://api.harnessrouter.ai/v1/responses", {
    method: "POST", headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json", accept: "text/event-stream", "UHP-Version": "2026-09-28", "Idempotency-Key": id, "X-Aletheia-Investigation-Id": id },
    // No browser abort signal: a disconnected tab must not abandon the stored task.
    body: JSON.stringify({ input: JSON.stringify({ ...input, investigation_id: id }), user: "aletheia-private-team", metadata: { harness_id: config.harnessId }, stream: true, ...taskLimits(input.type) }),
  });
  if (!response.ok || !response.body) throw new InvestigationError("runtime_unavailable", "The investigation service is unavailable.", 502);
  return response;
}
export async function getTask(id: string, config: RuntimeConfig, fetcher: Fetcher = fetch): Promise<RuntimeResponse> {
  const response = await fetcher(`https://api.harnessrouter.ai/v1/responses/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${config.key}`, "UHP-Version": "2026-09-28" }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new InvestigationError("runtime_unavailable", "The saved investigation is temporarily unavailable.", 502);
  const result = runtimeResponse(await response.json());
  if (result.id !== id) throw new InvestigationError("invalid_stream", "The saved investigation response changed unexpectedly.", 502);
  return result;
}
export function runtimeResponse(value: unknown): RuntimeResponse {
  const v = object(value);
  if (typeof v.id !== "string" || !/^resp_[\w-]+$/u.test(v.id) || typeof v.status !== "string") throw new InvestigationError("invalid_stream", "The investigation response is invalid.", 502);
  return v as RuntimeResponse;
}
export const TOO_LONG = "This question took too long. Try a narrower question.";
/** A task stopped at its step or time limit may still have written its final answer as the last message. That answer
 * goes through the same parseAnswer and claim validation as a completed one; anything else stays incomplete. */
export function usable(response: RuntimeResponse): boolean {
  if (response.status === "completed") return true;
  if (response.status !== "incomplete") return false;
  try { parseAnswer(JSON.parse(lastText(response))); return true; } catch { return false; }
}
export function answerFrom(response: RuntimeResponse): Answer {
  if (!usable(response)) throw new InvestigationError("incomplete", TOO_LONG, 502);
  try { return parseAnswer(JSON.parse(lastText(response))); }
  catch (error) { if (error instanceof InvestigationError && error.status >= 500) throw error; throw new InvestigationError("invalid_answer", "The investigation returned an invalid answer.", 502); }
}
