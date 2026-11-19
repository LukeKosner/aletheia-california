import { NextResponse } from "next/server";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import { isTeamEmail } from "@/lib/auth-policy";
import { readFlags } from "@/lib/flags";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, authConfig, createSessionToken, safeNextPath } from "../session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const identity = await currentVerifiedIdentity();
  if (!identity || (!readFlags().PUBLIC_SITE && !isTeamEmail(identity.email))) return NextResponse.redirect(new URL("/sign-in?email_error=1", url));
  const next = safeNextPath(url.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(`/account?next=${encodeURIComponent(next)}`, url));
  // Existing private-preview gate remains viable. This cookie grants preview
  // access only; admin/session identity continues to require Better Auth.
  const config = authConfig();
  if (!readFlags().PUBLIC_SITE && !config) return NextResponse.redirect(new URL("/sign-in?email_error=1", url));
  if (config && isTeamEmail(identity.email)) response.cookies.set(SESSION_COOKIE, await createSessionToken(config, Date.now()), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_SECONDS });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
