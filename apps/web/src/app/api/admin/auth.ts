import { authConfig, SESSION_COOKIE, teamSignInSkipped, verifySessionToken } from "@/app/sign-in/session";
import { readFlags } from "@/lib/flags";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import type { VerifiedIdentity } from "@/lib/auth-policy";
export type { VerifiedIdentity } from "@/lib/auth-policy";
type Env = Record<string, string | undefined>;
/** Fresh Better Auth session identity; admin allowlisting remains a separate check.
 * Shared team cookies and client-supplied email headers never establish identity. */
export const currentAdminIdentity = currentVerifiedIdentity;
export function adminEmails(env: Env = process.env): readonly [
    string,
    string
] | null {
    const emails = (env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase());
    if (emails.length !== 2 || emails[0] === emails[1] || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
        return null;
    return [emails[0], emails[1]];
}
export function isAdmin(identity: VerifiedIdentity | null, env: Env = process.env): boolean {
    const allowed = adminEmails(env);
    return Boolean(allowed && identity?.emailVerified === true && identity.userId && allowed.includes(identity.email.trim().toLowerCase()));
}
export async function requireTeam(request: Request, env: Env = process.env): Promise<boolean> {
    if (readFlags(env).PUBLIC_SITE)
        return false;
    if (teamSignInSkipped(env))
        return true;
    const config = authConfig(env);
    const token = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return Boolean(config && token && await verifySessionToken(token, config, Date.now()));
}
export function sameOrigin(request: Request): boolean {
    const origin = request.headers.get("origin");
    return origin !== null && origin === new URL(request.url).origin;
}
export async function adminForRequest(request: Request): Promise<VerifiedIdentity | null> {
    if (!await requireTeam(request))
        return null;
    const identity = await currentAdminIdentity();
    return isAdmin(identity) ? identity : null;
}
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: PRIVATE_HEADERS }); }
export async function body(request: Request): Promise<unknown> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        throw new Error("Send a JSON report.");
    // Stream cap also covers requests without a trustworthy Content-Length.
    const reader = request.body?.getReader();
    if (!reader)
        throw new Error("Complete the report.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 32768) {
                await reader.cancel();
                throw new Error("Report is too long.");
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw new Error("Send a valid JSON report.");
    }
}
