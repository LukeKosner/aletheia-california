import { describe, expect, test } from "bun:test";
import { firstLineOfSection, parseBlocks, parseInline, toPlainText } from "./markdown";

describe("parseInline", () => {
  test("plain text", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", value: "just words" }]);
  });

  test("code, bold, italic and links", () => {
    expect(toPlainText(parseInline("run `bun test` now"))).toBe("run bun test now");
    expect(parseInline("a **bold** b")[1]).toMatchObject({ type: "strong" });
    expect(parseInline("a _soft_ b")[1]).toMatchObject({ type: "em" });
    expect(parseInline("see [docs](https://example.org)")[1]).toMatchObject({
      type: "link",
      href: "https://example.org",
    });
  });

  test("code wins over emphasis, so markers inside backticks stay literal", () => {
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  test("underscores inside identifiers are not italics", () => {
    expect(toPlainText(parseInline("entity_match_precision"))).toBe("entity_match_precision");
    expect(parseInline("entity_match_precision").every((n) => n.type === "text")).toBe(true);
  });

  test("an unmatched marker stays literal", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", value: "2 * 3 = 6" }]);
  });
});

describe("parseBlocks", () => {
  test("headings, paragraphs and lists", () => {
    const blocks = parseBlocks("## Shipped\n\nA sentence.\n\n- one\n- two\n");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    const list = blocks[2];
    expect(list.type === "list" && list.items.length).toBe(2);
  });

  test("indented bullets nest one level", () => {
    const blocks = parseBlocks("- parent\n  - child\n- sibling\n");
    const list = blocks[0];
    if (list?.type !== "list") throw new Error("expected a list");
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.children).toHaveLength(1);
    expect(toPlainText(list.items[0]!.children[0]!.content)).toBe("child");
  });

  test("a wrapped paragraph joins into one block", () => {
    const blocks = parseBlocks("one line\nand its continuation\n");
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0];
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(toPlainText(paragraph.content)).toBe("one line and its continuation");
  });

  test("fenced code keeps its lines and language", () => {
    const blocks = parseBlocks("```bash\nbun test\nbun run lint\n```\n");
    expect(blocks[0]).toEqual({ type: "code", lang: "bash", value: "bun test\nbun run lint" });
  });

  test("a heading directly after a list ends the list", () => {
    const blocks = parseBlocks("- one\n\n## Metric\n\n- 15 of 15 tables\n");
    expect(blocks.map((b) => b.type)).toEqual(["list", "heading", "list"]);
  });

  test("empty input yields no blocks", () => {
    expect(parseBlocks("")).toEqual([]);
  });
});

describe("firstLineOfSection", () => {
  // The Metric section of buildlog/2026-11-15-1555-repo-setup.mdx.
  const body =
    "## Shipped\n\n- Bun monorepo.\n\n## Metric\n\n- 15 of 15 tables created on the Neon dev database.\n\n## Evidence\n\n- CI passes.\n";

  test("returns the first bullet under the heading", () => {
    expect(firstLineOfSection(body, "Metric")).toBe(
      "15 of 15 tables created on the Neon dev database.",
    );
  });

  test("matches the heading case-insensitively", () => {
    expect(firstLineOfSection(body, "metric")).not.toBe("");
  });

  test("returns empty for a missing section", () => {
    expect(firstLineOfSection(body, "Rollback")).toBe("");
  });
});
