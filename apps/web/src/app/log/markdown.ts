/**
 * The markdown subset the build log actually uses, parsed into blocks.
 *
 * Build log entries are `.mdx`, but every entry so far is plain markdown:
 * `##` headings, `-` bullet lists (one level of nesting), paragraphs, fenced
 * code, and inline `code`, **bold**, _italic_ and [links](url). Parsing that
 * subset here avoids pulling an MDX toolchain into the app (rule 6).
 *
 * Anything unrecognised renders as text, so an entry is never dropped or
 * silently mangled — the worst case is a literal asterisk on the page.
 *
 * Pure: no React, no Node. `markdown.tsx` renders the blocks.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type ListItem = { content: Inline[]; children: ListItem[] };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: ListItem[] }
  | { type: "code"; lang: string; value: string };

// --- inline ----------------------------------------------------------------

// Order matters: code spans win over emphasis, so `**x**` inside backticks stays literal.
const INLINE = [
  { type: "code" as const, re: /`([^`]+)`/ },
  { type: "link" as const, re: /\[([^\]]+)\]\(([^()\s]+)\)/ },
  { type: "strong" as const, re: /\*\*([^*]+)\*\*/ },
  { type: "em" as const, re: /(?<![\w*])_([^_]+)_(?![\w*])/ },
];

/** Parses inline markdown into a flat-ish tree. Unmatched markers stay literal. */
export function parseInline(text: string): Inline[] {
  if (!text) return [];

  let best: { index: number; match: RegExpMatchArray; type: (typeof INLINE)[number]["type"] } | null = null;
  for (const { type, re } of INLINE) {
    const match = text.match(re);
    if (match?.index === undefined) continue;
    if (!best || match.index < best.index) best = { index: match.index, match, type };
  }

  if (!best) return [{ type: "text", value: text }];

  const { index, match, type } = best;
  const before = text.slice(0, index);
  const after = text.slice(index + match[0].length);
  const inner = match[1] ?? "";

  const node: Inline =
    type === "code"
      ? { type: "code", value: inner }
      : type === "link"
        ? { type: "link", href: match[2] ?? "", children: parseInline(inner) }
        : type === "strong"
          ? { type: "strong", children: parseInline(inner) }
          : { type: "em", children: parseInline(inner) };

  return [...(before ? parseInline(before) : []), node, ...parseInline(after)];
}

// --- blocks ----------------------------------------------------------------

const HEADING = /^(#{2,4})\s+(.*)$/;
const BULLET = /^([ \t]*)[-*]\s+(.*)$/;
const FENCE = /^```(\S*)\s*$/;

/** Parses a markdown body into blocks. Never throws. */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ type: "paragraph", content: parseInline(text) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      flushParagraph();
      const value: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !/^```/.test(lines[j]!); j++) value.push(lines[j]!);
      blocks.push({ type: "code", lang: fence[1] ?? "", value: value.join("\n") });
      i = j;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      const level = Math.min(4, Math.max(2, heading[1]!.length)) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, content: parseInline(heading[2]!.trim()) });
      continue;
    }

    if (BULLET.test(line)) {
      flushParagraph();
      const raw: string[] = [];
      let j = i;
      // A list runs until a blank line that is not followed by another bullet.
      for (; j < lines.length; j++) {
        const current = lines[j]!;
        if (BULLET.test(current)) {
          raw.push(current);
          continue;
        }
        if (!current.trim()) {
          const next = lines[j + 1];
          if (next !== undefined && BULLET.test(next)) continue;
          break;
        }
        if (/^[ \t]+\S/.test(current) && raw.length > 0) {
          // Continuation of the previous bullet.
          raw[raw.length - 1] += ` ${current.trim()}`;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", items: buildItems(raw) });
      i = j - 1;
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/** Turns bullet lines into a two-level item tree, keyed on leading whitespace. */
function buildItems(lines: string[]): ListItem[] {
  const root: ListItem[] = [];
  let baseIndent: number | null = null;

  for (const line of lines) {
    const match = line.match(BULLET);
    if (!match) continue;
    const indent = match[1]!.replace(/\t/g, "  ").length;
    const item: ListItem = { content: parseInline(match[2]!.trim()), children: [] };

    if (baseIndent === null) baseIndent = indent;
    const parent = root[root.length - 1];
    if (indent > baseIndent && parent) parent.children.push(item);
    else root.push(item);
  }

  return root;
}

/**
 * The first bullet or paragraph under a `## <name>` heading, as plain text.
 * Used for the share text, which leads with the entry's headline metric.
 */
export function firstLineOfSection(markdown: string, name: string): string {
  const blocks = parseBlocks(markdown);
  const start = blocks.findIndex(
    (b) => b.type === "heading" && toPlainText(b.content).toLowerCase() === name.toLowerCase(),
  );
  if (start === -1) return "";

  for (const block of blocks.slice(start + 1)) {
    if (block.type === "heading") break;
    if (block.type === "paragraph") return toPlainText(block.content);
    if (block.type === "list" && block.items[0]) return toPlainText(block.items[0].content);
  }
  return "";
}

/** Flattens inline nodes to plain text (for share text, titles and tests). */
export function toPlainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.value;
        default:
          return toPlainText(node.children);
      }
    })
    .join("");
}
