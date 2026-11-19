import { describe, expect, test } from "bun:test";
import { interviewInsights, percent, tally } from "./insights";
import { NOT_ASKED } from "./taxonomy";

// Labels are tags from ISSUES in ./taxonomy.ts, not interview data.
describe("tally", () => {
  test("counts across lists, most common first, ties alphabetical", () => {
    expect(tally([["Housing and rent", "Transportation"], ["Housing and rent"], ["Education"]])).toEqual([
      ["Housing and rent", 2], ["Education", 1], ["Transportation", 1],
    ]);
  });
  test("empty input", () => expect(tally([])).toEqual([]));
});

describe("percent", () => {
  test("rounds to a whole percent", () => expect(percent(1, 3)).toBe(33));
  test("zero total", () => expect(percent(2, 0)).toBe(0));
});

describe("interviewInsights", () => {
  // Every value is a vocabulary entry from ./taxonomy.ts (counties, age ranges, parties, issue tags), not interview data.
  // Question text reuses issue tags so grouping can be tested without inventing voter words.
  const rows = [
    { county: "Los Angeles", ageRange: "25-34", party: "Democratic", issues: ["Housing and rent", "Transportation"], questions: ["Housing and rent?"] },
    { county: "Los Angeles", ageRange: "65+", party: "Republican", issues: ["Housing and rent"], questions: ["housing  and rent"] },
    { county: "San Diego", ageRange: "25-34", party: NOT_ASKED, issues: ["Education"], questions: ["Education"] },
    { county: NOT_ASKED, ageRange: NOT_ASKED, party: NOT_ASKED, issues: ["Education"], questions: [] },
  ];

  test("totals, issues with percents, and breakdowns that leave out Not asked", () => {
    const r = interviewInsights(rows);
    expect(r.total_interviews).toBe(4);
    expect(r.top_issues[0]).toEqual({ issue: "Education", count: 2, percent: 50 });
    expect(r.by_county).toEqual([{ value: "Los Angeles", count: 2 }, { value: "San Diego", count: 1 }]);
    expect(r.by_age_range).toEqual([{ value: "25-34", count: 2 }, { value: "65+", count: 1 }]);
    expect(r.by_party.map((p) => p.value)).toEqual(["Democratic", "Republican"]);
    expect(r.common_questions).toEqual([{ question: "Housing and rent?", count: 2 }, { question: "Education", count: 1 }]);
    expect(r.page).toBe("/interview/insights");
  });

  test("filters match case-insensitively and accept a trailing County", () => {
    const r = interviewInsights(rows, { county: "los angeles county", issue: "housing and rent" });
    expect(r.filter).toEqual({ county: "Los Angeles", issue: "Housing and rent", party: null });
    expect(r.total_interviews).toBe(2);
  });

  test("unknown filter values are refused", () => {
    expect(() => interviewInsights(rows, { county: "Atlantis" })).toThrow("Unknown county");
  });
});
