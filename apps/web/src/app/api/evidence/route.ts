/** Read-only filing hydration for product pages. Team-session gate is in proxy.ts.
 * No database client or mutation is exposed to the browser. */
import { cachedFiling } from "../investigations/cached";

const FILING_ID = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
export async function GET(request: Request) {
  const ids = [...new Set(new URL(request.url).searchParams.getAll("filing_id"))];
  if (!ids.length || ids.length > 20 || ids.some((id) => !FILING_ID.test(id))) return Response.json({ error: "Provide up to 20 valid filing identifiers." }, { status: 400 });
  try {
    const results = await Promise.all(ids.map(async (id) => ({ id, result: await cachedFiling(id) })));
    return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Filing evidence is unavailable. No verification has been inferred." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
