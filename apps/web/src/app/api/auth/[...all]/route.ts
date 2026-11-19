import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

const paths = new Set(["/api/auth/sign-in/magic-link", "/api/auth/magic-link/verify", "/api/auth/get-session", "/api/auth/sign-out", "/api/auth/ok"]);
async function handle(request: Request) {
  if (!paths.has(new URL(request.url).pathname)) return Response.json({ error: "Authentication endpoint unavailable." }, { status: 404 });
  const auth = getAuth();
  if (!auth) return Response.json({ error: "Email sign-in is not configured. Use the private team sign-in." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const handlers = toNextJsHandler(auth);
  return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
}
export const GET = handle;
export const POST = handle;
