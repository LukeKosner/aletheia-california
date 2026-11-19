import { describe, expect, test } from "bun:test";
import { mapping, numeric, parseFrontmatter, scalar } from "./frontmatter";

// Shaped on the real entries in buildlog/ (e.g. 2026-11-15-1555-repo-setup.mdx).
const ENTRY = `---
date: 2026-11-15
author: agent:setup
reviewer:
task: Set up the monorepo so many agents can work in parallel on separate branches
---

## Shipped

- Bun monorepo.
`;

describe("parseFrontmatter", () => {
  test("reads the keys the build log uses", () => {
    const { data, body } = parseFrontmatter(ENTRY);
    expect(scalar(data, "date")).toBe("2026-11-15");
    expect(scalar(data, "author")).toBe("agent:setup");
    expect(scalar(data, "task")).toBe(
      "Set up the monorepo so many agents can work in parallel on separate branches",
    );
    expect(body.startsWith("## Shipped")).toBe(true);
  });

  test("an unfilled reviewer is an empty string, and the key is still present", () => {
    const { data } = parseFrontmatter(ENTRY);
    expect("reviewer" in data).toBe(true);
    expect(scalar(data, "reviewer")).toBe("");
  });

  test("a filled reviewer keeps its value", () => {
    const { data } = parseFrontmatter(ENTRY.replace("reviewer:", "reviewer: Luke Kosner"));
    expect(scalar(data, "reviewer")).toBe("Luke Kosner");
  });

  test("values may contain colons", () => {
    const { data } = parseFrontmatter("---\ntask: Load CAL-ACCESS: every schedule\n---\nbody\n");
    expect(scalar(data, "task")).toBe("Load CAL-ACCESS: every schedule");
  });

  test("indented pairs under an empty key become a nested map", () => {
    // Arbitrary parser fixture: these are not measurements from a real run.
    const { data } = parseFrontmatter(
      "---\nauthor: agent:resolve\nmetrics:\n  entity_match_precision: 0.5\n  entity_match_pairs: 10\ntask: Resolve\n---\nbody\n",
    );
    expect(mapping(data, "metrics")).toEqual({
      entity_match_precision: "0.5",
      entity_match_pairs: "10",
    });
    expect(scalar(data, "task")).toBe("Resolve");
    expect(scalar(data, "author")).toBe("agent:resolve");
  });

  test("strips surrounding quotes", () => {
    const { data } = parseFrontmatter(`---\ntask: "Quoted"\nauthor: 'single'\n---\n`);
    expect(scalar(data, "task")).toBe("Quoted");
    expect(scalar(data, "author")).toBe("single");
  });

  test("no frontmatter block: everything is body", () => {
    const { data, body } = parseFrontmatter("## Shipped\n\n- a thing\n");
    expect(data).toEqual({});
    expect(body).toBe("## Shipped\n\n- a thing\n");
  });

  test("an unterminated block is not treated as frontmatter", () => {
    const { data } = parseFrontmatter("---\ndate: 2026-11-15\n\n## Shipped\n");
    expect(data).toEqual({});
  });

  test("handles CRLF line endings", () => {
    const { data } = parseFrontmatter("---\r\ndate: 2026-11-15\r\n---\r\n\r\n## Shipped\r\n");
    expect(scalar(data, "date")).toBe("2026-11-15");
  });

  test("scalar and mapping never throw on the wrong shape", () => {
    const { data } = parseFrontmatter("---\nmetrics:\n  a: 1\n---\n");
    expect(scalar(data, "metrics")).toBe("");
    expect(mapping(data, "missing")).toEqual({});
  });
});

describe("numeric", () => {
  test("parses plain numbers", () => {
    expect(numeric("0.5")).toBe(0.5);
    expect(numeric("10")).toBe(10);
    expect(numeric(".25")).toBe(0.25);
  });

  test("a trailing percent lands on the same 0-1 scale", () => {
    expect(numeric("50%")).toBe(0.5);
  });

  test("rejects anything that is not a number", () => {
    expect(numeric(undefined)).toBeNull();
    expect(numeric("")).toBeNull();
    expect(numeric("high")).toBeNull();
    expect(numeric("1.2.3")).toBeNull();
    expect(numeric("12 pairs")).toBeNull();
  });
});
