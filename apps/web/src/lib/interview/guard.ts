/** The interview prototype exists only while INTERVIEW_PREVIEW is on. */
import { notFound } from "next/navigation";
import { readFlags } from "@/lib/flags";
import { InterviewError } from "./store";

export function requirePreview(): void {
  if (!readFlags().INTERVIEW_PREVIEW) notFound();
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** For API routes: flag on, same-origin POST. */
export function checkApi(request: Request): void {
  if (!readFlags().INTERVIEW_PREVIEW) throw new InterviewError("not_found", "Not found.", 404);
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) throw new InterviewError("invalid_origin", "Open the interview from this site.", 403);
  }
}

const CALM: Record<string, string> = {
  openai_not_configured: "The interviewer isn't available right now. Try again in a minute.",
  openai_error: "The interviewer isn't available right now. Try again in a minute.",
  stripe_not_configured: "Payments aren't available right now.",
  stripe_live_key: "Payments aren't available right now.",
  stripe_error: "Payments aren't available right now.",
  not_configured: "Interviews aren't available right now. Try again later.",
  unavailable: "Interviews aren't available right now. Try again later.",
};

/**
 * What a browser may see for an error. Setup and provider errors become calm copy; the real error and its
 * code are logged on the server only.
 */
export function publicError(error: unknown, where = "interview"): InterviewError {
  if (error instanceof InterviewError && !(error.code in CALM)) return error;
  console.error(where, error instanceof InterviewError ? `[${error.code}] ${error.message}` : error);
  const code = error instanceof InterviewError ? error.code : "unavailable";
  const status = error instanceof InterviewError ? error.status : 503;
  return new InterviewError(code, CALM[code] ?? CALM.unavailable, status);
}

export function apiError(error: unknown): Response {
  const e = publicError(error, "interview api");
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { "cache-control": "no-store" } });
}
