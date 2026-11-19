/** Offline adapter only. No database imports/connections. UUIDs created for leginfo and session/claim IDs are ephemeral test infrastructure, not asserted public-record IDs. */
import fixtures from "../fixtures.json";
import { randomUUID } from "node:crypto";
import { numberTokens } from "../src/checks";
import type { Claim, EvidenceRow, Judge, NumericAssertion, PendingInvestigation, ReadTools, RollCall, Session, VerificationPlan } from "../src/types";
export const FIXTURES = fixtures.fixtures;
export type Fixture = (typeof FIXTURES)[number];
const wrapped = (value: unknown) => ({ untrusted_text: typeof value === "string" ? value : JSON.stringify(value) });
function exactCents(value: string): bigint {
  const [whole, fraction = ""] = value.replace(/[$,]/gu, "").split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function setup(fixture: Fixture, mutated = false) {
  const original = fixture.original, text = mutated ? fixture.negative_example : original.sentence;
  const rows: EvidenceRow[] = [], entities: Record<string, unknown>[] = [], bases: RollCall[] = [];
  if ("edge" in original) {
    const e = original.edge!, f = original.filing!, from = original.from_entity!, to = original.to_entity!;
    rows.push({ id: e.id, kind: "money", record: {
      edge_id: e.id, kind: e.kind, amount: e.amount, date: e.date, schedule: e.schedule, line_item: e.line_item,
      from_entity_id: from.id, from_name: from.name, from_key: from.canonical_key,
      to_entity_id: to.id, to_name: to.name, to_key: to.canonical_key,
      filing_uuid: f.id, filing_id: f.filing_id, filing_source: f.source, amendment_no: f.amendment_no,
      filing_url: f.url, form: f.form, filed_at: f.filed_at, period_start: f.period_start, period_end: f.period_end,
    } });
    for (const entity of [from, to]) if (!entities.some((v) => v.id === entity.id)) entities.push({ id: entity.id, canonical_key: entity.canonical_key, attrs: entity.attrs });
  } else {
    const call = original.roll_call!, billId = randomUUID();
    const [month, day, year] = call.date.split("/");
    const voteDate = `20${year}-${month}-${day}`;
    const groups = [["aye", call.aye_names], ["no", call.no_names], ["nvr", call.nvr_names]] as const;
    const members = groups.flatMap(([result, names]) => names.map((name) => {
      const id = randomUUID();
      entities.push({ id, canonical_key: `${original.source_bill_id}:${name}`, attrs: {} });
      return { legislator_entity_id: id, name, result };
    }));
    const first = members[0];
    rows.push({ id: randomUUID(), kind: "vote", record: { bill_id: billId, measure: "SB-329", session: "2025-2026", vote_date: voteDate, location: call.location, motion: call.motion, legislator_entity_id: first.legislator_entity_id, legislator_name: first.name, result: first.result } });
    bases.push({ bill_id: billId, vote_date: voteDate, location: call.location, motion: call.motion, members, counts: { aye: call.ayes, no: call.noes, nvr: call.nvr, total: members.length } });
  }
  const queries: string[] = [], modelInputs: unknown[] = [];
  const tools: ReadTools = {
    async query(sql) {
      queries.push(sql);
      if (!sql.startsWith("select ") || /\b(insert|update|delete|drop|alter|grant|revoke)\b/iu.test(sql)) throw new Error("offline adapter only accepts verifier SELECTs");
      const selectedIds = [...sql.matchAll(/'([a-f0-9-]{36})'::uuid/gu)].map((m) => m[1]);
      if (sql.includes("from v_entities")) return { truncated: false, rows: entities.filter((e) => selectedIds.includes(String(e.id))).map((e) => ({ id: wrapped(e.id), canonical_key: e.canonical_key, attrs: wrapped(e.attrs) })) };
      const selected = rows.filter((r) => selectedIds.includes(r.id));
      if (sql.includes("as value from (")) {
        const value = sql.startsWith("select sum") ? selected.reduce((sum, r) => sum + exactCents(String(r.record.amount)), 0n) : BigInt(selected.length);
        const amount = sql.startsWith("select sum") ? `${value / 100n}.${String(value % 100n).padStart(2, "0")}` : String(value);
        return { rows: [{ value: wrapped(amount) }], truncated: false };
      }
      if (!sql.includes("to_jsonb")) throw new Error("unexpected verifier query");
      return { rows: selected.map((r) => ({ id: wrapped(r.id), kind: wrapped(r.kind), record: wrapped(r.record) })), truncated: false };
    },
    async voteBaseRate(billId, motion) {
      const matching = bases.filter((b) => b.bill_id === billId && b.motion.includes(motion));
      return { bill: matching.length ? { bill_id: billId } : null, truncated: false, roll_calls: matching.map((b) => ({ ...b, motion: wrapped(b.motion) })) };
    },
  };
  const judge: Judge = { model: "offline-independent-family-adapter", async assess(input) { modelInputs.push(structuredClone(input)); return { verdict: "supported", reason: "Offline verdict stub; not live acceptance." }; } };
  function planFor(value: string): VerificationPlan {
    const numbers = numberTokens(value).map((token, i): NumericAssertion => ({ start: token.start, end: token.end,
      operation: bases.length ? i === 0 ? "vote_aye" : "vote_total" : "sum_amount", edge_ids: rows.map((r) => r.id),
      ...(bases.length ? { roll_call: { bill_id: bases[0].bill_id, vote_date: bases[0].vote_date, location: bases[0].location, motion: bases[0].motion } } : {}),
    }));
    const name = "from_entity" in original ? (mutated && fixture.kind === "name" ? fixture.replacement_name! : original.from_entity!.name) : null;
    return { numbers, names: name ? [{ start: 0, end: name.length, edge_id: rows[0].id, field: "from_name" }] : [] };
  }
  const claim: Claim = { claim_id: randomUUID(), text, edge_ids: rows.map((r) => r.id), filing_ids: [...new Set(rows.flatMap((r) => typeof r.record.filing_uuid === "string" ? [r.record.filing_uuid] : []))], verdict: null, confidence: null, verifier_model: null };
  const sentence = { text, claim_id: claim.claim_id };
  const session: Session = { investigation_id: randomUUID(), response_id: `resp_${randomUUID()}`, session_id: `offline_session_${randomUUID()}`, harness_id: `offline_${randomUUID()}` };
  const result: PendingInvestigation = { investigation_id: session.investigation_id, question: original.sentence, type: bases.length ? "bill" : "footprint", status: "completed", answer: { summary: text, sections: [{ heading: "Findings", sentences: [sentence] }], card: { title: "Findings", claim_ids: [claim.claim_id] } }, claims: [claim], verification_status: "pending", cost_usd: null, tokens: null };
  return { rows, entities, bases, tools, judge, queries, modelInputs, claim, sentence, session, result, plan: planFor(text), planFor };
}
