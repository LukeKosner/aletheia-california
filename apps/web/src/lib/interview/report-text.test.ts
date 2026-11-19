import { describe, expect, test } from "bun:test";
import { readable, sameText, sourceLabel } from "./report-text";

// Filing 3146612 is a CAL-ACCESS Form 460 (https://cal-access.sos.ca.gov/); filer id 1484470 appears in rendered reports.
describe("report text", () => {
  test("strips raw ids", () => {
    expect(readable("The committee reported contributions (calaccess:filer:1484470).")).toBe("The committee reported contributions.");
    expect(readable("See calaccess:raw:3146612 for details.")).toBe("See for details.");
    expect(readable("Spending (note: estimated) rose.")).toBe("Spending (note: estimated) rose.");
  });
  test("spells out spending codes", () => {
    expect(readable("An ie_support filing and an ie_oppose filing.")).toBe("An independent expenditure supporting filing and an independent expenditure opposing filing.");
  });
  test("labels sources", () => {
    expect(sourceLabel("calaccess 3146612 F460")).toBe("CAL-ACCESS filing 3146612 (Form 460)");
    expect(sourceLabel("SB 329 bill information")).toBe("SB 329 bill information");
  });
  test("compares passages", () => {
    expect(sameText("Rent is high.", " rent is  high")).toBe(true);
    expect(sameText("Rent is high.", "Rent is low.")).toBe(false);
  });
});
