/** Counting helpers for interview insights. Pure: no database access. */
import { AGE_RANGES, COUNTIES, ISSUES, NOT_ASKED, PARTIES } from "./taxonomy";

/** How often each value appears across the lists, most common first (ties alphabetical). */
export function tally(lists: string[][]): [string, number][] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Share of `total` as a whole percent; 0 when there is nothing to divide by. */
export function percent(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}


/** The columns interview_insights reads. No emails, transcripts or ids. */
export type InsightRow = { county: string; ageRange: string; party: string; issues: string[]; questions: string[] };
export type InsightFilter = { county?: string; issue?: string; party?: string };

export const INSIGHTS_PATH = "/interview/insights";
const MAX_QUESTIONS = 20, MAX_QUESTION_CHARS = 300, MAX_ISSUES = 10;

/** Matches a filter value to the vocabulary, ignoring case and a trailing " County". Unknown values throw. */
function match(value: string | undefined, allowed: readonly string[], what: string): string | undefined {
  const v = value?.trim().replace(/\s+county$/iu, "");
  if (!v) return undefined;
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (!hit) throw new Error(`Unknown ${what}. Use one of: ${allowed.join(", ")}.`);
  return hit;
}

function counts(values: string[], order?: readonly string[]): { value: string; count: number }[] {
  const rows = tally(values.filter((v) => v && v !== NOT_ASKED).map((v) => [v]));
  if (order) rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return rows.map(([value, count]) => ({ value, count }));
}

/**
 * Aggregates for the interview_insights MCP tool. Callers pass public interviews only (sponsored studies excluded).
 * Questions are grouped case-insensitively and capped; they are voter-written free text.
 */
export function interviewInsights(rows: InsightRow[], filter: InsightFilter = {}) {
  const county = match(filter.county, COUNTIES, "county"), issue = match(filter.issue, ISSUES, "issue"), party = match(filter.party, PARTIES, "party");
  const sessions = rows.filter((s) => (!county || s.county === county) && (!issue || s.issues.includes(issue)) && (!party || s.party === party));
  const total = sessions.length;
  const groups = new Map<string, { question: string; count: number }>();
  for (const q of sessions.flatMap((s) => s.questions)) {
    const question = q.trim().replace(/\s+/gu, " ").slice(0, MAX_QUESTION_CHARS);
    if (!question) continue;
    const key = question.toLowerCase().replace(/[?.!\s]+$/u, "");
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { question, count: 1 });
  }
  return {
    source: "Aletheia's own public voter interviews (not public filings)",
    page: INSIGHTS_PATH,
    filter: { county: county ?? null, issue: issue ?? null, party: party ?? null },
    total_interviews: total,
    top_issues: tally(sessions.map((s) => s.issues)).slice(0, MAX_ISSUES).map(([value, count]) => ({ issue: value, count, percent: percent(count, total) })),
    by_county: counts(sessions.map((s) => s.county)),
    by_age_range: counts(sessions.map((s) => s.ageRange), AGE_RANGES),
    by_party: counts(sessions.map((s) => s.party)),
    common_questions: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_QUESTIONS),
  };
}
