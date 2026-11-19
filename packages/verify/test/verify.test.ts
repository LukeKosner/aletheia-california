import { describe, expect, test } from "bun:test";
import { checkBaseRate, numberTokens } from "../src/checks";
import { aggregateSql, cents, evidenceSql } from "../src/evidence";
import { verifyInvestigation, verifySentence } from "../src/verify";
import { FIXTURES, setup } from "./harness";
import type { Dependencies } from "../src/types";
function deps(h: ReturnType<typeof setup>): Dependencies { return { ...h, plans: { [h.claim.claim_id]: h.plan } }; }
describe("30 sourced negative examples (deliberate mutations, never factual claims)", () => {
  expect(FIXTURES).toHaveLength(30);
  for (const [i, fixture] of FIXTURES.entries()) test(`${i + 1}: ${fixture.kind} fails ${fixture.expected_check}/${fixture.expected_code}`, async () => {
    expect(fixture.original.source.url).toStartWith("https://");
    const original = setup(fixture);
    const supported = await verifySentence(original.sentence, original.claim, original.plan, original);
    expect(supported.failures).toEqual([]); // Offline model stub only, not a live provider verdict.
    const mutated = setup(fixture, true);
    const checked = await verifySentence(mutated.sentence, mutated.claim, mutated.plan, mutated);
    expect(checked.failures[0]).toMatchObject({ check: fixture.expected_check, code: fixture.expected_code });
    if (["amount", "name", "base_rate"].includes(fixture.kind)) expect(mutated.modelInputs).toHaveLength(0);
    else expect(mutated.modelInputs).toHaveLength(1);
  });
});
test("claim text, evidence IDs and exact filing set are checked before arithmetic or model", async () => {
  for (const mutation of ["text", "filing", "truncation", "missing"] as const) {
    const h = setup(FIXTURES[0]);
    if (mutation === "text") h.claim.text = FIXTURES[1].original.sentence;
    if (mutation === "filing") h.claim.filing_ids = [];
    if (mutation === "truncation") h.tools.query = async () => ({ rows: [], truncated: true });
    if (mutation === "missing") h.claim.edge_ids = [FIXTURES[1].original.edge!.id];
    expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].check).toBe("binding");
    expect(h.modelInputs).toHaveLength(0);
  }
});
test("every number including dates, percentages, counts and amount spans requires one computation", async () => {
  const h = setup(FIXTURES[0]);
  expect((await verifySentence(h.sentence, h.claim, { numbers: [] }, h)).failures[0].code).toBe("number_unbound");
  expect((await verifySentence(h.sentence, h.claim, undefined, h)).failures[0].code).toBe("plan_missing");
  expect(numberTokens("2026-03-13; $1,175,000.00; 38 of 40; 95%.").map((t) => t.text)).toEqual(["2026-03-13", "$1,175,000.00", "38", "40", "95%"]); // All values occur in cited fixture records; punctuation is test infrastructure.
});
test("SQL is fixed, scoped to UUID citations and never taken from a plan", () => {
  const h = setup(FIXTURES[0]);
  expect(evidenceSql(h.claim.edge_ids)).toContain("where edge_id in (");
  expect(() => evidenceSql(["'; delete from claim; --"])).toThrow();
  expect(() => evidenceSql([...h.claim.edge_ids, ...h.claim.edge_ids])).toThrow();
  expect(aggregateSql(h.rows, "sum_amount")).toStartWith("select sum(value)::text");
  expect(cents("1175000.00")).toBe(117500000n); // Filing 3128904, amendment 0, F497P1 line 1 (fixture URL).
});
test("verified output uses hydrated source rows and never mutates P9 pending result", async () => {
  const h = setup(FIXTURES[0]), snapshot = structuredClone(h.result);
  h.claim.verdict = "supported"; h.claim.verifier_model = "untrusted-writer-value";
  h.claim.sources = [{ filing_id: h.claim.filing_ids[0], title: "untrusted", url: "https://example.invalid/" }];
  const out = await verifyInvestigation(h.result, deps(h));
  expect(out.result.verification_status).toBe("verified");
  expect(out.result.claims[0].sources?.[0].url).toBe(FIXTURES[0].original.source.url);
  expect(out.result.claims[0].verifier_model).toBe(h.judge.model);
  expect(snapshot.verification_status).toBe(h.result.verification_status);
  expect(h.result.answer).toEqual(snapshot.answer);
  expect(h.queries.some((q) => q.startsWith("select sum"))).toBe(true);
});
test("missing existing session fails closed without tools/model", async () => {
  const h = setup(FIXTURES[0]), d = deps(h); d.session.response_id = "";
  const out = await verifyInvestigation(h.result, d);
  expect(out.result).toMatchObject({ verification_status: "failed", answer: null, claims: [] });
  expect(h.queries).toHaveLength(0);
});
test("two same-session retries then remove unsafe sentence, summary and card references", async () => {
  const h = setup(FIXTURES[0], true), d = deps(h), requests: unknown[] = [];
  d.repair = async (request) => { requests.push(structuredClone(request)); return { session: { ...request.session, response_id: `${request.session.response_id}_next` }, previous_response_id: request.session.response_id, sentence: h.sentence, claim: h.claim, plan: h.plan }; };
  const out = await verifyInvestigation(h.result, d);
  expect(requests).toHaveLength(2);
  expect(requests).toEqual([expect.objectContaining({ session: h.session, retry: 1 }), expect.objectContaining({ session: { ...h.session, response_id: `${h.session.response_id}_next` }, retry: 2 })]);
  expect(out.result).toMatchObject({ verification_status: "failed", answer: null, claims: [] });
  expect(out.audit[0]).toMatchObject({ attempts: 3, verdict: "unsupported" });
  expect(out.removed_claim_ids).toEqual([h.claim.claim_id]);
});
test("repair cannot start or substitute another HR session", async () => {
  const h = setup(FIXTURES[0], true), d = deps(h);
  d.repair = async (request) => ({ session: { ...request.session, session_id: `${request.session.session_id}_different`, response_id: `${request.session.response_id}_next` }, previous_response_id: request.session.response_id, sentence: h.sentence, claim: h.claim, plan: h.plan });
  const out = await verifyInvestigation(h.result, d);
  expect(out.audit[0].reasons[0].code).toBe("repair_session");
  expect(out.result.answer).toBeNull();
});
test("successful repair is fully rechecked and updates the cited summary and card", async () => {
  const h = setup(FIXTURES[0], true), d = deps(h);
  d.repair = async (request) => {
    const text = FIXTURES[0].original.sentence;
    return { session: { ...request.session, response_id: `${request.session.response_id}_next` }, previous_response_id: request.session.response_id, sentence: { ...h.sentence, text }, claim: { ...h.claim, text }, plan: h.planFor(text) };
  };
  const out = await verifyInvestigation(h.result, d);
  expect(out.result.answer?.summary).toBe(FIXTURES[0].original.sentence);
  expect(out.audit[0].attempts).toBe(2);
  expect(out.result.verification_status).toBe("verified");
});
test("independent model gets only sentence and fresh rows, fails closed on error/overstatement", async () => {
  for (const mode of ["error", "overstated"] as const) {
    const h = setup(FIXTURES[0]);
    h.judge.assess = async (input) => {
      expect(Object.keys(input).sort()).toEqual(["rows", "sentence"]);
      expect(JSON.stringify(input)).not.toContain("writer chat");
      if (mode === "error") throw new Error("unavailable");
      return { verdict: "overstated", reason: "The cited row does not support this scope." };
    };
    expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0]).toMatchObject({ check: "model", code: mode === "error" ? "model_unavailable" : "overstated" });
  }
});
test("money/vote comparison needs all-member counts for the exact roll call", () => {
  const h = setup(FIXTURES.find((f) => f.kind === "base_rate")!);
  const money = setup(FIXTURES[0]).rows[0];
  expect(checkBaseRate("Funding and voting are recorded.", { numbers: [] }, [...h.rows, money])[0].code).toBe("base_rate_missing");
  expect(checkBaseRate(`Funding is recorded separately; ${h.sentence.text}`, h.plan, [...h.rows, money])).toEqual([]);
});
test("partial output retains only supported sentence IDs and removes rejected summary", async () => {
  const h = setup(FIXTURES[0]);
  const otherId = crypto.randomUUID(); // Claim identifier, never a source record ID.
  const bad = { ...h.claim, claim_id: otherId, text: FIXTURES[0].negative_example };
  h.result.claims.push(bad);
  h.result.answer!.sections[0].sentences.push({ claim_id: otherId, text: bad.text });
  h.result.answer!.summary = bad.text;
  h.result.answer!.card.claim_ids.push(otherId);
  const d = deps(h); d.plans[otherId] = h.planFor(bad.text);
  const out = await verifyInvestigation(h.result, d);
  expect(out.result.verification_status).toBe("partial");
  expect(out.result.answer!.summary).toBe("");
  expect(out.result.answer!.card.claim_ids).toEqual([h.claim.claim_id]);
  expect(out.result.claims.map((c) => c.claim_id)).toEqual([h.claim.claim_id]);
});
test("likely donor language is required and likely cross-entity amounts cannot become a total", async () => {
  const h = setup(FIXTURES[0]);
  h.claim.confidence = "likely";
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("likely_wording");
  // Deliberately injected negative metadata, not a claim that these real parties are related.
  const [from, to] = h.entities;
  from.attrs = { likely_same_donor: [{ entity_key: to.canonical_key, label: "likely the same donor" }] };
  h.claim.confidence = "high";
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("likely_wording");
  h.claim.text += " They are likely the same donor."; h.sentence.text = h.claim.text;
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("likely_total");
});
test("base rate refuses incomplete, duplicate and mismatched all-member data", async () => {
  for (const issue of ["truncated", "duplicate", "wrong_member", "counts"] as const) {
    const h = setup(FIXTURES.find((f) => f.kind === "base_rate")!);
    const original = h.tools.voteBaseRate;
    h.tools.voteBaseRate = async (...args) => {
      const b = await original(...args);
      if (issue === "truncated") b.truncated = true;
      if (issue === "duplicate") b.roll_calls[0].members.push(b.roll_calls[0].members[0]);
      if (issue === "wrong_member") b.roll_calls[0].members[0].result = "no";
      if (issue === "counts") b.roll_calls[0].counts.total++;
      return b;
    };
    expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("recompute_unavailable");
  }
});

test("malformed plans and written-out numbers fail closed before the model", async () => {
  const h = setup(FIXTURES[0]);
  expect((await verifySentence(h.sentence, h.claim, { numbers: [null] } as never, h)).failures[0].check).toBe("numbers");
  h.claim.text = h.claim.text.replace(/\$[\d,.]+/u, "one million dollars"); h.sentence.text = h.claim.text;
  expect((await verifySentence(h.sentence, h.claim, { numbers: [] }, h)).failures[0].code).toBe("number_format"); // Explicitly false negative example, never a factual source record.
  expect(h.modelInputs).toHaveLength(0);
});
test("reusing a claim ID cannot bypass checking altered sentence text", async () => {
  const h = setup(FIXTURES[0]);
  h.result.answer!.sections[0].sentences.push({ claim_id: h.claim.claim_id, text: FIXTURES[0].negative_example });
  const out = await verifyInvestigation(h.result, deps(h));
  expect(out.result.verification_status).toBe("failed");
  expect(out.audit[0].reasons[0].code).toBe("invalid_envelope");
  expect(h.queries).toHaveLength(0);
});
test("matching writer verdicts cannot replace the independent model", async () => {
  const h = setup(FIXTURES[0]); h.claim.verdict = "supported"; h.claim.verifier_model = h.judge.model;
  h.judge.assess = async () => { throw new Error("offline unavailable"); };
  const out = await verifyInvestigation(h.result, deps(h));
  expect(out.result.verification_status).toBe("failed");
  expect(out.audit[0].reasons[0].code).toBe("model_unavailable");
});

// Resolution metadata below is deliberately injected test infrastructure, not a factual
// relationship between these parties. All IDs/keys/names are copied from fixture originals:
// CAL-ACCESS export SHA-256 6b14bf50067fddd45ea5b1bf43ce6fbc62297d8ce4df1b1eaca6c82cfacc9476;
// each original carries its filing PDF URL in fixtures.json (no new public-record data).
function resolvedMembers(linked = true) {
  const h = setup(FIXTURES[0]);
  const roots = [setup(FIXTURES[1]).entities[1], setup(FIXTURES[3]).entities[0]].map((e) => structuredClone(e));
  for (const [i, root] of roots.entries()) {
    root.attrs = { resolved_entity_id: root.id, resolved_entity_key: root.canonical_key };
    h.entities[i].attrs = { resolved_entity_id: root.id, resolved_entity_key: root.canonical_key };
    h.entities.push(root);
  }
  if (linked) roots[0].attrs = { ...(roots[0].attrs as object), likely_same_donor: [{ entity_key: roots[1].canonical_key, label: "likely the same donor" }] };
  return { h, roots };
}
test("likely links on resolved roots qualify nonroot citations and reject their donor total", async () => {
  const { h } = resolvedMembers();
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("likely_wording");
  h.claim.text += " They are likely the same donor."; h.sentence.text = h.claim.text;
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("likely_total");
  expect(h.modelInputs).toHaveLength(0);
});
test("judge receives actual resolved roots and their likely metadata for nonroot citations", async () => {
  const { h, roots } = resolvedMembers();
  h.claim.text += " They are likely the same donor."; h.sentence.text = h.claim.text;
  h.plan.numbers = h.plan.numbers.map((n) => ({ ...n, operation: "field", field: "amount" }));
  h.judge.assess = async ({ rows }) => {
    expect(rows[0].record._entity_metadata).toEqual(h.entities);
    expect(rows[0].record._entity_metadata).toContainEqual(roots[0]);
    return { verdict: "supported", reason: "Offline resolution-context assertion only." };
  };
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures).toEqual([]);
});
test("valid unlinked resolved roots pass without changing edge identity", async () => {
  const { h } = resolvedMembers(false);
  const before = structuredClone(h.rows);
  expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures).toEqual([]);
  expect(h.rows).toEqual(before);
  expect(h.queries.filter((q) => q.includes("from v_entities"))).toHaveLength(2);
});
test("missing, malformed, inconsistent or cyclic root metadata fails closed with bounded reads", async () => {
  for (const issue of ["missing_root", "missing_metadata", "missing_key", "wrong_key", "invalid_uuid", "cycle", "chain"] as const) {
    const { h, roots } = resolvedMembers(false);
    const attrs = h.entities[0].attrs as Record<string, unknown>;
    if (issue === "missing_root") h.entities.splice(h.entities.indexOf(roots[0]), 1);
    if (issue === "missing_metadata") roots[0].attrs = {};
    if (issue === "missing_key") delete attrs.resolved_entity_key;
    if (issue === "wrong_key") attrs.resolved_entity_key = h.entities[0].canonical_key;
    if (issue === "invalid_uuid") attrs.resolved_entity_id = "'; delete from entity; --";
    if (issue === "cycle") roots[0].attrs = { resolved_entity_id: h.entities[0].id, resolved_entity_key: h.entities[0].canonical_key };
    if (issue === "chain") roots[0].attrs = { resolved_entity_id: roots[1].id, resolved_entity_key: roots[1].canonical_key };
    expect((await verifySentence(h.sentence, h.claim, h.plan, h)).failures[0].code).toBe("identity_unavailable");
    expect(h.modelInputs).toHaveLength(0);
    expect(h.queries.filter((q) => q.includes("from v_entities")).length).toBeLessThanOrEqual(2);
    expect(h.queries.some((q) => q.includes("delete from entity"))).toBe(false);
  }
});
