import { describe, expect, test } from "bun:test";
import slice from "../../../../../../packages/tools/test/fixtures/calaccess_slice.json";
import { answerFrom, configuration, extractScope, lastText, runtimeEvents, taskLimits, tokenCount } from "./runtime";
import { consume, finish, loadResult, publicError, validateTarget, type Dependencies } from "./service";
import { parseAnswer, parseInput, validateClaims } from "./validation";
import type { Answer, Claim, InvestigationInput } from "./contract";
import type { InvestigationStore, RecordRow } from "./store";
import { unpublishedError } from "./store";
import { authorize } from "./security";
import { authConfig, createSessionToken } from "../../sign-in/session";

// Public filing evidence comes from the committed CAL-ACCESS fixture, not model output:
// https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=3128904&amendid=0
// F497P1 line 1; source bulk export/sha256 is recorded in slice._source and MANIFEST.csv.
const edge = slice.edges.find((e) => e.filing_id === "3128904" && e.schedule === "F497P1" && e.line_item === "1")!;
const sentence = `Filing ${edge.filing_id}, schedule ${edge.schedule}, line ${edge.line_item} reports $${edge.amount} on ${edge.date}.`;
// Generated IDs and mocked usage counters below are transport/test infrastructure only.
// They are not real recorded claims, measured model usage, or live acceptance evidence.
const id = crypto.randomUUID(), claimId = crypto.randomUUID();
const answer: Answer = { summary: sentence, sections: [{ heading: "Funding", sentences: [{ text: sentence, claim_id: claimId }] }], card: { title: "Funding", claim_ids: [claimId] } };
const claim: Claim = { claim_id: claimId, text: sentence, edge_ids: [edge.id], filing_ids: [], verdict: null, confidence: null, verifier_model: null };
const input: InvestigationInput = { type: "footprint", question: "Which recipients received campaign contributions from CA HOMES COMMITTEE?", target: { entity_id: slice.entities.find((e) => e.canonical_key === "calaccess:filer:1481256")!.id } };
function response(value: unknown = answer) { return { id: "resp_test", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { total_tokens: 25 } }; }
function stream(events: unknown[], chunkSize = 11) {
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset += chunkSize)); } });
}
function memoryStore() {
  let row: RecordRow = { id, question: input.question, type: input.type, status: "running", tokens: 7, costUsd: null, harnessTaskId: "resp_test" };
  let tombstone = false;
  async function assertAvailable() { if (row.status === "unpublished" || tombstone) throw unpublishedError(); }
  const storage: InvestigationStore = {
    async create() {}, async load() { return { ...row }; }, assertAvailable,
    async update(_, patch) { await assertAvailable(); row = { ...row, ...patch }; }, async claims() { return [claim]; },
  };
  return { storage, row: () => row, withdraw(status = true) { tombstone = true; if (status) row.status = "unpublished"; } };
}
const runtimeConfig = { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" };
function testDependencies(storage: InvestigationStore): Dependencies {
  return { store: storage, target: async () => {}, scope: async () => ({ tokens: 7 }), get: async () => response(), start: async () => new Response(stream([{ type: "response.completed", response: response() }])) };
}
describe("server withdrawal boundary", () => {
  test("withdrawn GET never fetches runtime and returns a safe 410", async () => {
    for (const status of [true, false]) {
      const memory = memoryStore(); memory.withdraw(status);
      let called = false;
      const deps = { ...testDependencies(memory.storage), get: async () => { called = true; return response(); } };
      let failure: unknown;
      try { await loadResult(id, deps); } catch (error) { failure = error; }
      expect(called).toBe(false);
      const result = publicError(failure);
      expect(result.status).toBe(410);
      expect(await result.json()).toEqual({ error: { code: "unpublished", message: "This report is unpublished while the team reviews its evidence." } });
    }
  });
  test("withdrawal during source hydration prevents completion and content release", async () => {
    const memory = memoryStore();
    await expect(finish(memory.row(), response(), memory.storage, async () => { memory.withdraw(); return []; })).rejects.toThrow("unpublished");
    expect(memory.row().status).toBe("unpublished");
    expect(memory.row().tokens).toBe(7);
  });
  test("withdrawal while GET awaits runtime blocks its recovered answer", async () => {
    const keys = ["INVESTIGATIONS_RUNTIME_READY", "HR_API_KEY", "HR_SCOPE_HARNESS_ID", "HR_FOOTPRINT_HARNESS_ID"] as const;
    const previous = keys.map((key) => process.env[key]);
    keys.forEach((key) => { process.env[key] = key === "INVESTIGATIONS_RUNTIME_READY" ? "1" : "test-only"; });
    try {
      const memory = memoryStore();
      await expect(loadResult(id, { ...testDependencies(memory.storage), get: async () => { memory.withdraw(); return response(); } })).rejects.toThrow("unpublished");
      expect(memory.row().status).toBe("unpublished");
    } finally {
      keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    }
  });
  test("withdrawal after completion write still blocks the streamed result", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    const original = memory.storage.update;
    memory.storage.update = async (recordId, patch) => { await original(recordId, patch); if (patch.status === "completed") memory.withdraw(); };
    await consume(input, id, runtimeConfig, (event) => events.push(event), testDependencies(memory.storage));
    expect(memory.row().status).toBe("unpublished");
    expect(events.some((event) => (event as { event: string }).event === "result")).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "unpublished" } });
    expect(JSON.stringify(events)).not.toContain(sentence);
  });
  test("failed metadata guard blocks GET and stream without contacting runtime", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    memory.storage.assertAvailable = async () => { throw new Error("Metadata unavailable"); };
    let called = false;
    const deps = { ...testDependencies(memory.storage), get: async () => { called = true; return response(); }, start: async () => { called = true; throw new Error("Unexpected runtime call"); } };
    let failure: unknown;
    try { await loadResult(id, deps); } catch (error) { failure = error; }
    expect(publicError(failure).status).toBe(503);
    await consume(input, id, runtimeConfig, (event) => events.push(event), deps);
    expect(called).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: "error" });
    expect(JSON.stringify(events)).not.toContain(sentence);
  });
});
describe("investigation evidence boundary", () => {
  test("accepts public target input and requires bill identifiers", () => {
    expect(parseInput(input)).toEqual(input);
    // SB 329 is a real bill: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB329
    expect(parseInput({ type: "bill", question: "How did every member vote on SB 329?", target: { bill_id: "sb 329" } })).toEqual({ type: "bill", question: "How did every member vote on SB 329?", target: { bill_id: "SB 329" } });
    expect(() => parseInput({ ...input, target: { entity_id: "' OR true" } })).toThrow();
    expect(() => parseInput({ ...input, question: "Find my neighbor's home address" })).toThrow("private-person");
  });
  test("accepts a general question without a target and keeps targeted types strict", async () => {
    // CA HOMES COMMITTEE is the fixture filer above (calaccess:filer:1481256).
    const general = { type: "general" as const, question: "Which recipients received campaign contributions from CA HOMES COMMITTEE?" };
    expect(parseInput(general)).toEqual(general);
    // A stray target is dropped, never forwarded to the harness.
    expect(parseInput({ ...general, target: { entity_id: "' OR true" } })).toEqual(general);
    expect(() => parseInput({ ...general, question: "What is the home address of the CA HOMES COMMITTEE treasurer?" })).toThrow("private-person");
    expect(() => parseInput({ ...general, question: " " })).toThrow();
    expect(() => parseInput({ ...general, type: "anything" })).toThrow("investigation type");
    for (const type of ["measure", "footprint", "interests"]) expect(() => parseInput({ type, question: general.question })).toThrow();
    expect(() => parseInput({ type: "bill", question: "Who lobbied on SB 329?" })).toThrow();
    await expect(validateTarget({ type: "general", question: general.question })).resolves.toBeUndefined();
  });
  test("general uses its own harness id and fails closed without one", () => {
    const env = { INVESTIGATIONS_RUNTIME_READY: "1", HR_API_KEY: "test-only", HR_SCOPE_HARNESS_ID: "test-scope", HR_GENERAL_HARNESS_ID: "test-general", HR_BILL_HARNESS_ID: "test-bill" } as unknown as NodeJS.ProcessEnv;
    expect(configuration("general", env).harnessId).toBe("test-general");
    expect(configuration("bill", env).harnessId).toBe("test-bill");
    expect(() => configuration("general", { ...env, HR_GENERAL_HARNESS_ID: undefined } as NodeJS.ProcessEnv)).toThrow("setup is pending");
  });
  test("general prefers the ask harness once it is configured", () => {
    const env = { INVESTIGATIONS_RUNTIME_READY: "1", HR_API_KEY: "test-only", HR_SCOPE_HARNESS_ID: "test-scope", HR_GENERAL_HARNESS_ID: "test-general", HR_ASK_HARNESS_ID: "test-ask", HR_BILL_HARNESS_ID: "test-bill" } as unknown as NodeJS.ProcessEnv;
    expect(configuration("general", env).harnessId).toBe("test-ask");
    expect(configuration("bill", env).harnessId).toBe("test-bill");
    expect(configuration("general", { ...env, HR_ASK_HARNESS_ID: "" } as NodeJS.ProcessEnv).harnessId).toBe("test-general");
  });
  test("rejects missing, foreign and altered citations", () => {
    expect(() => parseAnswer({ ...answer, sections: [{ heading: "Funding", sentences: [{ text: sentence }] }] })).toThrow();
    expect(() => validateClaims(answer, [])).toThrow();
    expect(() => validateClaims(answer, [{ ...claim, text: "Changed." }])).toThrow();
    expect(() => validateClaims(answer, [claim])).not.toThrow();
  });
  test("rejects uncited summary, card and factual heading channels", () => {
    expect(() => parseAnswer({ ...answer, summary: "An uncited statement." })).toThrow();
    expect(() => parseAnswer({ ...answer, card: { title: "Funding", claim_ids: [crypto.randomUUID()] } })).toThrow();
    expect(() => parseAnswer({ ...answer, sections: [{ ...answer.sections[0], heading: sentence }] })).toThrow();
  });
  test("accepts labeled web sentences beside recorded claims and checks only the claims", () => {
    // SB 329's official bill page (leginfo) is a real public URL; the sentence describes only where the text is published.
    const web = { text: "The Legislature publishes the text and history of SB 329 on its bill information site.", source: { url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB329", title: "SB 329 bill information" } };
    const mixed = { summary: web.text, sections: [{ heading: "Context", sentences: [web] }, ...answer.sections], card: answer.card };
    const parsed = parseAnswer(mixed);
    expect(parsed.sections[0].sentences[0]).toEqual(web);
    expect(() => validateClaims(parsed, [claim])).not.toThrow();
    expect(() => validateClaims(parsed, [])).toThrow();
    // A web-only answer has an empty card: there are no verified claims to share.
    const webOnly = parseAnswer({ summary: web.text, sections: [{ heading: "Background", sentences: [web] }], card: { title: "Background", claim_ids: [] } });
    expect(() => validateClaims(webOnly, [])).not.toThrow();
  });
  test("rejects unsafe or ambiguous web sources", () => {
    const base = { text: "The Legislature publishes the text and history of SB 329 on its bill information site.", source: { url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB329", title: "SB 329 bill information" } };
    const wrap = (sentence: unknown) => ({ summary: "", sections: [{ heading: "Context", sentences: [sentence] }], card: { title: "Context", claim_ids: [] } });
    for (const url of ["http://leginfo.legislature.ca.gov/", "javascript:alert(1)", "https://user:pass@leginfo.legislature.ca.gov/", "not a url", "https://localhost/"]) {
      expect(() => parseAnswer(wrap({ ...base, source: { ...base.source, url } }))).toThrow();
    }
    expect(() => parseAnswer(wrap({ ...base, source: { ...base.source, title: "x".repeat(201) } }))).toThrow();
    expect(() => parseAnswer(wrap({ ...base, claim_id: claimId }))).toThrow();
    expect(() => parseAnswer(wrap({ ...base, text: "The committee was rigged." }))).toThrow();
    // A web sentence's ID cannot enter the card.
    expect(() => parseAnswer({ ...wrap(base), card: { title: "Context", claim_ids: [claimId] } })).toThrow();
    // Third-party titles with banned wording fall back to the domain.
    expect((parseAnswer(wrap({ ...base, source: { ...base.source, title: "A rigged headline" } })).sections[0].sentences[0] as { source: { title: string } }).source.title).toBe("leginfo.legislature.ca.gov");
  });
  test("interview sentences carry only insight: true and never enter the card", () => {
    // Wording only; no interview figure is stated, so nothing here is invented data.
    const insight = { text: "Aletheia's interview insights page lists the issues voters raise.", insight: true as const };
    const wrap = (sentence: unknown, card: unknown = { title: "Interviews", claim_ids: [] }) => ({ summary: "", sections: [{ heading: "Interviews", sentences: [sentence] }], card });
    expect(parseAnswer(wrap(insight)).sections[0].sentences[0]).toEqual(insight);
    expect(() => validateClaims(parseAnswer(wrap(insight)), [])).not.toThrow();
    expect(() => parseAnswer(wrap({ ...insight, insight: "yes" }))).toThrow();
    expect(() => parseAnswer(wrap({ ...insight, claim_id: claimId }))).toThrow();
    expect(() => parseAnswer(wrap({ ...insight, source: { url: "https://leginfo.legislature.ca.gov/", title: "leginfo" } }))).toThrow();
    expect(() => parseAnswer(wrap(insight, { title: "Interviews", claim_ids: [claimId] }))).toThrow();
  });
  test("an optional study draft is validated strictly", () => {
    // Text reuses the study builder's own placeholder copy (apps/web/src/app/interview/forms.tsx), not filing data.
    const study = { sponsor_kind: "business", title: "What customers want from energy rebates", goal: "Which state programs people use, and what is missing.", questions: ["Have you used a state energy rebate?", "What stopped you, if anything?"], fields: { standard: ["county", "ageRange"] }, size: 50 };
    const base = { summary: "", sections: [{ heading: "Study", sentences: [] }], card: { title: "Study", claim_ids: [] } };
    expect(parseAnswer({ ...base, study }).study).toEqual(study as never);
    expect(parseAnswer(base).study).toBeUndefined();
    for (const bad of [
      { ...study, sponsor_kind: "nonprofit" }, { ...study, size: 30 }, { ...study, questions: [] }, { ...study, questions: Array(7).fill("Q?").map((q, i) => `${q}${i}`) },
      { ...study, fields: { standard: ["email"] } }, { ...study, title: "x".repeat(121) }, { ...study, goal: "Whether the vote was rigged." },
      { ...study, questions: ["What is your home address?"] }, { ...study, fields: { standard: [], custom: [{ label: "Rent or own?", options: ["Rent"] }] } },
    ]) expect(() => parseAnswer({ ...base, study: bad })).toThrow();
  });
  test("summary can be empty when records cannot support findings", () => {
    expect(parseAnswer({ summary: "", sections: [{ heading: "Findings", sentences: [] }], card: { title: "Findings", claim_ids: [] } }).summary).toBe("");
  });
  test("extractor rejects private and malformed scope without forwarding a task", async () => {
    const config = { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" };
    const fetcher = async () => Response.json({ id: "resp_test", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ scope: "private_person" }) }] }], usage: { total_tokens: 7 } });
    await expect(extractScope(input, config, fetcher)).rejects.toThrow("private-person");
    const outside = async () => Response.json({ id: "resp_test", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ scope: "out_of_scope" }) }] }] });
    await expect(extractScope(input, config, outside)).rejects.toThrow("public affairs");
  });
});
describe("runtime stream and recovery", () => {
  test("parses split UTF8 and CRLF frames, ignoring unknown events", async () => {
    const events = [{ type: "response.created", note: "é" }, { type: "unknown" }];
    const got = []; for await (const event of runtimeEvents(stream(events, 1))) got.push(event);
    expect(got).toEqual(events);
  });
  test("takes final message only and never counts absent usage as zero", () => {
    const result = { ...response(), output: [{ type: "message", content: [{ type: "output_text", text: "Progress" }] }, ...response().output] };
    expect(lastText(result)).toBe(JSON.stringify(answer)); expect(answerFrom(result)).toEqual(answer);
    expect(tokenCount({})).toBeNull();
  });
  test("an incomplete task is accepted only when its last message is a valid answer", () => {
    expect(answerFrom({ ...response(), status: "incomplete" })).toEqual(answer);
    const cut = { ...response(), status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "Checking more filings" }] }] };
    expect(() => answerFrom(cut)).toThrow("This question took too long. Try a narrower question.");
    expect(() => answerFrom({ ...response(), status: "failed" })).toThrow("took too long");
  });
  test("Ask tasks run under tighter step and time limits than record investigations", () => {
    expect(taskLimits("general")).toEqual({ max_step: 30, timeout_seconds: 180, max_cost_usd: 2 });
    expect(taskLimits("measure")).toEqual({ max_step: 100, timeout_seconds: 240, max_cost_usd: 2 });
    // Scope check (60 s) plus the Ask task must fit the route's 300 s maxDuration.
    expect(60 + taskLimits("general").timeout_seconds).toBeLessThan(300);
  });
  test("a stream that stops at its limit reports a plain message", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    const cut = { ...response(), status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "Checking more filings" }] }] };
    const deps: Dependencies = { store: memory.storage, target: async () => {}, scope: async () => ({ tokens: 7 }), get: async () => cut, start: async () => new Response(stream([
      { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
      { type: "response.incomplete", response: cut },
    ])) };
    await consume(input, id, { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" }, (event) => events.push(event), deps);
    expect(memory.row().status).toBe("incomplete");
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "incomplete", message: "This question took too long. Try a narrower question." } });
  });
  test("a stream that stops at its limit after writing a valid answer still completes", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    const done = { ...response(), status: "incomplete" };
    const deps: Dependencies = { store: memory.storage, target: async () => {}, scope: async () => ({ tokens: 7 }), get: async () => done, start: async () => new Response(stream([
      { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
      { type: "response.incomplete", response: done },
    ])) };
    await consume(input, id, { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" }, (event) => events.push(event), deps);
    expect(memory.row().status).toBe("completed");
    expect(events.at(-1)).toMatchObject({ event: "result", data: { status: "completed" } });
  });
  test("validates claims before completing and does not double count repeated reads", async () => {
    const memory = memoryStore();
    const result = await finish(memory.row(), response(), memory.storage);
    expect(result.tokens).toBe(32); expect(result.cost_usd).toBeNull(); expect(result.verification_status).toBe("pending");
    expect(result.claims[0].verdict).toBeNull();
    expect((await finish(memory.row(), response(), memory.storage)).tokens).toBe(32);
  });
  test("stream persists response id and forwards only sanitized progress", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    const deps: Dependencies = { store: memory.storage, target: async () => {}, scope: async () => ({ tokens: 7 }), get: async () => response(), start: async () => new Response(stream([
      { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
      { type: "response.output_item.added", item: { arguments: "DO NOT LEAK" } },
      { type: "response.output_text.delta", delta: "DO NOT LEAK" },
      { type: "response.completed", response: response() },
    ])) };
    await consume(input, id, { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" }, (event) => events.push(event), deps);
    expect(memory.row().status).toBe("completed"); expect(JSON.stringify(events)).not.toContain("DO NOT LEAK");
    expect(events.at(-1)).toMatchObject({ event: "result", data: { verification_status: "pending" } });
  });
  test("a truncated stream retains the upstream id for GET recovery", async () => {
    const memory = memoryStore(), events: unknown[] = [];
    const deps: Dependencies = { store: memory.storage, target: async () => {}, scope: async () => ({ tokens: 7 }), get: async () => response(), start: async () => new Response(stream([{ type: "response.created", response: { id: "resp_test", status: "in_progress" } }])) };
    await consume(input, id, { key: "test-only", scopeHarnessId: "test-only", harnessId: "test-only" }, (event) => events.push(event), deps);
    expect(memory.row().status).toBe("running"); expect(memory.row().harnessTaskId).toBe("resp_test");
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "interrupted" } });
  });
});

describe("private API authorization", () => {
  test("rejects a request without a team session", async () => {
    await expect(authorize(new Request("https://example.invalid/api/investigations"))).rejects.toThrow();
  });
  test("requires a same-origin authenticated POST and never permits PUBLIC_SITE", async () => {
    const previous = { TEAM_PASSWORD: process.env.TEAM_PASSWORD, TEAM_SESSION_SECRET: process.env.TEAM_SESSION_SECRET, PUBLIC_SITE: process.env.PUBLIC_SITE };
    // Auth keys/host are generated test infrastructure, not filing data or usable credentials.
    process.env.TEAM_PASSWORD = crypto.randomUUID();
    process.env.TEAM_SESSION_SECRET = crypto.randomUUID();
    process.env.PUBLIC_SITE = "off";
    try {
      const token = await createSessionToken(authConfig()!, Date.now());
      const headers = { cookie: `aletheia_team=${token}`, origin: "https://example.invalid" };
      await expect(authorize(new Request("https://example.invalid/api/investigations", { method: "POST", headers }))).resolves.toBeUndefined();
      await expect(authorize(new Request("https://example.invalid/api/investigations", { method: "POST", headers: { ...headers, origin: "https://different.invalid" } }))).rejects.toThrow("private site");
      process.env.PUBLIC_SITE = "on";
      await expect(authorize(new Request("https://example.invalid/api/investigations", { method: "POST", headers }))).rejects.toThrow("private preview");
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
