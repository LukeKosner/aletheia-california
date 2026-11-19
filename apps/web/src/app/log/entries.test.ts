import { describe, expect, test } from "bun:test";
import {
  type BuildlogEntry,
  headlineMetric,
  isHumanWritten,
  isReviewed,
  parseEntry,
  precisionSeries,
  sortEntries,
} from "./entries";

// Shaped on buildlog/2026-11-15-1555-repo-setup.mdx.
function source(frontmatter: string, body = "## Metric\n\n- 15 of 15 tables created.\n") {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

const BASE = "date: 2026-11-15\nauthor: agent:setup\nreviewer:\ntask: Set up the monorepo";

describe("parseEntry", () => {
  test("reads frontmatter, slug and the time from the file name", () => {
    const entry = parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE));
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("2026-11-15-1555-repo-setup");
    expect(entry!.date).toBe("2026-11-15");
    expect(entry!.time).toBe("15:55");
    expect(entry!.author).toBe("agent:setup");
    expect(entry!.task).toBe("Set up the monorepo");
    expect(entry!.body.startsWith("## Metric")).toBe(true);
  });

  test("falls back to the file name date when frontmatter has none", () => {
    const entry = parseEntry("2026-11-15-1555-repo-setup.mdx", source("author: agent:setup"));
    expect(entry!.date).toBe("2026-11-15");
  });

  test("rejects file names that break the rule", () => {
    for (const name of [
      "repo-setup.mdx",
      "2026-11-15-repo-setup.mdx",
      "2026-11-15-1555-Repo-Setup.mdx",
      "2026-11-15-1555-repo-setup.md",
    ]) {
      expect(parseEntry(name, source(BASE))).toBeNull();
    }
  });
});

describe("isReviewed", () => {
  const entry = (reviewer: string) =>
    parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE.replace("reviewer:", `reviewer:${reviewer}`)))!;

  test("blank or whitespace-only reviewer is not reviewed", () => {
    expect(isReviewed(entry(""))).toBe(false);
    expect(isReviewed(entry("   "))).toBe(false);
  });

  test("a named reviewer is reviewed", () => {
    expect(isReviewed(entry(" Luke Kosner"))).toBe(true);
  });
});

describe("isHumanWritten", () => {
  const withAuthor = (author: string) =>
    parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE.replace("agent:setup", author)))!;

  test("agent authors are not human-written", () => {
    expect(isHumanWritten(withAuthor("agent:setup"))).toBe(false);
    expect(isHumanWritten(withAuthor("agent-log"))).toBe(false);
    expect(isHumanWritten(withAuthor("Agent:ingest"))).toBe(false);
  });

  test("anyone else is", () => {
    expect(isHumanWritten(withAuthor("Luke Kosner"))).toBe(true);
  });
});

describe("sortEntries", () => {
  test("newest first, by date then time", () => {
    const files = [
      "2026-11-15-1555-repo-setup.mdx",
      "2026-11-15-1653-calaccess-ingest.mdx",
      "2026-11-14-0900-earlier.mdx",
    ];
    const entries = files.map((file) => parseEntry(file, source(BASE))!);
    expect(sortEntries(entries).map((e) => e.file)).toEqual([
      "2026-11-15-1653-calaccess-ingest.mdx",
      "2026-11-15-1555-repo-setup.mdx",
      "2026-11-14-0900-earlier.mdx",
    ]);
  });

  test("does not mutate its input", () => {
    const entries = ["2026-11-14-0900-a.mdx", "2026-11-15-1653-b.mdx"].map(
      (file) => parseEntry(file, source(BASE))!,
    );
    const before = entries.map((e) => e.file);
    sortEntries(entries);
    expect(entries.map((e) => e.file)).toEqual(before);
  });
});

describe("precisionSeries", () => {
  // Arbitrary parser fixtures. No entry reports a real precision yet, so these
  // are round numbers chosen to exercise the code, not measurements.
  const withMetrics = (file: string, metrics: string) =>
    parseEntry(file, source(`${BASE}\nmetrics:\n${metrics}`))!;

  test("reads entity_match_precision, oldest first", () => {
    const entries: BuildlogEntry[] = [
      withMetrics("2026-11-16-1000-later.mdx", "  entity_match_precision: 0.9"),
      withMetrics("2026-11-15-1000-earlier.mdx", "  entity_match_precision: 0.5"),
    ];
    expect(precisionSeries(entries).map((p) => p.value)).toEqual([0.5, 0.9]);
  });

  test("skips entries without the metric or with an unparseable one", () => {
    const entries = [
      parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE))!,
      withMetrics("2026-11-16-1000-bad.mdx", "  entity_match_precision: pending"),
      withMetrics("2026-11-17-1000-good.mdx", "  entity_match_precision: 90%"),
    ];
    const series = precisionSeries(entries);
    expect(series).toHaveLength(1);
    expect(series[0]!.value).toBeCloseTo(0.9, 10);
  });

  test("no entries means an empty chart, not an error", () => {
    expect(precisionSeries([])).toEqual([]);
  });
});

describe("headlineMetric", () => {
  test("is the first bullet of the Metric section", () => {
    const entry = parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE))!;
    expect(headlineMetric(entry)).toBe("15 of 15 tables created.");
  });

  test("is empty when the entry has no Metric section", () => {
    const entry = parseEntry("2026-11-15-1555-repo-setup.mdx", source(BASE, "## Shipped\n\n- a thing\n"))!;
    expect(headlineMetric(entry)).toBe("");
  });
});
