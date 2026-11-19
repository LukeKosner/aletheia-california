/** Minimal Stripe REST client for the interview prototype. Test mode only: a live key is refused. */
import { InterviewError } from "./store";

type Params = Record<string, string | number | boolean | undefined>;
type Json = Record<string, unknown>;

export function testKey(env = process.env): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new InterviewError("stripe_not_configured", "Stripe test key is not set (STRIPE_SECRET_KEY).", 503);
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new InterviewError("stripe_live_key", "The interview prototype runs on Stripe test keys only.", 503);
  }
  return key;
}

export function form(params: Params): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  return body.toString();
}

export async function stripe(path: string, init: { method?: "GET" | "POST"; params?: Params; idempotencyKey?: string } = {}): Promise<Json> {
  const method = init.method ?? (init.params ? "POST" : "GET");
  const headers: Record<string, string> = { authorization: `Bearer ${testKey()}`, "Stripe-Version": "2024-06-20" };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers, body: method === "POST" ? form(init.params ?? {}) : undefined, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) {
    const message = typeof (json.error as Json | undefined)?.message === "string" ? String((json.error as Json).message) : "Stripe request failed.";
    throw new InterviewError("stripe_error", `Stripe (test mode): ${message}`, 502);
  }
  return json;
}
