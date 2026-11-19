import { describe, expect, test } from "bun:test";
import { getTableColumns, isTable } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => isTable(v));

const EXPECTED = [
  "entity", "entity_alias", "filing", "money_edge", "lobby_activity", "bill", "bill_author",
  "vote", "interest", "investigation", "claim", "card", "feedback", "correction", "event",
  "auth_user", "auth_session", "auth_account", "auth_verification", "auth_rate_limit",
  // `interview` schema (voter-interview prototype)
  "session", "research", "payment", "payout",
];

describe("schema", () => {
  test("defines every expected table", () => {
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual([...EXPECTED].sort());
  });

  for (const t of tables) {
    const name = getTableConfig(t).name;
    test(`${name} has uuid id primary key and created_at`, () => {
      const cols = getTableColumns(t);
      expect(cols.id?.name).toBe("id");
      expect(cols.id?.columnType).toBe("PgUUID");
      expect(cols.id?.primary).toBe(true);
      expect(cols.createdAt?.name).toBe("created_at");
      expect(cols.createdAt?.notNull).toBe(true);
    });
  }

  test("interview tables live in the separate interview schema", () => {
    for (const t of [schema.interviewSession, schema.interviewResearch, schema.interviewPayment, schema.interviewPayout]) {
      expect(getTableConfig(t).schema).toBe("interview");
    }
  });

  test("money amounts are numeric(14,2)", () => {
    const amount = getTableColumns(schema.moneyEdge).amount as unknown as { precision: number; scale: number };
    expect(amount.precision).toBe(14);
    expect(amount.scale).toBe(2);
  });
});
