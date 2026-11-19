import { after } from "next/server";
import { isOwner } from "@/lib/interview/access";
import { apiError, checkApi, UUID } from "@/lib/interview/guard";
import { parseCompletion } from "@/lib/interview/parse";
import { summarize } from "@/lib/interview/realtime";
import { queueVoterResearch, runResearch } from "@/lib/interview/research";
import { completeSession, getSession, getStudy, InterviewError, recordPayout } from "@/lib/interview/store";
import { REWARD_CENTS } from "@/lib/interview/taxonomy";

const LIMIT = 256_000;

/** Research runs in the background after the response; give it time to finish. */
const MIN_VOTER_TURNS = 4;

export const maxDuration = 300;

/**
 * Saves the transcript and the structured result. The result comes from the voice model's own
 * submit_interview call, or, with `summarize: true` (the Finish button), from a server-side summary.
 * A general interview then starts free research on the voter's questions at once, all in parallel.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/interview/sessions/[id]/complete">) {
  try {
    checkApi(request);
    const { id } = await params;
    if (!UUID.test(id)) throw new InterviewError("not_found", "Interview not found.", 404);
    const raw = await request.text();
    if (raw.length > LIMIT) throw new InterviewError("too_large", "The interview is too long to save.", 413);
    let json: Record<string, unknown>;
    try { json = JSON.parse(raw) as Record<string, unknown>; } catch { throw new InterviewError("invalid_data", "The request must be JSON."); }
    const session = await getSession(id);
    if (!session) throw new InterviewError("not_found", "Interview not found.", 404);
    if (!(await isOwner(session.id))) throw new InterviewError("not_owner", "This interview was started in another browser.", 403);
    if (session.status === "completed") throw new InterviewError("completed", "This interview was already saved.", 409);
    if (json.summarize === true) {
      const transcript = parseCompletion({ transcript: json.transcript }).transcript;
      json = { transcript, result: await summarize(transcript, session.studyId ? await getStudy(session.studyId) : null) };
    }
    const result = parseCompletion(json);
    // Research on a voter's own questions is free and automatic for general interviews; studies don't run it.
    const saved = await completeSession(id, { ...result, wantsResearch: !session.studyId });
    if (!saved) throw new InterviewError("completed", "This interview was already saved.", 409);
    // The $5 interview reward is recorded as owed (the team page pays it out), but only for a real conversation:
    // starting and finishing at once earns nothing.
    const voterTurns = result.transcript.filter((line) => line.role === "voter" && line.text.trim().split(/\s+/u).length >= 3).length;
    if (voterTurns >= MIN_VOTER_TURNS) await recordPayout({ stripeId: `reward_${id}`, amountCents: REWARD_CENTS, status: "owed", note: "Interview reward" });
    if (!session.studyId) {
      // Rows are created before responding, so the results page shows "Looking this up…" immediately.
      const jobs = await queueVoterResearch({ id, questions: result.questions, issues: result.issues }).catch((error: unknown) => {
        console.error("interview research queue", error);
        return [];
      });
      if (jobs.length) after(() => Promise.all(jobs.map(([researchId, question]) => runResearch(researchId, question))));
    }
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
