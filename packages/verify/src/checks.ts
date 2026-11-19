import { bannedPhrase } from "../../tools/src/untrusted";
import { aggregateSql, cents, ids, record, scalar, UUID } from "./evidence";
import type { Claim, EvidenceRow, Failure, NumericAssertion, ReadTools, RollCall, RollCallKey, VerificationPlan } from "./types";
export function failure(check: Failure["check"], code: string, message: string): Failure { return { check, code, message }; }
export function numberTokens(text: string): { text: string; start: number; end: number }[] {
  return [...text.matchAll(/\$?-?\d{4}-\d{2}-\d{2}|\$?-?\d[\d,]*(?:\.\d+)?%?/gu)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}
function key(value: RollCallKey): string { return JSON.stringify([value.bill_id, value.vote_date, value.location, value.motion]); }
export type Context = { bases: Map<string, RollCall>; entities: Record<string, unknown>[] };
function rowKey(row: EvidenceRow): RollCallKey {
  const r = row.record;
  return { bill_id: scalar(r.bill_id), vote_date: scalar(r.vote_date), location: scalar(r.location), motion: scalar(r.motion) };
}
export async function baseRate(proposed: RollCallKey, rows: EvidenceRow[], tools: ReadTools, context: Context): Promise<RollCall> {
  const bound = rows.find((r) => r.kind === "vote" && key(rowKey(r)) === key(proposed));
  if (!bound) throw new Error("base rate is not this cited roll call");
  const cached = context.bases.get(key(proposed));
  if (cached) return cached;
  const result = await tools.voteBaseRate(proposed.bill_id, proposed.motion);
  if (result.truncated || result.bill?.bill_id !== proposed.bill_id) throw new Error("incomplete all-member base rate");
  const matches = result.roll_calls.filter((r) => r.vote_date === proposed.vote_date && r.location === proposed.location && scalar(r.motion) === proposed.motion);
  if (matches.length !== 1) throw new Error("ambiguous all-member base rate");
  const roll = matches[0], counts = { aye: 0, no: 0, nvr: 0, total: 0 };
  if (!roll.members.length || new Set(roll.members.map((m) => m.legislator_entity_id)).size !== roll.members.length) throw new Error("duplicate or empty all-member base rate");
  for (const m of roll.members) {
    if (!["aye", "no", "nvr"].includes(m.result)) throw new Error("unknown vote");
    counts[m.result as "aye" | "no" | "nvr"]++; counts.total++;
  }
  if (Object.keys(counts).some((k) => counts[k as keyof typeof counts] !== roll.counts[k as keyof typeof counts])) throw new Error("all-member counts differ from rows");
  // Every cited member must occur in the complete roll call with the same result.
  for (const row of rows.filter((r) => r.kind === "vote" && key(rowKey(r)) === key(proposed))) {
    if (!roll.members.some((m) => m.legislator_entity_id === row.record.legislator_entity_id && m.result === scalar(row.record.result))) throw new Error("cited member differs from all-member rows");
  }
  const complete = { ...proposed, members: roll.members, counts };
  context.bases.set(key(proposed), complete);
  return complete;
}
const FIELDS = new Set(["amount", "date", "filed_at", "period_start", "period_end", "year", "line_item", "filing_id", "amendment_no", "vote_date", "measure", "session", "value_range"]);
function selectRows(a: NumericAssertion, rows: EvidenceRow[]): EvidenceRow[] {
  if (!a.edge_ids.length || new Set(a.edge_ids).size !== a.edge_ids.length) throw new Error("missing or duplicate numeric evidence");
  const selected = a.edge_ids.map((id) => rows.find((r) => r.id === id));
  if (selected.some((r) => !r)) throw new Error("number cites a row outside the claim");
  return selected as EvidenceRow[];
}
function validPlan(plan: VerificationPlan | undefined): plan is VerificationPlan {
  if (!plan || !Array.isArray(plan.numbers) || plan.numbers.length > 100 || (plan.names !== undefined && (!Array.isArray(plan.names) || plan.names.length > 100))) return false;
  return plan.numbers.every((a) => a && Number.isInteger(a.start) && Number.isInteger(a.end) && a.start >= 0 && a.end > a.start && typeof a.operation === "string" && Array.isArray(a.edge_ids) && a.edge_ids.every((id) => typeof id === "string")) &&
    (plan.names ?? []).every((a) => a && Number.isInteger(a.start) && Number.isInteger(a.end) && typeof a.edge_id === "string" && typeof a.field === "string");
}
export async function checkNumbers(text: string, plan: VerificationPlan | undefined, rows: EvidenceRow[], tools: ReadTools, context: Context): Promise<Failure[]> {
  const tokens = numberTokens(text);
  if (/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|percent|dozen|half|quarter|twice|double|triple)\b/iu.test(text) || /[^\x00-\x7f]/u.test(text.replace(/[^\p{N}]/gu, ""))) return [failure("numbers", "number_format", "Write numerical assertions as digits with exact decimal amounts so every number can be recomputed.")];
  if (!validPlan(plan)) return [failure("numbers", "plan_missing", "A recomputation plan is required, including for a sentence without numbers.")];
  if (plan.numbers.length !== tokens.length || tokens.some((t) => plan.numbers.filter((a) => a.start === t.start && a.end === t.end).length !== 1)) return [failure("numbers", "number_unbound", "Every visible number must bind once to cited rows and a fixed computation.")];
  try {
    for (const a of plan.numbers) {
      const selected = selectRows(a, rows), token = text.slice(a.start, a.end);
      if (a.operation === "sum_amount" || a.operation === "count") {
        const recomputed = await tools.query(aggregateSql(selected, a.operation));
        if (recomputed.truncated || recomputed.rows.length !== 1) throw new Error("aggregate unavailable");
        const value = scalar(recomputed.rows[0].value);
        if (a.operation === "sum_amount") {
          const exact = selected.reduce((sum, r) => sum + cents(scalar(r.record.amount)), 0n);
          if (cents(value) !== exact || cents(token) !== exact) return [failure("numbers", "number_mismatch", "The amount differs from a fresh sum of cited rows.")];
        } else if (!/^\d[\d,]*$/u.test(token) || BigInt(token.replace(/,/gu, "")) !== BigInt(value) || BigInt(value) !== BigInt(selected.length)) return [failure("numbers", "number_mismatch", "The count differs from the cited rows.")];
      } else if (a.operation === "field") {
        if (selected.length !== 1 || !a.field || !FIELDS.has(a.field)) throw new Error("unsupported numeric field");
        const source = scalar(selected[0].record[a.field]);
        const exact = numberTokens(source).some((t) => t.text.replace(/[$,]/gu, "") === token.replace(/[$,]/gu, ""));
        if (!exact) return [failure("numbers", "number_mismatch", "The number differs from its cited field.")];
      } else if (["vote_aye", "vote_no", "vote_nvr", "vote_total", "vote_percent_aye"].includes(a.operation)) {
        if (!a.roll_call || selected.some((r) => r.kind !== "vote")) throw new Error("vote computation has no bound roll call");
        const b = await baseRate(a.roll_call, selected, tools, context);
        if (a.operation === "vote_percent_aye") {
          if (!/^\d+(?:\.\d{1,2})?%$/u.test(token)) throw new Error("unsupported percentage precision");
          const decimals = token.replace(/%/u, "").split(".")[1]?.length ?? 0;
          if (token !== `${(100 * b.counts.aye / b.counts.total).toFixed(decimals)}%`) return [failure("numbers", "number_mismatch", "The percentage differs from the all-member roll call.")];
        } else {
          const expected = b.counts[a.operation.slice(5) as keyof RollCall["counts"]];
          if (!/^\d+$/u.test(token) || Number(token) !== expected) return [failure("numbers", "number_mismatch", "The vote count differs from the all-member roll call.")];
        }
      } else throw new Error("unknown computation");
    }
    return [];
  } catch { return [failure("numbers", "recompute_unavailable", "A number could not be recomputed safely from complete cited rows.")]; }
}
const NAME_FIELDS = new Set(["from_name", "to_name", "employer_name", "firm_name", "legislator_name", "official_name", "business_name"]);
export async function checkIdentity(claim: Claim, plan: VerificationPlan, rows: EvidenceRow[], tools: ReadTools, context: Context): Promise<Failure[]> {
  try {
    for (const name of plan.names ?? []) {
      const row = rows.find((r) => r.id === name.edge_id);
      if (!row || !NAME_FIELDS.has(name.field) || !Number.isInteger(name.start) || !Number.isInteger(name.end) || name.start < 0 || name.end <= name.start || scalar(row.record[name.field]) !== claim.text.slice(name.start, name.end)) return [failure("identity", "name_mismatch", "The named party differs from the cited row.")];
    }
    // Resolver writes a direct root pointer on every cluster member (including the root).
    // Edges remain on raw members, so load roots once rather than walking arbitrary chains.
    type Entity = { id: string; canonical_key: string; attrs: Record<string, unknown> };
    const entityIds = [...new Set(rows.flatMap((r) => Object.entries(r.record).filter(([k, v]) => k.endsWith("_entity_id") && v != null).map(([, v]) => {
      if (typeof v !== "string" || !UUID.test(v)) throw new Error("invalid entity id");
      return v.toLowerCase();
    })))];
    const entities = new Map<string, Entity>();
    async function hydrate(requested: string[]): Promise<void> {
      for (let start = 0; start < requested.length; start += 100) {
        const batch = requested.slice(start, start + 100);
        const result = await tools.query(`select entity_id::text as id, canonical_key, attrs from v_entities where entity_id in (${ids(batch)})`);
        if (result.truncated || result.rows.length !== batch.length) throw new Error("entity metadata unavailable");
        const seen = new Set<string>();
        for (const row of result.rows) {
          const id = scalar(row.id).toLowerCase(), canonical_key = scalar(row.canonical_key);
          if (!batch.includes(id) || seen.has(id) || !canonical_key) throw new Error("entity metadata changed");
          seen.add(id);
          entities.set(id, { id, canonical_key, attrs: record(row.attrs) });
        }
      }
    }
    function rootPointer(entity: Entity): { id: string; key: string } | undefined {
      const id = entity.attrs.resolved_entity_id, key = entity.attrs.resolved_entity_key;
      if (id === undefined && key === undefined) return undefined;
      if (typeof id !== "string" || !UUID.test(id) || typeof key !== "string" || !key) throw new Error("invalid root metadata");
      return { id: id.toLowerCase(), key };
    }
    await hydrate(entityIds);
    const cited = entityIds.map((id) => entities.get(id)!);
    const pointers = cited.flatMap((e) => rootPointer(e) ?? []);
    await hydrate([...new Set(pointers.map((p) => p.id))].filter((id) => !entities.has(id)));
    const roots = cited.map((entity) => {
      const pointer = rootPointer(entity);
      if (!pointer) return entity;
      const root = entities.get(pointer.id), self = root && rootPointer(root);
      // A valid resolver root points to itself. Missing metadata, chains and cycles fail closed.
      if (!root || root.canonical_key !== pointer.key || !self || self.id !== root.id || self.key !== root.canonical_key) throw new Error("resolved root unavailable");
      return root;
    });
    context.entities = [...entities.values()];
    const linked = roots.some((e) => {
      const links = e.attrs.likely_same_donor;
      if (links === undefined) return false;
      if (!Array.isArray(links)) throw new Error("invalid likely metadata");
      return links.some((link) => {
        const target = record(link).entity_key;
        if (typeof target !== "string" || !target) throw new Error("invalid likely target");
        return roots.some((other) => other.id !== e.id && other.canonical_key === target);
      });
    });
    const likely = linked || claim.confidence === "likely";
    if (likely && !/\blikely the same donor\b/iu.test(claim.text)) return [failure("identity", "likely_wording", "A likely identity match must say likely the same donor.")];
    if (likely && plan.numbers.some((a) => a.operation === "sum_amount")) return [failure("identity", "likely_total", "Amounts across likely identity matches cannot be included in a verified donor total.")];
    return [];
  } catch { return [failure("identity", "identity_unavailable", "Cited entity metadata could not be checked.")]; }
}
export function checkBaseRate(text: string, plan: VerificationPlan, rows: EvidenceRow[]): Failure[] {
  try {
  const money = rows.some((r) => r.kind === "money" || r.kind === "lobby");
  const votes = rows.some((r) => r.kind === "vote");
  const moneyWords = /\b(fund(?:ing|ed|s)?|contribut(?:ed|ion|ions)|donat(?:ed|ion|ions)|donors?|lobb(?:y|ying|ied)|money)\b/iu.test(text);
  const voteWords = /\b(vot(?:e|ed|es|ing)|ayes?|noes?|roll call)\b/iu.test(text);
  if (!((money && votes) || (moneyWords && voteWords))) return [];
  const voteRows = rows.filter((r) => r.kind === "vote");
  if (!voteRows.length || !/\ball(?:[-\s]+\w+){0,3}\s+members\b/iu.test(text)) return [failure("base_rate", "base_rate_missing", "A money and vote comparison must state the all-member base rate.")];
  const calls = [...new Set(voteRows.map((r) => key(rowKey(r))))];
  for (const call of calls) {
    const numbers = plan.numbers.filter((a) => a.roll_call && key(a.roll_call) === call);
    if (!numbers.some((a) => a.operation === "vote_aye") || !numbers.some((a) => a.operation === "vote_total")) return [failure("base_rate", "base_rate_missing", "Each cited roll call needs the verified aye count and all-member denominator in the sentence.")];
  }
  return [];
  } catch { return [failure("base_rate", "base_rate_unavailable", "The exact all-member roll call could not be confirmed.")]; }
}
export function checkLanguage(text: string): Failure[] {
  return bannedPhrase(text.normalize("NFKC")) ? [failure("language", "banned_phrase", "Use neutral descriptions of facts.")] : [];
}
