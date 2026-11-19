import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy packages/db/.env.example to .env.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  // Manage only the roles this schema defines (agent_ro, claim_writer); leave Neon's own roles alone.
  entities: { roles: { provider: "neon", include: ["agent_ro", "claim_writer"] } },
  schemaFilter: ["public", "interview"],
  strict: true,
  verbose: true,
});
