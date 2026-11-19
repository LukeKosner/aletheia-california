import { describe, expect, test } from "bun:test";
import { gameReaderURL, normalizeGameRows } from "../src/game";
describe("restricted campus aggregate surface", () => {
  test("only game_reader credentials; no owner fallback", () => {
    expect(gameReaderURL("postgres://game_reader:unit-test@localhost/test")).not.toBeNull();
    expect(gameReaderURL("postgres://owner:unit-test@localhost/test")).toBeNull();
    expect(gameReaderURL(undefined)).toBeNull();
  });
  test("empty successful read is zero; invalid counts are not fabricated", () => {
    const empty = normalizeGameRows([]);
    expect(empty.map((row) => row.campus)).toEqual(["stanford", "berkeley", "neither", "unassigned"]);
    expect(empty.every((row) => row.verifiedInvestigations === 0 && row.cardViews === 0)).toBe(true);
    expect(() => normalizeGameRows([{ campus: "stanford", verified_investigations: -1, card_views: 0 }])).toThrow();
    expect(() => normalizeGameRows([{ campus: "berkeley", verified_investigations: "unavailable", card_views: 0 }])).toThrow();
  });
});
