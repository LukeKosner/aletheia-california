/** Local configuration generator only. No network calls, secrets, DB access or remote mutation. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import models from "./models.json";
const base = process.env.HR_REVIEWED_BASE;
const secretRef = process.env.HR_MCP_SECRET_REF;
const mcpUrl = process.env.ALETHEIA_MCP_URL;
const toolsJson = process.env.HR_HARD_DISABLED_TOOLS;
const output = process.env.P9_CONFIG_OUTPUT;
if (!base || !secretRef || !mcpUrl || !toolsJson || !output) throw new Error("Set HR_REVIEWED_BASE, HR_MCP_SECRET_REF, ALETHEIA_MCP_URL, HR_HARD_DISABLED_TOOLS and P9_CONFIG_OUTPUT; see agents/README.md.");
const url = new URL(mcpUrl);
if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.pathname !== "/api/mcp") throw new Error("Use the deployed private HTTPS /api/mcp URL.");
const disabled: unknown = JSON.parse(toolsJson);
if (!Array.isArray(disabled) || disabled.length === 0 || disabled.some((v) => typeof v !== "string")) throw new Error("Supply the reviewed built-in tool list from the live base catalog; do not guess names.");
const shared = await readFile(new URL("./instructions/shared.md", import.meta.url), "utf8");
await mkdir(output, { recursive: true });
// Ask keeps the base's web search / web fetch tools (see sync-harnesses.ts); every other tool stays disabled.
const isWebTool = (name: string) => /^web[_-]?(search|fetch)$/iu.test(name);
for (const type of ["measure", "bill", "footprint", "interests", "ask"]) {
  const specialized = await readFile(new URL(`./instructions/${type}.md`, import.meta.url), "utf8");
  const payload = {
    name: `Aletheia ${type}`, base, default_model: models.writer.model,
    system_prompt: `${shared}\n\n${specialized}`, disabled_tools: type === "ask" ? (disabled as string[]).filter((name) => !isWebTool(name)) : disabled,
    mcp_servers: [{ name: "aletheia", url: mcpUrl, auth: secretRef, headers: { "X-Aletheia-Investigation-Id": "$headers.X-Aletheia-Investigation-Id" } }],
    additional_headers: ["X-Aletheia-Investigation-Id"], plugins: [], skills: [],
    ...(type === "ask" ? models.task_limits.ask : models.task_limits.records),
  };
  await writeFile(resolve(output, `${type}.json`), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}
console.log("Prepared five local payloads. Nothing was sent to HarnessRouter. Provider routing and hard tool enforcement still require review.");
