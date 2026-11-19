/**
 * Interview research runs on the existing HarnessRouter investigation pipeline (general harness): same scope
 * check, same MCP-only data access, same cited-claim validation. This module only links runs to interviews.
 */
import { consume, prepare } from "@/app/api/investigations/service";
import { InvestigationError, parseInput } from "@/app/api/investigations/validation";
import { createResearch, recentPeriodicQuestions, updateResearch, type SessionRow } from "./store";
import { periodicQuestion, topIssues } from "./periodic";

const MAX_VOTER_QUESTIONS = 4;
const MAX_PERIODIC = 2;

function message(error: unknown): string {
  return error instanceof InvestigationError || error instanceof Error ? error.message : "Research could not start.";
}

/** Runs one research question end to end. Call inside `after()`; it never throws. */
export async function runResearch(researchId: string, question: string): Promise<void> {
  try {
    const input = parseInput({ type: "general", question });
    const { id, config } = await prepare(input);
    await updateResearch(researchId, { investigationId: id, status: "running" });
    await consume(input, id, config, (event) => {
      if (event.event === "result") void updateResearch(researchId, { status: "completed" });
      if (event.event === "error") void updateResearch(researchId, { status: "failed", error: event.data.message });
    });
  } catch (error) {
    await updateResearch(researchId, { status: "failed", error: message(error) }).catch(() => undefined);
  }
}

/** What to look up for a finished interview: the voter's own questions, or their top issues if they asked none. */
export function voterResearchQuestions(session: Pick<SessionRow, "questions" | "issues">): string[] {
  const questions = session.questions.length
    ? session.questions
    : session.issues.filter((i) => i !== "Other").map((issue) => `Who funds and lobbies on ${issue.toLowerCase()} in California, according to public filings?`);
  return [...new Set(questions)].slice(0, MAX_VOTER_QUESTIONS);
}

/** True for a general interview that finished in the last two minutes and has something to look up. */
export function researchStarting(session: Pick<SessionRow, "questions" | "issues" | "studyId" | "completedAt">, now = Date.now()): boolean {
  return !session.studyId && voterResearchQuestions(session).length > 0 && now - (session.completedAt?.getTime() ?? 0) < 120_000;
}

/**
 * Free research for every finished general interview. Creates the rows (so the results page shows
 * "Looking this up…" at once) and returns [researchId, question] pairs for the caller to run in parallel.
 */
export async function queueVoterResearch(session: Pick<SessionRow, "id" | "questions" | "issues">): Promise<[string, string][]> {
  return Promise.all(voterResearchQuestions(session).map(async (question): Promise<[string, string]> =>
    [await createResearch({ sessionId: session.id, origin: "voter", question }), question]));
}

export async function queuePeriodicResearch(sessions: { issues: string[]; completedAt: Date | null }[]): Promise<[string, string][]> {
  const recent = new Set(await recentPeriodicQuestions(new Date(Date.now() - 86_400_000)));
  const questions = topIssues(sessions).map(periodicQuestion).filter((q) => !recent.has(q)).slice(0, MAX_PERIODIC);
  const jobs: [string, string][] = [];
  for (const question of questions) jobs.push([await createResearch({ sessionId: null, origin: "periodic", question }), question]);
  return jobs;
}
