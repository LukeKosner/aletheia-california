/**
 * Team sign-in for the private preview (PUBLIC_SITE off).
 *
 * One shared team password (TEAM_PASSWORD). A correct password gets an
 * httpOnly cookie holding `v1.<expiry>.<HMAC-SHA256 signature>`, signed with
 * TEAM_SESSION_SECRET and the password, so changing either signs everyone out.
 * Web Crypto only; no dependencies. Shared by src/proxy.ts and the sign-in
 * server actions.
 */

import { readFlags } from "../../lib/flags";

export const SESSION_COOKIE = "aletheia_team";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const MIN_SECRET_LENGTH = 32;

export type AuthConfig = { password: string; secret: string };
type Env = Record<string, string | undefined>;

/** Null when sign-in is not set up: the gate then stays closed for everyone. */
export function authConfig(env: Env = process.env): AuthConfig | null {
  const password = env.TEAM_PASSWORD ?? "";
  const secret = env.TEAM_SESSION_SECRET ?? "";
  if (!password || secret.length < MIN_SECRET_LENGTH) return null;
  return { password, secret };
}

const encoder = new TextEncoder();

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function signingKey(config: AuthConfig): string {
  return `${config.secret}\u0000${config.password}`;
}

/** Compares HMACs of both strings, so timing does not reveal the password. */
export async function checkPassword(input: string, config: AuthConfig): Promise<boolean> {
  const [a, b] = await Promise.all([
    hmac(config.secret, input),
    hmac(config.secret, config.password),
  ]);
  return constantTimeEqual(toBase64Url(a), toBase64Url(b));
}

export async function createSessionToken(config: AuthConfig, nowMs: number): Promise<string> {
  const expires = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${expires}`;
  return `${payload}.${toBase64Url(await hmac(signingKey(config), payload))}`;
}

export async function verifySessionToken(
  token: string,
  config: AuthConfig,
  nowMs: number,
): Promise<boolean> {
  const match = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const expected = toBase64Url(await hmac(signingKey(config), `v1.${match[1]}`));
  if (!constantTimeEqual(match[2], expected)) return false;
  return expires * 1000 > nowMs;
}

/** Only same-site relative paths, so `?next=` cannot redirect off the site. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u0020\u007f]/u.test(raw)) return "/";
  if (raw === "/sign-in" || raw.startsWith("/sign-in?") || raw.startsWith("/sign-in/")) return "/";
  return raw;
}

const ASSET = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf)$/i;

/** Paths reachable without a team session. */
export function isOpenPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    // /api/mcp checks its own bearer token.
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/robots.txt" ||
    ASSET.test(pathname)
  );
}

/**
 * Local dev only (`next dev` sets NODE_ENV=development): skip team sign-in so
 * the app opens straight away. Production builds and tests keep the gate.
 */
export function localDevSignInSkipped(env: Env = process.env): boolean {
  return env.NODE_ENV === "development";
}

/**
 * Team sign-in is skipped in local dev and on the open test site (OPEN_TESTING).
 * This only opens pages and team-only APIs. Staff checks (payouts, top-ups,
 * research runs) still use localDevSignInSkipped plus a verified admin.
 */
export function teamSignInSkipped(env: Env = process.env): boolean {
  return localDevSignInSkipped(env) || readFlags(env).OPEN_TESTING;
}
