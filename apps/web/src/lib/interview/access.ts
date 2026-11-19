/**
 * Interview-owner cookie: the session ids this browser started, each as `<id>.<HMAC>`, joined by "~".
 * Lets the interviewee see their own room and reward, while everyone else sees a third-person view.
 * Without a 32+ character secret (local dev), ids are stored unsigned.
 */
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const OWNER_COOKIE = "aletheia_interview_owner";
const MAX_IDS = 20;
const MAX_AGE = 90 * 86_400;

function secret(): string | null {
  const value = process.env.INTERVIEW_COOKIE_SECRET || process.env.TEAM_SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

async function hmac(value: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`interview-owner:${value}`)));
  return Buffer.from(sig).toString("base64url");
}

async function sign(id: string): Promise<string> {
  const key = secret();
  return key ? `${id}.${await hmac(id, key)}` : id;
}

/** Session ids in the cookie whose signature checks out. */
export async function ownedIds(raw: string | undefined): Promise<string[]> {
  if (!raw) return [];
  const key = secret();
  const ids: string[] = [];
  for (const entry of raw.split("~").slice(-MAX_IDS)) {
    const [id, sig] = entry.split(".");
    if (!id) continue;
    if (!key) { ids.push(id); continue; }
    if (!sig) continue;
    const expected = await hmac(id, key);
    if (expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) ids.push(id);
  }
  return ids;
}

/** Records that this browser started the interview. Call from a server action or route handler. */
export async function rememberOwner(id: string): Promise<void> {
  const jar = await cookies();
  const kept = (jar.get(OWNER_COOKIE)?.value ?? "").split("~").filter((e) => e && e.split(".")[0] !== id);
  const value = [...kept, await sign(id)].slice(-MAX_IDS).join("~");
  jar.set(OWNER_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
}

/** True when this browser started the interview. */
export async function isOwner(id: string): Promise<boolean> {
  return (await ownedIds((await cookies()).get(OWNER_COOKIE)?.value)).includes(id);
}
