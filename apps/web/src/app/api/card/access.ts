import { cookies } from "next/headers";
import { connection } from "next/server";
import { authConfig, teamSignInSkipped, SESSION_COOKIE, verifySessionToken } from "@/app/sign-in/session";

/** Independent of PUBLIC_SITE and asset suffix bypasses in proxy.ts. */
export async function hasCardTeamSession() {
  await connection();
  if (teamSignInSkipped()) return true;
  const config = authConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return !!(config && token && await verifySessionToken(token, config, Date.now()));
}
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Vary": "Cookie" };
