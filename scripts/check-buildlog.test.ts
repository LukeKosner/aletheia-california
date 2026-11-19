import { describe, expect, test } from "bun:test";
import { ENTRY_PATH, REQUIRED_SECTIONS, validateEntry } from "./check-buildlog";

// Shaped on buildlog/2026-11-15-1555-repo-setup.mdx.
const PATH = "buildlog/2026-11-15-1555-repo-setup.mdx";
const SOURCE = `---
date: 2026-11-15
author: agent:setup
reviewer:
task: Set up the monorepo so many agents can work in parallel on separate branches
---

## Shipped

- Bun monorepo.

## Metric

- 15 of 15 tables created on the Neon dev database.

## Broke or learned

- \`drizzle-kit push\` needs a TTY.

## Evidence

- CI on PR #1: 3 of 3 checks pass.
`;

describe("ENTRY_PATH", () => {
  test("accepts the documented name", () => {
    expect(ENTRY_PATH.test(PATH)).toBe(true);
  });

  test("rejects names that break the rule", () => {
    for (const path of [
      "buildlog/repo-setup.mdx",
      "buildlog/2026-11-15-repo-setup.mdx",
      "buildlog/2026-11-15-1555-Repo-Setup.mdx",
      "buildlog/2026-11-15-1555-repo-setup.md",
      "buildlog/nested/2026-11-15-1555-repo-setup.mdx",
    ]) {
      expect(ENTRY_PATH.test(path)).toBe(false);
    }
  });
});

describe("validateEntry", () => {
  test("a well-formed entry has no problems", () => {
    expect(validateEntry(PATH, SOURCE)).toEqual([]);
  });

  test("a blank reviewer is fine — the author leaves it for a human", () => {
    expect(validateEntry(PATH, SOURCE)).toEqual([]);
    expect(validateEntry(PATH, SOURCE.replace("reviewer:", "reviewer: Luke Kosner"))).toEqual([]);
  });

  test("flags a bad file name", () => {
    const problems = validateEntry("buildlog/notes.mdx", SOURCE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("YYYY-MM-DD-HHMM-slug.mdx");
  });

  test("flags missing frontmatter", () => {
    const problems = validateEntry(PATH, "## Shipped\n\n- a thing\n");
    expect(problems[0]).toContain("no frontmatter");
  });

  test("flags each missing required key", () => {
    const problems = validateEntry(PATH, SOURCE.replace("reviewer:\n", ""));
    expect(problems.some((p) => p.includes("`reviewer`"))).toBe(true);
  });

  test("flags an empty author or task", () => {
    const problems = validateEntry(PATH, SOURCE.replace("author: agent:setup", "author:"));
    expect(problems.some((p) => p.includes("`author` is empty"))).toBe(true);
  });

  test("flags a date that disagrees with the file name", () => {
    const problems = validateEntry(PATH, SOURCE.replace("date: 2026-11-15", "date: 2026-11-14"));
    expect(problems.some((p) => p.includes("does not match the file name date"))).toBe(true);
  });

  test("flags every missing section", () => {
    for (const section of REQUIRED_SECTIONS) {
      const problems = validateEntry(PATH, SOURCE.replace(`## ${section}`, "## Something else"));
      expect(problems.some((p) => p.includes(`## ${section}`))).toBe(true);
    }
  });
});
