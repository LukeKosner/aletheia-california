/** /api/mcp handler: bearer auth and the five tools over streamable HTTP. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bearerOk, createMcpFetchHandler, INVESTIGATION_HEADER } from "../src/server";
import { ADMIN_URL, setup, type Harness } from "./harness";

const TOKEN = "test-token-not-a-secret";
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

/** Reads a JSON-RPC response from a JSON or SSE body. */
async function rpc(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

describe("bearer auth", () => {
  test("bearerOk", () => {
    const r = (h?: string) => new Request("http://x", { headers: h ? { authorization: h } : {} });
    expect(bearerOk(r(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(bearerOk(r(`Bearer wrong`), TOKEN)).toBe(false);
    expect(bearerOk(r(), TOKEN)).toBe(false);
    expect(bearerOk(r(`Bearer ${TOKEN}`), undefined)).toBe(false);
  });
  test("401 without the token, 503 when no token is configured", async () => {
    const handler = createMcpFetchHandler({ token: TOKEN, db: {} as never });
    expect((await handler(req({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(401);
    expect((await handler(req({}, { authorization: "Bearer nope" }))).status).toBe(401);
    const unconfigured = createMcpFetchHandler({ token: "", db: {} as never });
    const prev = process.env.MCP_BEARER_TOKEN;
    delete process.env.MCP_BEARER_TOKEN;
    expect((await unconfigured(req({}, { authorization: `Bearer ${TOKEN}` }))).status).toBe(503);
    if (prev !== undefined) process.env.MCP_BEARER_TOKEN = prev;
  });
});

describe("interview_insights", () => {
  const auth = { authorization: `Bearer ${TOKEN}` };
  test("offered only when the app supplies a reader, and passes filters through", async () => {
    const plain = createMcpFetchHandler({ token: TOKEN, db: {} as never });
    const plainList = await rpc(await plain(req({ jsonrpc: "2.0", id: 1, method: "tools/list" }, auth)));
    expect((plainList.result?.tools as { name: string }[]).map((t) => t.name)).not.toContain("interview_insights");

    const seen: unknown[] = [];
    const handler = createMcpFetchHandler({ token: TOKEN, db: {} as never, interviewInsights: async (filter) => (seen.push(filter), { total_interviews: 0 }) });
    const list = await rpc(await handler(req({ jsonrpc: "2.0", id: 2, method: "tools/list" }, auth)));
    const tool = (list.result?.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[]).find((t) => t.name === "interview_insights");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const call = await rpc(await handler(req({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "interview_insights", arguments: { county: "San Diego" } } }, auth)));
    expect(JSON.parse((call.result?.content as { text: string }[])[0].text)).toEqual({ total_interviews: 0 });
    expect(seen).toEqual([{ county: "San Diego" }]);
  });
});

describe.skipIf(!ADMIN_URL)("MCP over HTTP", () => {
  let h: Harness;
  let handler: (r: Request) => Promise<Response>;
  beforeAll(async () => {
    h = await setup();
    handler = createMcpFetchHandler({ token: TOKEN, db: h.db });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });
  const auth = () => ({ authorization: `Bearer ${TOKEN}`, [INVESTIGATION_HEADER]: h.investigationId });

  test("initialize, list exactly five tools, call query and cite", async () => {
    const init = await handler(
      req(
        {
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        },
        auth(),
      ),
    );
    expect(init.status).toBe(200);
    expect((await rpc(init)).result?.serverInfo).toMatchObject({ name: "aletheia" });

    const list = await rpc(await handler(req({ jsonrpc: "2.0", id: 2, method: "tools/list" }, auth())));
    const names = (list.result?.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(["cite", "get_filing", "query", "trace_money", "vote_base_rate"]);

    const call = await rpc(
      await handler(
        req(
          { jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "query", arguments: { sql: "select count(*)::int as n from v_money" } } },
          auth(),
        ),
      ),
    );
    const content = call.result?.content as { text: string }[];
    expect(JSON.parse(content[0].text).rows).toEqual([{ n: 80 }]);

    const denied = await rpc(
      await handler(
        req(
          { jsonrpc: "2.0", id: 4, method: "tools/call",
            params: { name: "query", arguments: { sql: "select * from money_edge" } } },
          auth(),
        ),
      ),
    );
    expect(denied.result?.isError).toBe(true);
    expect((denied.result?.content as { text: string }[])[0].text).toContain("permission denied");

    const cited = await rpc(
      await handler(
        req(
          { jsonrpc: "2.0", id: 5, method: "tools/call",
            params: { name: "cite", arguments: {
              sentence: "CA HOMES COMMITTEE reported a $4,850,000 contribution on 2026-09-10.",
              edge_ids: ["a848c8fc-a74a-37f1-b099-9ba3b7b286a2"] } } },
          auth(),
        ),
      ),
    );
    const claimId = JSON.parse((cited.result?.content as { text: string }[])[0].text).claim_id;
    const [row] = await h.admin`select investigation_id from claim where id = ${claimId}`;
    expect(row.investigation_id).toBe(h.investigationId);
  });
});
