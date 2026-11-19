import type { Claim, EvidenceRow, ReadTools } from "./types";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "untrusted_text" in value) {
    const text = (value as { untrusted_text: unknown }).untrusted_text;
    if (typeof text !== "string") throw new Error("invalid tool envelope");
    return text;
  }
  return value;
}
export function scalar(value: unknown): string {
  const v = unwrap(value);
  if (typeof v !== "string" && typeof v !== "number") throw new Error("missing scalar");
  return String(v);
}
export function record(value: unknown): Record<string, unknown> {
  const v = unwrap(value), parsed: unknown = typeof v === "string" ? JSON.parse(v) : v;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("missing record");
  return parsed as Record<string, unknown>;
}
export function ids(values: string[]): string {
  if (!values.length || values.length > 100 || values.some((v) => !UUID.test(v)) || new Set(values).size !== values.length) throw new Error("invalid evidence ids");
  return values.map((v) => `'${v.toLowerCase()}'::uuid`).join(",");
}
export function literal(value: string): string { return `'${value.replace(/'/gu, "''")}'`; }
export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(a.map((v) => v.toLowerCase())).size === a.length && a.every((v) => b.some((w) => v.toLowerCase() === w.toLowerCase()));
}
/** Generated SQL only: callers cannot provide table names, expressions, or arbitrary SQL. */
export function evidenceSql(edgeIds: string[]): string {
  const list = ids(edgeIds);
  return [
    `select edge_id::text as id, 'money'::text as kind, jsonb_set(to_jsonb(m), '{amount}', to_jsonb(m.amount::text)) as record from v_money m where edge_id in (${list})`,
    `select activity_id::text, 'lobby'::text, jsonb_set(to_jsonb(l), '{amount}', to_jsonb(l.amount::text)) from v_lobby l where activity_id in (${list})`,
    `select vote_id::text, 'vote'::text, to_jsonb(v) from v_votes v where vote_id in (${list})`,
    `select interest_id::text, 'interest'::text, to_jsonb(i) from v_interests i where interest_id in (${list})`,
  ].join(" union all ");
}
export async function loadEvidence(claim: Claim, tools: ReadTools): Promise<EvidenceRow[]> {
  const result = await tools.query(evidenceSql(claim.edge_ids));
  if (result.truncated || result.rows.length !== claim.edge_ids.length) throw new Error("missing, duplicate, or truncated evidence");
  const rows = result.rows.map((r) => {
    const id = scalar(r.id), kind = scalar(r.kind);
    if (!["money", "lobby", "vote", "interest"].includes(kind)) throw new Error("unknown evidence kind");
    return { id, kind: kind as EvidenceRow["kind"], record: record(r.record) };
  });
  if (!sameIds(rows.map((r) => r.id), claim.edge_ids)) throw new Error("evidence ids changed");
  const filings = [...new Set(rows.map((r) => r.record.filing_uuid).filter((v): v is string => typeof v === "string"))];
  if (!sameIds(claim.filing_ids, filings)) throw new Error("filing ids do not match cited rows");
  // A vote has no filing; its public bill identity comes from v_votes, not an invented filing id.
  if (rows.some((r) => r.kind !== "vote" && (!r.record.filing_uuid || !r.record.filing_url))) throw new Error("filing source is missing");
  return rows;
}
/** Decimal money stays decimal, including amounts beyond JS's safe integer range. */
export function cents(value: string): bigint {
  const clean = value.replace(/[$,]/gu, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/u.test(clean)) throw new Error("unsupported decimal amount");
  const negative = clean.startsWith("-"), [whole, fraction = ""] = clean.replace(/^-/, "").split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -result : result;
}
export function aggregateSql(rows: EvidenceRow[], operation: "sum_amount" | "count"): string {
  const parts = (["money", "lobby", "vote", "interest"] as const).flatMap((kind) => {
    const selected = rows.filter((r) => r.kind === kind);
    if (!selected.length) return [];
    if (operation === "sum_amount" && kind !== "money" && kind !== "lobby") throw new Error("row has no exact amount");
    const table = { money: "v_money", lobby: "v_lobby", vote: "v_votes", interest: "v_interests" }[kind];
    const key = { money: "edge_id", lobby: "activity_id", vote: "vote_id", interest: "interest_id" }[kind];
    return [`select ${operation === "sum_amount" ? "amount" : "1"} as value from ${table} where ${key} in (${ids(selected.map((r) => r.id))})`];
  });
  return `select ${operation === "sum_amount" ? "sum(value)::text" : "count(*)::text"} as value from (${parts.join(" union all ")}) cited_rows`;
}
