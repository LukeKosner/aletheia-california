import { isOwner } from "@/lib/interview/access";
import { apiError, checkApi, UUID } from "@/lib/interview/guard";
import { connect } from "@/lib/interview/realtime";
import { getSession, getStudy, InterviewError, markStarted } from "@/lib/interview/store";

/** Takes the browser's WebRTC SDP offer and returns OpenAI's answer. The API key stays on the server. */
export async function POST(request: Request, { params }: RouteContext<"/api/interview/sessions/[id]/connect">) {
  try {
    checkApi(request);
    const { id } = await params;
    const session = UUID.test(id) ? await getSession(id) : null;
    if (!session) throw new InterviewError("not_found", "Interview not found.", 404);
    if (session.status === "completed") throw new InterviewError("completed", "This interview is already complete.", 409);
    if (!(await isOwner(session.id))) throw new InterviewError("not_owner", "This interview was started in another browser.", 403);
    const offer = await request.text();
    if (!offer.startsWith("v=0") || offer.length > 20_000) throw new InterviewError("invalid_offer", "Invalid connection offer.");
    const study = session.studyId ? await getStudy(session.studyId) : null;
    const answer = await connect(session, offer, study);
    await markStarted(id);
    return Response.json(answer, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
