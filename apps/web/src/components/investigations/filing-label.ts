/**
 * Plain-English labels for public filings. Form names follow the California FPPC / CAL-ACCESS form list
 * (https://www.fppc.ca.gov/forms.html); unknown forms fall back to their form number.
 */
const FORMS: Record<string, string> = {
  F410: "Committee registration",
  F450: "Campaign finance report",
  F460: "Campaign finance report",
  F461: "Major donor report",
  F465: "Independent expenditure report",
  F470: "Candidate short report",
  F496: "Independent expenditure report",
  F497: "Contribution report",
  F615: "Lobbyist report",
  F625: "Lobbying firm report",
  F635: "Lobbying employer report",
  F645: "Lobbying payments report",
};

export function formLabel(form?: string | null): string {
  const key = form?.trim().toUpperCase().replace(/^FORM\s*/u, "F") ?? "";
  return FORMS[key] ?? (key ? `Form ${key.replace(/^F/u, "")}` : "Public filing");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Reads the calendar date from "2026-10-31", "2026-10-31 02:44:14+00" or an ISO timestamp, without time zone shifts. */
function parts(value?: string | null): { y: number; m: number; d: number } | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
}

export function shortDate(value?: string | null): string | null {
  const p = parts(value);
  return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : null;
}

/** "Jul–Sep 2026", "Oct 2026" or "Dec 2025–Feb 2026". */
export function period(start?: string | null, end?: string | null): string | null {
  const a = parts(start), b = parts(end);
  if (!a || !b) return null;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m]}–${MONTHS[b.m]} ${a.y}`;
  return `${MONTHS[a.m]} ${a.y}–${MONTHS[b.m]} ${b.y}`;
}

/** Title-cases ALL-CAPS registry names ("CALIFORNIA REAL ESTATE PAC" → "California Real Estate PAC"), keeping short acronyms. */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const acronyms = ["pac", "llc", "inc", "ie", "ca", "usa", "lp", "llp", "us"], small = ["of", "and", "the", "for", "to", "in", "on", "a", "an", "at", "by"];
  return name
    // A short parenthetical like "(CREPAC)" is an acronym; keep it whole.
    .split(/(\([A-Z0-9&.\- ]{2,10}\))/u)
    .map((part) => /^\([A-Z0-9&.\- ]{2,10}\)$/u.test(part) ? part : part.toLowerCase().replace(/\b([a-z])([a-z']*)/gu, (word, first: string, rest: string, offset: number) =>
      // Two-letter words that are not small words are initials ("KP Public Affairs", "LA County").
      acronyms.includes(word) || (word.length === 2 && !small.includes(word)) ? word.toUpperCase() : small.includes(word) && offset > 0 ? word : first.toUpperCase() + rest))
    .join("");
}

type Item = { from_entity_id: string; to_entity_id: string; from_name?: { untrusted_text: string } | null; to_name?: { untrusted_text: string } | null };
type Info = { source: string | null; form: string | null; filed_at: string | null; period_start: string | null; period_end: string | null };

/** Independent expenditure and major donor reports are filed by the spender, the giver on every line. */
const SPENDER_FILED = new Set(["F461", "F465", "F496"]);

/** The filer is the one party on every line of its own filing (giver on Schedule E, receiver on Schedule A). */
export function filerOf(items: Item[], form?: string | null): string | undefined {
  if (items.length && SPENDER_FILED.has(form?.trim().toUpperCase() ?? "") && items.every((item) => item.from_entity_id === items[0].from_entity_id)) {
    const name = items[0].from_name?.untrusted_text;
    return name ? displayName(name) : undefined;
  }
  if (!items.length) return undefined;
  const names = new Map<string, string>();
  let common = new Set([items[0].from_entity_id, items[0].to_entity_id]);
  for (const item of items) {
    const ids = new Set([item.from_entity_id, item.to_entity_id]);
    if (item.from_name?.untrusted_text) names.set(item.from_entity_id, item.from_name.untrusted_text);
    if (item.to_name?.untrusted_text) names.set(item.to_entity_id, item.to_name.untrusted_text);
    common = new Set([...common].filter((id) => ids.has(id)));
  }
  const id = common.size === 1 ? [...common][0] : undefined;
  return id && names.has(id) ? displayName(names.get(id)!) : undefined;
}

type LobbyParty = { employer_name: { untrusted_text: string } | null; firm_name: { untrusted_text: string } | null };

/** A lobbying firm report names one firm across many employers; an employer report names one employer across firms. */
export function lobbyFilerOf(parties: LobbyParty[] = []): string | undefined {
  const one = (names: (string | undefined)[]) => { const set = new Set(names.filter(Boolean)); return set.size === 1 ? [...set][0] : undefined; };
  const firm = one(parties.map((p) => p.firm_name?.untrusted_text)), employer = one(parties.map((p) => p.employer_name?.untrusted_text));
  const name = firm ?? employer;
  return name ? displayName(name) : undefined;
}

/** Plain-English description of one filing, shared by the server response and client evidence loading. */
export function describeFiling(info: Info, items: Item[], lobby?: LobbyParty[]) {
  return { kind: formLabel(info.form), filer: filerOf(items, info.form) ?? lobbyFilerOf(lobby), period: period(info.period_start, info.period_end), filed: shortDate(info.filed_at), filedAt: info.filed_at?.slice(0, 10) ?? null, periodStart: info.period_start?.slice(0, 10) ?? null, host: hostLabel(info.source) };
}

export function hostLabel(source?: string | null): string {
  // Non-breaking hyphen keeps "CAL‑ACCESS" on one line.
  return source?.toLowerCase() === "calaccess" ? "CAL‑ACCESS" : source?.toUpperCase() === "FEC" ? "FEC" : source ?? "Public record";
}
