import type { ReadTools } from "./types";
export type ReadToolCall = (name: "query" | "vote_base_rate", arguments_: Record<string, string>) => Promise<{
  isError?: boolean; content: { type: string; text?: string }[];
}>;
function output(result: Awaited<ReturnType<ReadToolCall>>): Record<string, unknown> {
  if (result.isError || result.content.length !== 1 || result.content[0].type !== "text" || typeof result.content[0].text !== "string") throw new Error("Read-only data tool unavailable.");
  const value: unknown = JSON.parse(result.content[0].text);
  if (!value || typeof value !== "object" || Array.isArray(value) || "error" in value) throw new Error("Invalid data tool result.");
  return value as Record<string, unknown>;
}
/** Pass the host's authenticated packages/tools MCP caller. This module has no database client, credentials, or write-tool path. */
export function createReadTools(call: ReadToolCall): ReadTools {
  return {
    async query(sql) {
      const value = output(await call("query", { sql }));
      if (!Array.isArray(value.rows) || typeof value.truncated !== "boolean") throw new Error("Invalid query result.");
      return value as Awaited<ReturnType<ReadTools["query"]>>;
    },
    async voteBaseRate(billId, motion) {
      const value = output(await call("vote_base_rate", { bill_id: billId, motion }));
      if (!Array.isArray(value.roll_calls) || typeof value.truncated !== "boolean" || !("bill" in value)) throw new Error("Invalid base rate result.");
      return value as Awaited<ReturnType<ReadTools["voteBaseRate"]>>;
    },
  };
}
