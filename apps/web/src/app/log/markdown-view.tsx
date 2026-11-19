/**
 * Renders the blocks from `markdown.ts`. Typography is applied here rather than
 * with a prose plugin so the entry body uses the same theme tokens as the rest
 * of the page.
 */
import { Fragment } from "react";
import type { Block, Inline, ListItem } from "./markdown";
import { parseBlocks } from "./markdown";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>
          {node.type === "text" ? (
            node.value
          ) : node.type === "code" ? (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.value}</code>
          ) : node.type === "strong" ? (
            <strong className="font-semibold text-foreground">
              <InlineNodes nodes={node.children} />
            </strong>
          ) : node.type === "em" ? (
            <em>
              <InlineNodes nodes={node.children} />
            </em>
          ) : (
            <a
              href={node.href}
              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
              rel="noopener noreferrer"
            >
              <InlineNodes nodes={node.children} />
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}

function Items({ items, nested = false }: { items: ListItem[]; nested?: boolean }) {
  return (
    <ul className={nested ? "mt-1 ml-4 space-y-1" : "ml-4 space-y-1.5"}>
      {items.map((item, i) => (
        <li key={i} className="list-disc pl-1 marker:text-muted-foreground">
          <InlineNodes nodes={item.content} />
          {item.children.length > 0 ? <Items items={item.children} nested /> : null}
        </li>
      ))}
    </ul>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const className =
        block.level === 2
          ? "mt-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          : "mt-4 text-sm font-semibold text-foreground";
      const Tag = block.level === 2 ? "h3" : block.level === 3 ? "h4" : "h5";
      return (
        <Tag className={className}>
          <InlineNodes nodes={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <InlineNodes nodes={block.content} />
        </p>
      );
    case "list":
      return <Items items={block.items} />;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
          <code>{block.value}</code>
        </pre>
      );
  }
}

/** Renders a build log entry body. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} />
      ))}
    </div>
  );
}
