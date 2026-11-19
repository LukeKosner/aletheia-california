/**
 * Each tool against real records. Fixture rows: CAL-ACCESS export of 2026-11-15 (see fixtures/calaccess_slice.json
 * and fixtures/export_calaccess_slice.py) and leginfo pubinfo_2025.zip SB 329 roll calls (see harness.ts).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cite } from "../src/tools/cite";
import { getFiling } from "../src/tools/get-filing";
import { runQuery } from "../src/tools/query";
import { traceMoney } from "../src/tools/trace-money";
import { normalizeMeasure, voteBaseRate } from "../src/tools/vote-base-rate";
import { bannedPhrase } from "../src/untrusted";
import { ADMIN_URL, setup, SLICE, type Harness } from "./harness";

const entityId = (key: string) => SLICE.entities.find((e) => e.canonical_key === key)!.id;
const filingUuid = (filingId: string) => SLICE.filings.find((f) => f.filing_id === filingId)!.id;

// CA HOMES COMMITTEE (filer 1481256), funded by the California Association of Realtors ballot measure committee
// (1400190), funded in turn by the California Association of Realtors Issues Mobilization PAC (782560).
const CA_HOMES = entityId("calaccess:filer:1481256");
const CAR_BMC = entityId("calaccess:filer:1400190");
const CAR_IMPAC = entityId("calaccess:filer:782560");
// 1400190 -> 1481256, $4,850,000 on 2026-09-10, Form 460 Schedule A line 2 of filing 3199099.
const EDGE_4_85M = "a848c8fc-a74a-37f1-b099-9ba3b7b286a2";
// 782560 -> 1400190, $3,000,000 on 2026-05-18, Form 460 Schedule A line 1 of filing 3172602.
const EDGE_3M = "f078ec97-0026-37d5-af16-7d8b6d3eb869";
// National Association of Realtors -> 1400190, $2,000,000 on 2026-03-04, Schedule A line 4 of filing 3147001.
const EDGE_NAR = "80bd6789-65cf-3843-a133-f30d6d58289f";

describe("unit", () => {
  test("normalizeMeasure", () => {
    expect(normalizeMeasure("SB 329")).toBe("SB-329");
    expect(normalizeMeasure("sb329")).toBe("SB-329");
    expect(normalizeMeasure("SBX1-1")).toBe("SBX1-1");
    expect(normalizeMeasure("AB 0013")).toBe("AB-13");
    expect(normalizeMeasure("drop table")).toBeUndefined();
  });
  test("bannedPhrase", () => {
    expect(bannedPhrase("The committee was bought by realtors")).toBe("bought");
    expect(bannedPhrase("Alleged BRIBERY")).toBe("bribe");
    expect(bannedPhrase("The committee reported a $4,850,000 contribution")).toBeUndefined();
  });
});

describe.skipIf(!ADMIN_URL)("tools against real records", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup();
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  test("query reads the views, caps rows at 500 and wraps free text", async () => {
    const r = await runQuery(
      h.db,
      `select edge_id, from_name, to_key, schedule, line_item, amount, date, filing_id, filing_url
       from v_money where edge_id = '${EDGE_4_85M}';`,
    );
    expect(r.row_count).toBe(1);
    const row = r.rows[0];
    expect(row.from_name).toEqual({
      untrusted_text: SLICE.entities.find((e) => e.id === CAR_BMC)!.name,
    });
    expect(row.to_key).toBe("calaccess:filer:1481256");
    expect(row.schedule).toBe("A");
    expect(row.line_item).toBe("2");
    expect(row.amount).toBe("4850000.00");
    expect(row.date).toBe("2026-09-10");
    expect(row.filing_id).toBe("3199099");
    expect(row.filing_url).toBe("https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=3199099&amendid=0");

    const aliased = await runQuery(h.db, `select upper(from_name) as x, schedule as s from v_money limit 1`);
    expect(aliased.rows[0].x).toHaveProperty("untrusted_text");
    expect(aliased.rows[0].s).not.toHaveProperty("untrusted_text");

    const big = await runQuery(h.db, "select g from generate_series(1, 1000) g");
    expect(big.row_count).toBe(500);
    expect(big.truncated).toBe(true);

    const timeout = await runQuery(h.db, "select current_setting('statement_timeout') as t");
    expect(timeout.rows[0].t).toEqual({ untrusted_text: "10s" });
  });

  test("trace_money up: CA HOMES COMMITTEE <- 1400190 <- 782560, with edge ids", async () => {
    const r = await traceMoney(h.db, { entity_id: CA_HOMES, direction: "up", max_depth: 2, min_amount: 0 });
    expect(r.root?.canonical_key).toBe("calaccess:filer:1481256");
    expect(r.root?.name).toEqual({ untrusted_text: "CA HOMES COMMITTEE" });
    const path = r.paths.find((p) => p.entity_ids.join() === [CA_HOMES, CAR_BMC, CAR_IMPAC].join());
    expect(path).toBeDefined();
    expect(path!.depth).toBe(2);
    expect(path!.hops[0]).toMatchObject({ from_entity_id: CAR_BMC, to_entity_id: CA_HOMES, largest_amount: "4850000.00" });
    expect(path!.hops[0].edge_ids).toContain(EDGE_4_85M);
    expect(path!.hops[1]).toMatchObject({ from_entity_id: CAR_IMPAC, to_entity_id: CAR_BMC, largest_amount: "3000000.00" });
    expect(path!.hops[1].edge_ids).toContain(EDGE_3M);
    const edge = r.edges.find((e) => e.edge_id === EDGE_4_85M)!;
    expect(edge).toMatchObject({ amount: "4850000.00", schedule: "A", line_item: "2", filing_id: "3199099" });
    // The same $4.85M contribution is reported on several schedules; the hop lists all of them.
    const schedules = r.edges
      .filter((e) => path!.hops[0].edge_ids.includes(e.edge_id) && e.amount === "4850000.00")
      .map((e) => e.schedule)
      .sort();
    expect(schedules).toEqual(["A", "E", "F497P1", "F497P2"]);
    expect(r.truncated).toBe(false);
  });

  test("trace_money min_amount and down", async () => {
    const big = await traceMoney(h.db, { entity_id: CA_HOMES, direction: "up", max_depth: 3, min_amount: 4_000_000 });
    expect(big.paths.map((p) => p.entity_ids)).toEqual([[CA_HOMES, CAR_BMC]]);
    expect(big.edges.every((e) => Number(e.amount) >= 4_000_000)).toBe(true);

    const down = await traceMoney(h.db, { entity_id: CAR_BMC, direction: "down", max_depth: 1, min_amount: 0 });
    const toHomes = down.paths.find((p) => p.entity_ids[1] === CA_HOMES)!;
    expect(toHomes.hops[0].edge_ids).toContain(EDGE_4_85M);
    expect(down.paths.every((p) => p.depth === 1)).toBe(true);
  });

  test("get_filing: form, dates, URL, schedule and line", async () => {
    const r = await getFiling(h.db, "3147001");
    expect(r.filings).toHaveLength(1);
    expect(r.filings[0]).toMatchObject({
      filing_uuid: filingUuid("3147001"),
      source: "calaccess",
      filing_id: "3147001",
      amendment_no: 0,
      form: "F460",
      period_start: "2026-01-01",
      period_end: "2026-03-31",
      url: "https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=3147001&amendid=0",
    });
    expect(r.filings[0].filed_at).toStartWith("2026-04-30");
    const nar = r.items.find((i) => i.edge_id === EDGE_NAR)!;
    expect(nar).toMatchObject({ schedule: "A", line_item: "4", amount: "2000000.00", date: "2026-03-04" });
    expect(nar.from_name).toEqual({ untrusted_text: "NATIONAL ASSOCIATION OF REALTORS" });
    expect(r.item_count).toBe(SLICE.edges.filter((e) => e.filing_id === "3147001").length);

    const byUuid = await getFiling(h.db, filingUuid("3147001"));
    expect(byUuid.items.map((i) => i.edge_id).sort()).toEqual(r.items.map((i) => i.edge_id).sort());
    expect((await getFiling(h.db, "999999999")).filings).toHaveLength(0);
  });

  test("vote_base_rate: SB 329 Assembly Floor third reading, 76-0 with 3 not voting", async () => {
    const r = await voteBaseRate(h.db, "SB 329", "third reading");
    expect(r.bill).toMatchObject({ session: "2025-2026", measure: "SB-329" });
    expect(r.roll_calls).toHaveLength(1);
    const call = r.roll_calls[0];
    expect(call).toMatchObject({ vote_date: "2026-08-25", location: "Assembly Floor" });
    expect(call.motion).toEqual({ untrusted_text: "SB 329 Blakespear Senate Third Reading By Dixon" });
    expect(call.counts).toEqual({ aye: 76, no: 0, nvr: 3, total: 79 });
    expect(call.members).toHaveLength(79);
    expect(call.members.find((m) => m.name?.untrusted_text === "Addis")?.result).toBe("aye");

    const consent = await voteBaseRate(h.db, r.bill!.bill_id, "special consent");
    expect(consent.roll_calls.map((c) => [c.vote_date, c.counts.aye, c.counts.nvr])).toEqual([
      ["2025-05-29", 38, 2],
      ["2026-08-28", 40, 0],
    ]);
    const all = await voteBaseRate(h.db, "SB-329", "");
    expect(all.totals.total).toBe(215);
  });

  test("cite inserts a claim through claim_writer and returns its id", async () => {
    const sentence =
      "On 2026-09-10 the California Association of Realtors ballot measure committee reported a $4,850,000 " +
      "contribution to CA HOMES COMMITTEE.";
    const r = await cite(h.db, h.investigationId, sentence, [EDGE_4_85M, EDGE_3M]);
    expect(r.claim_id).toMatch(/^[0-9a-f-]{36}$/u);
    const [row] = await h.admin`select investigation_id, sentence, edge_ids, filing_ids from claim where id = ${r.claim_id}`;
    expect(row.investigation_id).toBe(h.investigationId);
    expect(row.sentence).toBe(sentence);
    expect([...row.edge_ids].sort()).toEqual([EDGE_4_85M, EDGE_3M].sort());
    expect([...row.filing_ids].sort()).toEqual([filingUuid("3199099"), filingUuid("3172602")].sort());

    await expect(cite(h.db, h.investigationId, "Realtors bought the measure.", [EDGE_4_85M])).rejects.toThrow(/bought/);
    await expect(
      cite(h.db, h.investigationId, sentence, ["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toThrow(/unknown edge_ids/);
    await expect(cite(h.db, undefined, sentence, [EDGE_4_85M])).rejects.toThrow(/investigation id/);
  });
});
