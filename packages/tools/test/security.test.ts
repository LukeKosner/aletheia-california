/** `query` and the agent_ro role cannot write and cannot read raw tables. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runQuery, wrapAgentSql } from "../src/tools/query";
import { ADMIN_URL, setup, type Harness } from "./harness";

describe("wrapAgentSql", () => {
  test("strips trailing semicolons and refuses set_config and empty input", () => {
    expect(wrapAgentSql("select 1;;  ")).toBe("select * from (\nselect 1\n) as agent_query limit 501");
    expect(() => wrapAgentSql("select set_config('statement_timeout', '0', false)")).toThrow(/set_config/);
    expect(() => wrapAgentSql("  ;")).toThrow(/empty/);
  });
});

describe.skipIf(!ADMIN_URL)("query cannot write or read raw tables", () => {
  let h: Harness;
  let direct: postgres.Sql;
  beforeAll(async () => {
    h = await setup();
    direct = postgres(h.agentUrl, { max: 1, onnotice: false });
  }, 60_000);
  afterAll(async () => {
    await direct?.end();
    await h?.close();
  });

  const RAW_TABLES = ["money_edge", "entity", "entity_alias", "filing", "lobby_activity", "bill", "vote", "interest",
    "claim", "investigation", "card", "feedback", "correction", "event"];

  for (const table of RAW_TABLES) {
    test(`query cannot read ${table}`, async () => {
      await expect(runQuery(h.db, `select * from ${table} limit 1`)).rejects.toThrow(/permission denied/);
    });
  }

  const WRITES: [string, RegExp][] = [
    ["insert into claim (investigation_id, sentence) values (gen_random_uuid(), 'x')", /syntax error/],
    ["delete from money_edge", /syntax error/],
    ["update v_entities set name = 'x'", /syntax error/],
    ["select 1) as q; delete from money_edge; select (1", /cannot insert multiple commands/],
    ["with d as (delete from money_edge returning *) select * from d", /WITH clause containing a data-modifying/],
    ["select * from v_money for update", /FOR UPDATE|read-only|permission denied/],
    ["select nextval('x')", /does not exist|read-only/],
    ["select pg_catalog.lo_create(0)", /read-only|permission denied/],
    ["select set_config('role', 'postgres', false)", /set_config/],
  ];
  for (const [sql, err] of WRITES) {
    test(`query refuses: ${sql}`, async () => {
      await expect(runQuery(h.db, sql)).rejects.toThrow(err);
    });
  }

  test("no rows changed and nothing was written by query", async () => {
    const [{ edges }] = await h.admin`select count(*)::int as edges from money_edge`;
    const [{ claims }] = await h.admin`select count(*)::int as claims from claim`;
    expect(edges).toBe(80);
    expect(claims).toBe(0);
  });

  test("agent_ro itself (without the query wrapper) has SELECT on the six views only", async () => {
    const [{ statement_timeout }] = await direct`show statement_timeout`;
    expect(statement_timeout).toBe("10s");
    // postgres.js queries are lazy thenables; await them inside a real async function.
    const error = async (q: () => PromiseLike<unknown>) => {
      try {
        await q();
        return "no error";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await error(() => direct`select * from money_edge limit 1`)).toMatch(/permission denied/);
    // agent_ro may switch its own session out of read-only mode; the grants still stop every write.
    await direct.unsafe("set default_transaction_read_only = off");
    expect(await error(() => direct`insert into claim (investigation_id, sentence) values (gen_random_uuid(), 'x')`))
      .toMatch(/permission denied/);
    expect(await error(() => direct`update v_entities set name = 'x'`)).toMatch(/permission denied/);
    expect(await error(() => direct`delete from v_money`)).toMatch(/permission denied|cannot delete from view/);
    expect(await error(() => direct`create table public.x (a int)`)).toMatch(/permission denied/);
    expect(await error(() => direct`set role postgres`)).toMatch(/permission denied/);
    const grants = await h.admin<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'agent_ro' order by table_name`;
    expect(grants.map((g) => `${g.table_name}:${g.privilege_type}`)).toEqual([
      "v_bill_authors:SELECT", "v_entities:SELECT", "v_interests:SELECT", "v_lobby:SELECT", "v_money:SELECT",
      "v_votes:SELECT",
    ]);
    const writer = await h.admin<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants where grantee = 'claim_writer'`;
    expect(writer.map((g) => `${g.table_name}:${g.privilege_type}`)).toEqual(["claim:INSERT"]);
  });

  test("statement timeout stops long queries at 10 s", async () => {
    const t0 = Date.now();
    await expect(runQuery(h.db, "select pg_sleep(30)")).rejects.toThrow(/statement timeout/);
    expect(Date.now() - t0).toBeLessThan(15_000);
  }, 20_000);
});
