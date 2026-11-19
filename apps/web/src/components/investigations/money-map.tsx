"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fromApi, hydrateEvidence, type ApiResult } from "./evidence";
import { Controls, type NodeProps, type EdgeProps } from "@xyflow/react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Node, NodeHeader, NodeTitle } from "@/components/ai-elements/node";
import { Edge } from "@/components/ai-elements/edge";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { filingUrl, type Investigation, type FilingSource } from "./model";
import { filingMeta, filingTitle } from "./answer";
import { recordedInvestigation } from "./recorded";
import { Page, PageTitle } from "@/components/gov/ui";

function MoneyNode({ data }: NodeProps) {
  return <Node handles={{ source: data.side === "donor", target: data.side === "recipient" }} className="w-64"><NodeHeader><NodeTitle className="text-sm leading-snug">{String(data.label)}</NodeTitle></NodeHeader></Node>;
}
// A static existing edge avoids an animation for users who prefer reduced motion.
function MoneyEdge(props: EdgeProps) { return <Edge.Temporary {...props} />; }
const flowTheme = {
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--accent)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
  "--xy-attribution-background-color": "var(--card)",
  "--xy-edge-stroke": "var(--muted-foreground)",
  "--xy-background-pattern-color": "var(--border)",
} as CSSProperties;
const nodeTypes = { money: MoneyNode };
const edgeTypes = { money: MoneyEdge };

/** Keep the largest donors visible, with one count-only node for the rest.
 * Amounts are never added across schedules: duplicate reports may represent one contribution.
 * Each giver and receiver pair is drawn as one line, so 17 reports between two committees read as one connection.
 */
export function mapLayout(graph: NonNullable<Investigation["graph"]>) {
  const recipients = graph.nodes.filter((node) => node.side === "recipient");
  if (recipients.length > 199) return null;
  const donors = graph.nodes.filter((node) => node.side === "donor");
  const largest = new Map<string, number>();
  for (const edge of graph.edges) largest.set(edge.source, Math.max(largest.get(edge.source) ?? 0, Number(edge.amount) || 0));
  const sorted = [...donors].sort((a, b) => (largest.get(b.id) ?? 0) - (largest.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const limit = graph.nodes.length > 200 ? 199 - recipients.length : donors.length;
  const kept = sorted.slice(0, limit);
  const hidden = new Set(sorted.slice(limit).map((node) => node.id));
  const shown = [...kept, ...(hidden.size ? [{ id: "collapsed-donors", name: `${hidden.size} smaller givers`, side: "donor" as const }] : []), ...recipients];
  const positions = new Map<string, { x: number; y: number }>();
  for (const side of ["donor", "recipient"] as const) {
    let y = 0;
    for (const node of shown.filter((item) => item.side === side)) {
      positions.set(node.id, { x: side === "donor" ? 0 : 520, y });
      y += Math.max(110, Math.ceil(node.name.length / 24) * 22 + 60);
    }
  }
  const lines = new Map<string, { id: string; source: string; target: string; source_id: string; count: number }>();
  for (const edge of graph.edges) {
    const source = hidden.has(edge.source) ? "collapsed-donors" : edge.source, key = `${source}|${edge.target}`;
    const line = lines.get(key);
    if (line) line.count += 1; else lines.set(key, { id: edge.id, source, target: edge.target, source_id: edge.source_id, count: 1 });
  }
  return {
    collapsed: hidden.size,
    nodes: shown.map((node) => ({ id: node.id, type: "money", data: { label: node.name, side: node.side }, position: positions.get(node.id)! })),
    edges: [...lines.values()].map((line) => ({ id: line.id, source: line.source, target: line.target, type: "money", data: { source_id: line.source_id }, ariaLabel: `${line.count} reported amount${line.count === 1 ? "" : "s"}; show filing`, focusable: true, interactionWidth: 30 })),
  };
}

const money = (amount: string) => `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The map itself, drawn from an investigation already in memory. The answer page renders it inline, so the map
 * appears as soon as evidence loads, with no second fetch.
 */
export function MoneyMapView({ investigation, inline = false }: { investigation: Investigation; inline?: boolean }) {
  const [selected, setSelected] = useState<FilingSource | null>(null);
  const layout = useMemo(() => investigation.graph ? mapLayout(investigation.graph) : null, [investigation]);
  if (!investigation.graph) return null;
  const sources = new Map(investigation.sources.map((source) => [source.id, source]));
  const names = new Map(investigation.graph.nodes.map((node) => [node.id, node.name]));
  // Each giver and receiver pair once, with every reported amount kept separate (never summed across schedules).
  const pairs = new Map<string, { from: string; to: string; edges: NonNullable<Investigation["graph"]>["edges"] }>();
  for (const edge of investigation.graph.edges) {
    const key = `${edge.source}|${edge.target}`;
    const pair = pairs.get(key) ?? { from: names.get(edge.source) ?? "Unnamed filer", to: names.get(edge.target) ?? "Unnamed recipient", edges: [] };
    pair.edges.push(edge); pairs.set(key, pair);
  }
  if (!layout) return <p role="status" className="text-sm text-muted-foreground">This answer has too many recipients to draw. Ask a narrower question to see its map.</p>;
  return (
    <section className="flex flex-col gap-3" aria-label="Money map">
      {inline ? <h2 className="text-base font-semibold">Money map</h2> : null}
      <p className="text-sm text-muted-foreground">Givers on the left, receivers on the right. Select a line to see its filing.{layout.collapsed ? ` ${layout.collapsed} smaller givers are grouped into one box.` : ""}</p>
      <div className={inline ? "h-72 overflow-hidden rounded-xl border border-border sm:h-80" : "h-[28rem] overflow-hidden rounded-xl border border-border sm:h-[36rem]"} aria-label="Money flow map">
        <Canvas style={flowTheme} nodes={layout.nodes} edges={layout.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable panOnDrag panOnScroll={false} zoomOnScroll={!inline} preventScrolling={!inline} selectionOnDrag={false} minZoom={0.1} proOptions={{ hideAttribution: true }} onEdgeClick={(_, edge) => setSelected(sources.get(String(edge.data?.source_id)) ?? null)}><Controls showInteractive={false} /></Canvas>
      </div>
      {selected ? (
        <aside className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border p-4 text-sm" aria-label="Selected filing" aria-live="polite">
          <span><span className="font-medium">{filingTitle(selected)}</span>{filingMeta(selected) ? <span className="text-muted-foreground"> · {filingMeta(selected)}</span> : null}</span>
          <span className="flex gap-4">
            {filingUrl(selected.url) ? <a href={filingUrl(selected.url)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Open filing</a> : null}
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>Close</button>
          </span>
        </aside>
      ) : null}
      <details className="text-sm">
        <summary className="w-fit cursor-pointer list-none text-muted-foreground hover:text-foreground">Each reported amount ({investigation.graph.edges.length})</summary>
        <ul className="mt-3 flex flex-col gap-3" aria-label="Filing connections">
          {[...pairs.entries()].map(([key, pair]) => (
            <li key={key} className="flex flex-col gap-1">
              <span><span className="font-medium">{pair.from}</span><span className="text-muted-foreground"> to </span><span className="font-medium">{pair.to}</span></span>
              <span className="flex flex-wrap gap-1.5">
                {pair.edges.map((edge) => {
                  const source = sources.get(edge.source_id), url = source && filingUrl(source.url);
                  return url
                    ? <a key={edge.id} href={url} target="_blank" rel="noreferrer" title={[filingTitle(source), filingMeta(source)].filter(Boolean).join(" · ")} className="rounded-md bg-muted px-1.5 text-xs leading-5 text-muted-foreground hover:bg-accent hover:text-foreground">{money(edge.amount)}</a>
                    : <span key={edge.id} className="rounded-md bg-muted px-1.5 text-xs leading-5 text-muted-foreground">{money(edge.amount)}</span>;
                })}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** The standalone map page for shared links: loads the saved answer, then draws the same view. */
export function MoneyMap({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<Investigation | null>(id === recordedInvestigation.investigation_id ? recordedInvestigation : null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id === recordedInvestigation.investigation_id) return;
    const controller = new AbortController();
    void fetch(`/api/investigations/${encodeURIComponent(id)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("This investigation could not be loaded.");
      const result = await response.json() as ApiResult;
      const base = fromApi(result, "");
      if (!base) throw new Error("This investigation does not have a finished answer yet.");
      const data = await hydrateEvidence(base, result, controller.signal);
      if (!data.graph) throw new Error("This answer does not cite any money paths, so there is no map to draw.");
      setInvestigation(data);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Map unavailable."); });
    return () => controller.abort();
  }, [id]);
  return <Page>
    <PageTitle title="Money map" back={{ href: `/i/${encodeURIComponent(id)}`, label: "Back to the answer" }} />
    {error ? <p role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm">{error}</p> : null}
    {!investigation && !error ? <Shimmer as="p" className="text-sm">Drawing the money map</Shimmer> : null}
    {investigation?.evidence_note ? <p className="text-xs text-muted-foreground">{investigation.evidence_note}</p> : null}
    {investigation ? <MoneyMapView investigation={investigation} /> : null}
  </Page>;
}
