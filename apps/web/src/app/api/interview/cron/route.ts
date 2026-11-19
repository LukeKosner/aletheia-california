import { after } from "next/server";
import { apiError, checkApi } from "@/lib/interview/guard";
import { queuePeriodicResearch, runResearch } from "@/lib/interview/research";
import { completedSessions, InterviewError } from "@/lib/interview/store";

export const maxDuration = 300;

/** Periodic research across all interviews (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export async function GET(request: Request) {
  try {
    checkApi(request);
    const secret = process.env.CRON_SECRET;
    const ok = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.NODE_ENV === "development";
    if (!ok) throw new InterviewError("unauthorized", "Cron secret required.", 401);
    const jobs = await queuePeriodicResearch(await completedSessions(2000, { publicOnly: true }));
    after(() => Promise.all(jobs.map(([id, q]) => runResearch(id, q))));
    return Response.json({ queued: jobs.map(([id, question]) => ({ id, question })) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
