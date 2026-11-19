import { describe, expect, test } from "bun:test";
import { readFlags } from "./flags";

describe("readFlags", () => {
  test("defaults: everything off except SHOW_INDIVIDUAL_DONORS", () => {
    const f = readFlags({});
    expect(f.PUBLIC_SITE).toBe(false);
    expect(f.PUBLIC_SIGNUP).toBe(false);
    expect(f.SHOW_INDIVIDUAL_DONORS).toBe(true);
    expect(f.CARDS_PUBLIC).toBe(false);
    expect(f.PAYMENTS_ENABLED).toBe(false);
    expect(f.BLOCK_COMMITTEE_DOMAINS).toBe(false);
    expect(f.CAMPUS_GAME).toBe(false);
    expect(f.LOCAL_FILERS).toBe(false);
    expect(f.FORM700).toBe(false);
    expect(f.INTERVIEW_PREVIEW).toBe(false);
    expect(f.OPEN_TESTING).toBe(false);
    expect(f.PRICING_MODE).toBe("monthly");
    expect(f.CAMPUS_LABELS).toBe("names");
  });

  test("parses booleans and enums", () => {
    const f = readFlags({
      PUBLIC_SITE: "true",
      SHOW_INDIVIDUAL_DONORS: "0",
      PRICING_MODE: "single",
      CAMPUS_LABELS: "nicknames",
    });
    expect(f.PUBLIC_SITE).toBe(true);
    expect(f.SHOW_INDIVIDUAL_DONORS).toBe(false);
    expect(f.PRICING_MODE).toBe("single");
    expect(f.CAMPUS_LABELS).toBe("nicknames");
  });

  test("unknown values fall back to defaults", () => {
    const f = readFlags({ PUBLIC_SITE: "maybe", PRICING_MODE: "weekly" });
    expect(f.PUBLIC_SITE).toBe(false);
    expect(f.PRICING_MODE).toBe("monthly");
  });
});
