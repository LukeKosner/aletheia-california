import { describe, expect, test } from "bun:test";
import { HASHTAGS, MAX_POST_LENGTH, buildShareText, buildShareUrl, flatten, truncate } from "./share";

describe("flatten", () => {
  test("collapses whitespace and strips markdown", () => {
    expect(flatten("a  **bold**\nword with `code` and [a link](https://example.org)")).toBe(
      "a bold word with code and a link",
    );
  });
});

describe("truncate", () => {
  test("leaves short text alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  test("cuts on a word boundary and adds an ellipsis", () => {
    const out = truncate("one two three four five", 14);
    expect(out.length).toBeLessThanOrEqual(14);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("one two three…");
  });

  test("handles degenerate limits", () => {
    expect(truncate("anything", 0)).toBe("");
    expect(truncate("anything", 1)).toBe("…");
  });
});

describe("buildShareText", () => {
  // Shaped on buildlog/2026-11-15-1555-repo-setup.mdx.
  const input = {
    task: "Set up the monorepo so many agents can work in parallel on separate branches",
    date: "2026-11-15",
    metric: "15 of 15 tables created on the Neon dev database.",
  };

  test("includes the task, the metric and all four hashtags", () => {
    const text = buildShareText(input);
    expect(text).toContain("Set up the monorepo");
    expect(text).toContain("15 of 15 tables");
    for (const tag of HASHTAGS) expect(text).toContain(tag);
  });

  test("ends with the hashtags", () => {
    expect(buildShareText(input).endsWith(HASHTAGS.join(" "))).toBe(true);
  });

  test("stays within the post limit, however long the entry is", () => {
    const long = { ...input, task: "x".repeat(500), metric: "y".repeat(500) };
    const text = buildShareText(long);
    expect(text.length).toBeLessThanOrEqual(MAX_POST_LENGTH);
    for (const tag of HASHTAGS) expect(text).toContain(tag);
  });

  test("drops the metric rather than the task when space is tight", () => {
    const text = buildShareText({ ...input, task: "x".repeat(200) });
    expect(text).toContain("x".repeat(100));
    expect(text).not.toContain("15 of 15");
    expect(text.length).toBeLessThanOrEqual(MAX_POST_LENGTH);
  });

  test("works without a metric", () => {
    const text = buildShareText({ task: input.task, date: input.date });
    expect(text.startsWith("Set up the monorepo")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_POST_LENGTH);
  });
});

describe("buildShareUrl", () => {
  test("is an X compose URL with the text encoded", () => {
    const url = buildShareUrl("Shipped a thing #UHP");
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(new URL(url).searchParams.get("text")).toBe("Shipped a thing #UHP");
  });

  test("encodes the hash so the hashtags survive", () => {
    expect(buildShareUrl("#UHP")).toBe("https://x.com/intent/post?text=%23UHP");
  });
});
