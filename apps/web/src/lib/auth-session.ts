import "server-only";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { identityFromSession } from "./auth-policy";

/** Verified email identity for server actions/admin access. Shared team cookies never qualify. */
export async function currentVerifiedIdentity() {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
    return identityFromSession(session);
  } catch { return null; }
}
