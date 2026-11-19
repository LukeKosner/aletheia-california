import { readFlags } from "./flags";

type Env = Record<string, string | undefined>;
export const CAMPUSES = ["stanford", "berkeley", "neither"] as const;
export type Campus = (typeof CAMPUSES)[number];
export function campusChoice(value: unknown): Campus | null {
  return typeof value === "string" && (CAMPUSES as readonly string[]).includes(value) ? value as Campus : null;
}
export function campusLabels(mode: "names" | "nicknames") {
  return mode === "nicknames"
    ? { stanford: "Cardinal", berkeley: "Bears", neither: "Neither" }
    : { stanford: "Stanford", berkeley: "Berkeley", neither: "Neither" };
}
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function isTeamEmail(value: unknown, env: Env = process.env): boolean {
  const email = normalizeEmail(value);
  return !!email && (env.AUTH_TEAM_EMAILS ?? "").split(",").some((allowed) => normalizeEmail(allowed) === email);
}
export function emailAllowed(value: unknown, env: Env = process.env): boolean {
  return !!normalizeEmail(value) && (readFlags(env).PUBLIC_SIGNUP || isTeamEmail(value, env));
}
/** Reject owner/ingest credentials; creating a client does not connect. */
export function roleUrl(value: string | undefined, role: string): string | null {
  try {
    const url = new URL(value ?? "");
    return ["postgres:", "postgresql:"].includes(url.protocol) && decodeURIComponent(url.username) === role ? url.href : null;
  } catch { return null; }
}
export function emailAuthConfig(env: Env = process.env) {
  if (env.AUTH_EMAIL_ENABLED !== "true" || env.AUTH_SENDER_VERIFIED !== "true") return null;
  if (!readFlags(env).PUBLIC_SIGNUP && !(env.AUTH_TEAM_EMAILS ?? "").split(",").some((email) => normalizeEmail(email))) return null;
  const databaseURL = roleUrl(env.AUTH_DATABASE_URL, "auth_server");
  const secret = env.BETTER_AUTH_SECRET ?? "";
  const from = normalizeEmail(env.AUTH_EMAIL_FROM);
  if (!databaseURL || secret.length < 32 || !from || !env.RESEND_API_KEY) return null;
  try {
    const url = new URL(env.BETTER_AUTH_URL ?? "");
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) return null;
    return { databaseURL, secret, from, apiKey: env.RESEND_API_KEY, baseURL: url.origin };
  } catch { return null; }
}
export type VerifiedIdentity = { userId: string; email: string; emailVerified: true };
/** Pure validation after Better Auth verifies the server session. No team-cookie input. */
export function identityFromSession(session: unknown, env: Env = process.env, now = Date.now()): VerifiedIdentity | null {
  if (!session || typeof session !== "object" || !("user" in session) || !("session" in session)) return null;
  const user = session.user as Record<string, unknown> | null;
  const details = session.session as Record<string, unknown> | null;
  const email = normalizeEmail(user?.email);
  const expires = details?.expiresAt instanceof Date ? details.expiresAt.getTime() : Date.parse(String(details?.expiresAt));
  if (!user || !details || details.userId !== user.id || user.emailVerified !== true || typeof user.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) || !email || !emailAllowed(email, env) || !Number.isFinite(expires) || expires <= now) return null;
  return { userId: user.id, email, emailVerified: true };
}
