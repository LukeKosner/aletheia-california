import { describe, expect, test } from "bun:test";
import { displayName, formLabel, lobbyFilerOf, period, shortDate } from "./filing-label";

// Names below are filers in the CAL-ACCESS answers checked on 2026-11-19 (for example filings 3172629 and 3040252).
describe("filing labels", () => {
  test("title-cases registry names but keeps initials and acronyms", () => {
    expect(displayName("CALIFORNIA REAL ESTATE POLITICAL ACTION COMMITTEE (CREPAC) - CALIFORNIA ASSOCIATION OF REALTORS")).toBe("California Real Estate Political Action Committee (CREPAC) - California Association of Realtors");
    expect(displayName("KP PUBLIC AFFAIRS")).toBe("KP Public Affairs");
    expect(displayName("Harris Policy Group")).toBe("Harris Policy Group");
  });
  test("names forms in plain English", () => {
    expect(formLabel("F625")).toBe("Lobbying firm report");
    expect(formLabel("F496")).toBe("Independent expenditure report");
    expect(formLabel("F999")).toBe("Form 999");
  });
  test("formats dates and periods without time zone shifts", () => {
    expect(shortDate("2026-10-31 02:44:14+00")).toBe("Oct 31, 2026");
    expect(period("2026-07-01", "2026-09-30")).toBe("Jul–Sep 2026");
    expect(period("2025-12-01", "2026-02-28")).toBe("Dec 2025–Feb 2026");
  });
  test("a lobbying firm report is named for its one firm", () => {
    const firm = { untrusted_text: "KP PUBLIC AFFAIRS" };
    expect(lobbyFilerOf([{ firm_name: firm, employer_name: { untrusted_text: "GOOGLE LLC" } }, { firm_name: firm, employer_name: { untrusted_text: "VERIZON" } }])).toBe("KP Public Affairs");
  });
});
