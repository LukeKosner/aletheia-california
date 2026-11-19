/**
 * Team sign-in gate (Next.js 16 renamed `middleware.ts` to `proxy.ts`).
 *
 * With PUBLIC_SITE off (the default), every page needs a valid team session
 * cookie; see src/app/sign-in/session.ts. Open paths: /sign-in, static assets
 * and /api/mcp, which checks its own bearer token. Pages redirect to
 * /sign-in?next=…; API calls and form posts get a 401.
 */
import { type NextRequest, NextResponse } from "next/server";
import { readFlags } from "@/lib/flags";
import { SESSION_COOKIE, authConfig, isOpenPath, teamSignInSkipped, verifySessionToken } from "@/app/sign-in/session";

export async function proxy(request: NextRequest) {
  if (readFlags().PUBLIC_SITE || teamSignInSkipped()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();
  // OPEN_TESTING (handled above) opens every page, including interviews and Ask, for the hosted test site.
  // Otherwise, deployed, everything needs team sign-in, so nobody outside the team can start paid voice sessions or checkouts.

  const config = authConfig();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (config && token && (await verifySessionToken(token, config, Date.now()))) {
    return NextResponse.next();
  }

  const isPageView = request.method === "GET" || request.method === "HEAD";
  if (!isPageView || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Team sign-in required." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
