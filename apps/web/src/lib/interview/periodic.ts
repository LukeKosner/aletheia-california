/** Pure helpers for choosing periodic research. */
import { ISSUES } from "./taxonomy";

export function periodicQuestion(issue: string): string {
  return `Which organizations reported the most campaign contributions and lobbying on ${issue.toLowerCase()} in California, according to public filings?`;
}

/** Top issues from the last week of interviews, skipping any researched in the last day. */
export function topIssues(sessions: { issues: string[]; completedAt: Date | null }[], now = Date.now()): string[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (!s.completedAt || now - s.completedAt.getTime() > 7 * 86_400_000) continue;
    for (const issue of s.issues) if ((ISSUES as readonly string[]).includes(issue) && issue !== "Other") counts.set(issue, (counts.get(issue) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([issue]) => issue);
}
