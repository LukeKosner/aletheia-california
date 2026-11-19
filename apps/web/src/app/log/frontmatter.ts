/**
 * Frontmatter for `buildlog/*.mdx`.
 *
 * Deliberately a small subset of YAML, not a YAML library (rule 6: no new
 * dependency without asking). It handles exactly what the build log uses:
 *
 *   ---
 *   date: 2026-11-15
 *   author: agent:log
 *   reviewer:
 *   task: One sentence, which may itself contain: a colon
 *   metrics:
 *     entity_match_precision: 0.962
 *     entity_match_pairs: 1240
 *   ---
 *
 * Rules: one `key: value` per line, split on the first colon. A key whose value
 * is empty and which is followed by indented `key: value` lines is a nested map
 * (`metrics`); a key whose value is empty and which is not is an empty string
 * (an unfilled `reviewer`). Surrounding single or double quotes are stripped.
 *
 * Also used by `scripts/check-buildlog.ts`, so this module must stay free of
 * React, Next and Node imports.
 */

export type FrontmatterValue = string | Record<string, string>;
export type Frontmatter = Record<string, FrontmatterValue>;

const DELIMITER = "---";

function unquote(value: string): string {
  const v = value.trim();
  const quoted =
    v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")));
  return quoted ? v.slice(1, -1) : v;
}

/** Splits `key: value` on the first colon. Returns null for lines that are not pairs. */
function splitPair(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const key = line.slice(0, colon).trim();
  if (!key || /\s/.test(key)) return null;
  return { key, value: unquote(line.slice(colon + 1)) };
}

const isBlank = (line: string) => line.trim() === "" || line.trim().startsWith("#");
const isIndented = (line: string) => /^[ \t]+\S/.test(line);

export type ParsedDocument = {
  /** Parsed frontmatter. Empty when the file has no frontmatter block. */
  data: Frontmatter;
  /** Everything after the closing delimiter, with leading blank lines removed. */
  body: string;
};

/** Splits an `.mdx` source into frontmatter and body. Never throws. */
export function parseFrontmatter(source: string): ParsedDocument {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const whole = { data: {} as Frontmatter, body: text.replace(/^\n+/, "") };

  if (lines[0]?.trim() !== DELIMITER) return whole;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === DELIMITER);
  if (end === -1) return whole;

  const data: Frontmatter = {};
  const block = lines.slice(1, end);

  for (let i = 0; i < block.length; i++) {
    const line = block[i]!;
    if (isBlank(line) || isIndented(line)) continue;

    const pair = splitPair(line);
    if (!pair) continue;

    if (pair.value !== "") {
      data[pair.key] = pair.value;
      continue;
    }

    // Empty value: a nested map if indented pairs follow, otherwise an empty scalar.
    const nested: Record<string, string> = {};
    let j = i + 1;
    for (; j < block.length; j++) {
      const next = block[j]!;
      if (isBlank(next)) continue;
      if (!isIndented(next)) break;
      const child = splitPair(next.trim());
      if (child) nested[child.key] = child.value;
    }
    data[pair.key] = Object.keys(nested).length > 0 ? nested : "";
    i = j - 1;
  }

  return { data, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

/** Reads a frontmatter key as a string. Nested maps and missing keys read as "". */
export function scalar(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

/** Reads a frontmatter key as a nested map. Scalars and missing keys read as {}. */
export function mapping(data: Frontmatter, key: string): Record<string, string> {
  const value = data[key];
  return typeof value === "object" && value !== null ? value : {};
}

/**
 * Parses a metric value: `0.962`, `96.2%` and `1240` all parse. A trailing `%`
 * divides by 100, so a precision written either way lands on the same 0–1 scale.
 * Anything that is not a plain number returns null.
 */
export function numeric(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  const percent = trimmed.endsWith("%");
  const digits = percent ? trimmed.slice(0, -1).trim() : trimmed;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}
