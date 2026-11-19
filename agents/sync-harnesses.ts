/**
 * Creates or updates Aletheia's seven HarnessRouter harnesses and records them in agents/harnessrouter.json.
 * Standing instructions live in the harness (system_prompt), not in app code or task requests.
 *
 *   HR_API_KEY=... MCP_BEARER_TOKEN=... ALETHEIA_MCP_URL=https://<private host>/api/mcp bun agents/sync-harnesses.ts
 *
 * Reuses a harness whose name matches exactly. An existing harness is fetched first and replaced with a full
 * PUT guarded by If-Match, because a partial PUT resets omitted fields. No key or token is printed or written.
 * The "ask" harness is the one exception to "every built-in tool disabled": it keeps the base's web search / web fetch
 * tools so Ask can add labeled web sources beside verified records (instructions/ask.md).
 * MCP tools are not allowlisted per harness: every MCP harness reaches the same /api/mcp server, which serves query,
 * trace_money, get_filing, vote_base_rate, cite and the read-only interview_insights. Only ask.md tells the agent to use
 * interview_insights; shared.md keeps the other jobs to the five record tools. HarnessRouter documents no per-tool
 * MCP allowlist field, so none is invented here.
 * Contract: HarnessRouter skill references/api-reference.md and workspace-and-configuration.md (UHP 2026-09-28).
 */
import { readFile, writeFile } from "node:fs/promises";
import models from "./models.json";

const API = "https://api.harnessrouter.ai";
const key = process.env.HR_API_KEY, mcpToken = process.env.MCP_BEARER_TOKEN, mcpUrl = process.env.ALETHEIA_MCP_URL;
if (!key || !mcpToken || !mcpUrl) throw new Error("Set HR_API_KEY, MCP_BEARER_TOKEN and ALETHEIA_MCP_URL.");
const url = new URL(mcpUrl);
if (url.protocol !== "https:" || url.pathname !== "/api/mcp") throw new Error("ALETHEIA_MCP_URL must be the deployed private HTTPS /api/mcp URL.");

const headers = { authorization: `Bearer ${key}`, "content-type": "application/json", "UHP-Version": "2026-09-28" };
async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const response = await fetch(`${API}${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return { json: text ? JSON.parse(text) : {}, etag: response.headers.get("etag") };
}
const text = async (name: string) => (await readFile(new URL(`./instructions/${name}.md`, import.meta.url), "utf8")).trim();

type Base = { id: string; tools: { name: string }[]; models: { id: string; available: boolean }[] };
const bases = (await call("GET", "/v1/bases")).json.bases as Base[];
function builtins(baseId: string, model: string): string[] {
  const base = bases.find((b) => b.id === baseId);
  if (!base) throw new Error(`Base ${baseId} is not in the live catalog.`);
  if (!base.models.some((m) => m.id === model && m.available)) throw new Error(`${model} is not available on ${baseId}.`);
  return base.tools.map((t) => t.name);
}

/** Built-in web tools (for example web_fetch, web_search) that only the ask harness keeps enabled. */
const isWebTool = (name: string) => /^web[_-]?(search|fetch)$/iu.test(name);

// The MCP bearer token is stored once in HarnessRouter; harnesses hold only the returned reference.
const secretRef = (await call("PUT", "/v1/mcp-secrets/aletheia-mcp", { token: mcpToken })).json.ref;
if (typeof secretRef !== "string" || !secretRef) throw new Error("mcp-secrets did not return a ref.");

const shared = await text("shared");
const plans = [
  { key: "scope", name: "Aletheia scope check", ...models.extraction, instructions: await text("scope"), mcp: false, web: false, max_step: models.extraction.max_step, timeout_seconds: 60, max_cost_usd: 0.1 },
  ...(await Promise.all((["measure", "bill", "footprint", "interests", "general", "ask"] as const).map(async (type) => ({
    key: type, name: `Aletheia ${type}`, ...models.writer, instructions: `${shared}\n\n${await text(type)}`, mcp: true, web: type === "ask",
    // Same limits the app sends per task (apps/web/src/app/api/investigations/runtime.ts taskLimits): Ask is bounded tighter.
    ...(type === "ask" || type === "general" ? models.task_limits.ask : models.task_limits.records),
  })))),
];

const existing = (await call("GET", "/v1/harnesses")).json.harnesses as { id: string; name: string }[];
const record: Record<string, unknown>[] = [];
for (const plan of plans) {
  const tools = builtins(plan.base, plan.model);
  if (plan.web && !tools.some(isWebTool)) throw new Error(`${plan.base} has no built-in web search or web fetch tool for ${plan.name}.`);
  const body = {
    name: plan.name, base: plan.base, default_model: plan.model, system_prompt: plan.instructions,
    // Every built-in tool of the base is disabled; the only capability is the Aletheia MCP server.
    // Ask alone keeps the base's web search / web fetch tools; bash, files, edit, subagents, skills etc. stay disabled.
    disabled_tools: plan.web ? tools.filter((name) => !isWebTool(name)) : tools,
    mcp_servers: plan.mcp ? [{ name: "aletheia", url: mcpUrl, auth: secretRef, headers: { "X-Aletheia-Investigation-Id": "$headers.X-Aletheia-Investigation-Id" } }] : [],
    additional_headers: plan.mcp ? ["X-Aletheia-Investigation-Id"] : [],
    skills: [], plugins: [], max_step: plan.max_step, timeout_seconds: plan.timeout_seconds, max_cost_usd: plan.max_cost_usd,
  };
  const match = existing.find((h) => h.name === plan.name);
  let id: string;
  if (match) {
    const current = await call("GET", `/v1/harnesses/${match.id}`);
    await call("PUT", `/v1/harnesses/${match.id}`, body, current.etag ? { "If-Match": current.etag } : {});
    id = match.id;
    console.log(`updated ${plan.name}`);
  } else {
    id = (await call("POST", "/v1/harnesses", body)).json.id;
    console.log(`created ${plan.name}`);
  }
  const saved = (await call("GET", `/v1/harnesses/${id}`)).json;
  if (saved.systemPrompt !== plan.instructions || saved.defaultModel !== plan.model) throw new Error(`${plan.name} did not store its instructions or model.`);
  record.push({ feature: plan.key, env: `HR_${plan.key.toUpperCase()}_HARNESS_ID`, harness_id: id, name: plan.name, base: plan.base, model: plan.model, disabled_tools: body.disabled_tools, mcp_server: plan.mcp ? mcpUrl : null, instructions: plan.instructions });
}
await writeFile(new URL("./harnessrouter.json", import.meta.url), `${JSON.stringify({ workspace: (await call("GET", "/v1/me")).json.workspace_name, harnesses: record }, null, 2)}\n`);
console.log("Wrote agents/harnessrouter.json");
