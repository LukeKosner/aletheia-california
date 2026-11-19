import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

/**
 * Creates a Drizzle client. Only server-side ingest/admin code should call this.
 * Agents and pages read data through packages/tools, never with a write-capable client.
 */
export function createDb(url: string = process.env.DATABASE_URL ?? "") {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 5 });
  return drizzle(client, { schema });
}
