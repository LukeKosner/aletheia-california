import { hasCardTeamSession, PRIVATE_HEADERS } from "@/app/api/card/access";
import { PREVIEW_CODE, PREVIEW_ID } from "@/app/api/card/model";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await hasCardTeamSession()) return Response.json({ error: "Team sign-in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const { code } = await params;
  if (!/^[a-zA-Z0-9]{6}$/.test(code) || code !== PREVIEW_CODE) return Response.json({ error: "Card not found." }, { status: 404, headers: PRIVATE_HEADERS });
  return new Response(null, { status: 307, headers: { ...PRIVATE_HEADERS, Location: new URL(`/r/${PREVIEW_ID}`, request.url).href } });
}
