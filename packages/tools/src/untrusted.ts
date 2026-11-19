/**
 * Free text copied from filings (donor and committee names, motions, bill titles, entity attrs) is data written by
 * third parties. It can contain anything, including text addressed to a model. Tools return it wrapped as
 * `{"untrusted_text": "..."}` so an agent can tell data from instructions.
 */
export interface UntrustedText {
  untrusted_text: string;
}

export function untrusted(value: unknown): UntrustedText | null {
  if (value === null || value === undefined) return null;
  return { untrusted_text: typeof value === "string" ? value : JSON.stringify(value) };
}

/**
 * Columns of the agent views that hold codes, ids or URLs the loaders build themselves, not free text. Every other
 * text or JSON value a `query` returns is wrapped, including any computed or aliased expression.
 */
export const STRUCTURED_COLUMNS: Record<string, readonly string[]> = {
  v_money: ["schedule", "line_item", "from_key", "to_key", "filing_source", "filing_id", "form", "filing_url"],
  v_lobby: ["employer_key", "firm_key", "bills", "filing_source", "filing_id", "form", "filing_url"],
  v_votes: ["session", "measure", "legislator_key", "location"],
  v_bill_authors: ["session", "measure", "legislator_key", "role"],
  v_entities: ["canonical_key"],
  v_interests: ["official_key", "business_key", "filing_source", "filing_id", "form", "filing_url"],
};

/** Postgres type oids whose values are text: text, varchar, bpchar, name, unknown, json, jsonb and their arrays. */
export const TEXT_TYPE_OIDS = new Set([25, 1043, 1042, 19, 705, 114, 3802, 1009, 1015, 1014, 199, 3807]);

export function wrapValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => untrusted(v));
  return untrusted(value);
}

/** Rule 10 of AGENTS.md: claims describe facts, never motive. */
export const BANNED_PHRASES = [
  "bought",
  "paid off",
  "corrupt",
  "in the pocket of",
  "bribe",
  "kickback",
  "rigged",
  "puppet",
] as const;

export function bannedPhrase(sentence: string): string | undefined {
  const s = sentence.toLowerCase();
  return BANNED_PHRASES.find((p) => new RegExp(`\\b${p.replace(/ /g, "\\s+")}`).test(s));
}
