import { expect, test } from "bun:test";
import { createTokenRouterJudge, tokenRouterConfiguration, TOKENROUTER_BASE_URL } from "../src/tokenrouter";
import { continuationPayload, createHarnessRepair } from "../src/continuation";
import { FIXTURES, setup } from "./harness";
// Model IDs are syntactic offline routing fixtures, not claimed live catalog availability. No real key exists here.
const env = { TOKENROUTER_API_KEY: "offline-not-a-credential", VERIFIER_MODEL: "anthropic/offline-fixture", VERIFIER_MODEL_FAMILY: "claude", WRITER_MODEL: "openai/offline-fixture", WRITER_MODEL_FAMILY: "gpt", VERIFIER_HOST_CONFIRMED: "1", VERIFIER_ROUTING_READY: "1", VERIFIER_CATALOG_CONFIRMED: "1" };
test("missing keys/host/catalog/routing/family configuration is unavailable before fetch", () => {
  for (const name of Object.keys(env)) expect(() => tokenRouterConfiguration({ ...env, [name]: undefined })).toThrow();
  expect(() => tokenRouterConfiguration({ ...env, TOKENROUTER_BASE_URL: "https://api.tokenrouter.io/v1" })).toThrow();
  expect(() => tokenRouterConfiguration({ ...env, VERIFIER_MODEL: env.WRITER_MODEL, VERIFIER_MODEL_FAMILY: env.WRITER_MODEL_FAMILY })).toThrow();
  expect(() => tokenRouterConfiguration({ ...env, VERIFIER_MODEL_FAMILY: "gpt" })).toThrow();
  expect(() => tokenRouterConfiguration({ ...env, VERIFIER_MODEL: "unknown/offline-fixture" })).toThrow();
});
test("request uses exact sponsor host with no redirects/tools/writer context and strict response model identity", async () => {
  const h = setup(FIXTURES[0]), config = tokenRouterConfiguration(env), calls: string[] = [];
  const judge = createTokenRouterJudge(config, async (url, init) => {
    calls.push(url);
    expect(url).toBe(`${TOKENROUTER_BASE_URL}/chat/completions`);
    expect(init?.redirect).toBe("error");
    const request = JSON.parse(String(init?.body));
    expect(request.model).toBe(config.model);
    expect(request.tools).toBeUndefined();
    expect(Object.keys(JSON.parse(request.messages[1].content)).sort()).toEqual(["rows", "sentence"]);
    expect(JSON.parse(request.messages[1].content).rows).toEqual(h.rows);
    return Response.json({ model: config.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ verdict: "supported", reason: "Offline response fixture." }) } }] });
  });
  expect(await judge.assess({ sentence: h.sentence.text, rows: h.rows })).toMatchObject({ verdict: "supported" });
  expect(calls).toHaveLength(1);
});
test("provider faults never trigger a fallback or supported verdict", async () => {
  for (const problem of ["http", "model", "missing_model", "json", "verdict", "truncated", "tools", "network"] as const) {
    const config = tokenRouterConfiguration(env), h = setup(FIXTURES[0]); let calls = 0;
    const judge = createTokenRouterJudge(config, async () => {
      calls++;
      if (problem === "network") throw new Error("offline network failure");
      if (problem === "http") return new Response("offline failure", { status: 503 });
      return Response.json({ ...(problem !== "missing_model" ? { model: problem === "model" ? env.WRITER_MODEL : config.model } : {}), choices: [{ finish_reason: problem === "truncated" ? "length" : "stop", message: { ...(problem === "tools" ? { tool_calls: [] } : {}), content: problem === "json" ? "not-json" : JSON.stringify({ verdict: problem === "verdict" ? "uncertain" : "supported", reason: "Offline response fixture." }) } }] });
    });
    await expect(judge.assess({ sentence: h.sentence.text, rows: h.rows })).rejects.toThrow();
    expect(calls).toBe(1);
  }
});
test("continuation payload carries failure reasons and the current response/session/harness mapping", () => {
  const h = setup(FIXTURES[0]);
  const request = { session: h.session, sentence: h.sentence, claim: h.claim, failures: [{ check: "numbers" as const, code: "number_mismatch", message: "Amount differs from cited rows." }], retry: 1 as const };
  const payload = continuationPayload(request);
  expect(payload.previous_response_id).toBe(h.session.response_id);
  expect(payload.metadata).toEqual({ harness_id: h.session.harness_id, session_id: h.session.session_id });
  expect(JSON.parse(payload.input).failures).toEqual(request.failures);
});
test("repair adapter reloads recorded claims rather than accepting writer-supplied evidence", async () => {
  const h = setup(FIXTURES[0]);
  const request = { session: h.session, sentence: h.sentence, claim: h.claim, failures: [], retry: 1 as const };
  let loads = 0;
  const repair = createHarnessRepair(async (payload) => ({ response_id: `${payload.previous_response_id}_next`, session_id: payload.metadata.session_id, harness_id: payload.metadata.harness_id, output: { sentence: h.sentence, plan: h.plan } }), async (investigationId, claimId) => {
    loads++; expect(investigationId).toBe(h.session.investigation_id); expect(claimId).toBe(h.claim.claim_id); return h.claim;
  });
  const response = await repair(request);
  expect(loads).toBe(1);
  expect(response.previous_response_id).toBe(h.session.response_id);
  expect(response.session.session_id).toBe(h.session.session_id);
  expect(response.session.response_id).not.toBe(h.session.response_id);
});
test("repair adapter rejects changed sessions and nonexistent recorded claims", async () => {
  const h = setup(FIXTURES[0]), request = { session: h.session, sentence: h.sentence, claim: h.claim, failures: [], retry: 1 as const };
  for (const badSession of [true, false]) {
    const repair = createHarnessRepair(async (payload) => ({ response_id: `${payload.previous_response_id}_next`, session_id: badSession ? `${payload.metadata.session_id}_other` : payload.metadata.session_id, harness_id: payload.metadata.harness_id, output: { sentence: h.sentence, plan: h.plan } }), async () => undefined);
    await expect(repair(request)).rejects.toThrow();
  }
});
test("read adapter exposes only existing query and vote_base_rate tools without a database client", async () => {
  const { createReadTools } = await import("../src/tools");
  const h = setup(FIXTURES[0]), calls: string[] = [];
  const tools = createReadTools(async (name, args) => {
    calls.push(name);
    const value = name === "query" ? await h.tools.query(args.sql) : await h.tools.voteBaseRate(args.bill_id, args.motion);
    return { content: [{ type: "text", text: JSON.stringify(value) }] };
  });
  expect(Object.keys(tools).sort()).toEqual(["query", "voteBaseRate"]);
  const { evidenceSql } = await import("../src/evidence");
  expect((await tools.query(evidenceSql(h.claim.edge_ids))).rows).toHaveLength(1);
  expect(calls).toEqual(["query"]);
  const unavailable = createReadTools(async () => ({ isError: true, content: [{ type: "text", text: "offline failure" }] }));
  await expect(unavailable.query(evidenceSql(h.claim.edge_ids))).rejects.toThrow();
});
