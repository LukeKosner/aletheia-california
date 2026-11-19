/** Name search uses only the tools package's read-only views. */
import { runQuery, sharedDb } from "@aletheia/tools";
const kinds = { measure: ["measure"], footprint: ["org", "committee", "lobby_firm"], interests: ["official", "legislator", "candidate"] } as const;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const type = params.get("type") ?? "";
  if (query.length < 2 || query.length > 160 || !Object.hasOwn(kinds, type)) return Response.json({ records: [] });
  const allowed = kinds[type as keyof typeof kinds].map((kind) => `'${kind}'`).join(",");
  // Quote a literal for the fixed SELECT. runQuery enforces one statement, read-only
  // transactions, agent_ro view-only grants, a row cap and a statement timeout.
  const literal = query.replace(/'/g, "''");
  try {
    const result = await runQuery(sharedDb(), `select entity_id, kind, name from v_entities where kind in (${allowed}) and name ilike '%${literal}%' order by name limit 10`);
    return Response.json({ records: result.rows.map((row) => ({ id: row.entity_id, name: typeof row.name === "object" && row.name && "untrusted_text" in row.name ? row.name.untrusted_text : String(row.name ?? ""), kind: row.kind })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Record search is unavailable. Try the recorded example." }, { status: 503 }); }
}
