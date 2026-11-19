import { authConfig, teamSignInSkipped, SESSION_COOKIE, verifySessionToken } from "../../sign-in/session";
import { readFlags } from "../../../lib/flags";
import { InvestigationError } from "./validation";
/** Defense in depth: private even when the page-level PUBLIC_SITE gate is changed. */
export async function authorize(request: Request): Promise<void> {
  if (readFlags().PUBLIC_SITE) throw new InvestigationError("private_only", "Investigations are available only in the private preview.", 403);
  const config = authConfig();
  const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!teamSignInSkipped() && (!config || !cookie || !await verifySessionToken(cookie, config, Date.now()))) throw new InvestigationError("unauthorized", "Team sign-in required.", 401);
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) throw new InvestigationError("invalid_origin", "Open this investigation from the private site.", 403);
  }
}
