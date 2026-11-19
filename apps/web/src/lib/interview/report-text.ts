/** Turns investigation output into reader-facing text: no raw ids or internal codes. Pure. */

const RAW_ID_PAREN = /\s*\((?:calaccess|[a-z_]+:[\w.-]+)[^)]*\)/gu;
const RAW_ID = /\s*\bcalaccess:[\w:.-]+/gu;
const CODES: [RegExp, string][] = [
  [/\bie_support\b/gu, "independent expenditure supporting"],
  [/\bie_oppose\b/gu, "independent expenditure opposing"],
];

/** Removes raw ids such as `(calaccess:filer:1484470)` and spells out spending codes. */
export function readable(text: string): string {
  let out = text.replace(RAW_ID_PAREN, "").replace(RAW_ID, "");
  for (const [re, label] of CODES) out = out.replace(re, label);
  return out.replace(/\s+([.,;:!?])/gu, "$1").replace(/\s{2,}/gu, " ").trim();
}

const SOURCES: Record<string, string> = { calaccess: "CAL-ACCESS" };

/** "calaccess 3146612 F460" becomes "CAL-ACCESS filing 3146612 (Form 460)". Other titles pass through. */
export function sourceLabel(title: string): string {
  const m = /^([a-z_]+)\s+(\S+)(?:\s+(\S+))?$/u.exec(title.trim());
  if (!m) return readable(title);
  const [, source, id, form] = m;
  const name = SOURCES[source] ?? source;
  const formLabel = form ? form.replace(/^F(\d+\w*)$/u, "Form $1") : "";
  return `${name} filing ${id}${formLabel ? ` (${formLabel})` : ""}`;
}

/** True when two passages say the same thing, ignoring case, spacing and trailing punctuation. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/gu, " ").replace(/[\s.!?]+$/u, "").trim();
  return norm(a) === norm(b);
}
