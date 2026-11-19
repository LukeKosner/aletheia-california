import { recordedInvestigation } from "@/components/investigations/recorded";

export const CARD_TYPES = {
  measurefunders: "Measure funders",
  billmoneyvotes: "Bill, money & votes",
  organizationfootprint: "Organization footprint",
  cityrace: "City race",
} as const;
export type CardType = keyof typeof CARD_TYPES;
export const DISCLOSURE = "Written by an AI agent, checked against public filings.";
export const PREVIEW_ID = recordedInvestigation.investigation_id;
// A local preview route, never a generated secret, persisted card id or published alias.
export const PREVIEW_CODE = "321439";
export type ReceiptLine = {
  edgeId: string; filingId: string; amount: string; category: string;
  from: string; to: string; date: string; schedule: string; line: string; url: string;
  donorKind: "committee" | "org" | "person"; aggregate?: "employer" | "industry";
};
export type ReceiptCard = {
  id: string; type: CardType; finding: string; asOf: string; methodVersion: string;
  lines: readonly ReceiptLine[];
  verification: "not_run"; published: false; humanApproval: null;
};

// Recorded source only: CAL-ACCESS filing 3214397, F497P1 line 1.
// Mirrors the committed P10 source and packages/tools/test/fixtures/calaccess_slice.json.
export function recordedCard(): ReceiptCard {
  const graph = recordedInvestigation.graph!;
  const edge = graph.edges[0];
  return {
    id: PREVIEW_ID, type: "organizationfootprint",
    finding: "A filed contribution to CA Homes Committee.",
    asOf: "2026-11-15", methodVersion: "recorded-preview-v1",
    lines: [{ edgeId: edge.id, filingId: edge.source_id, amount: edge.amount,
      category: "Cited contribution", from: graph.nodes.find((n) => n.id === edge.source)!.name,
      to: graph.nodes.find((n) => n.id === edge.target)!.name,
      date: "2026-10-20", schedule: "F497P1", line: "1", donorKind: "committee",
      url: recordedInvestigation.sources[0].url }],
    verification: "not_run", published: false, humanApproval: null,
  };
}

export function cents(value: string): bigint {
  if (!/^-?\d{1,12}\.\d{2}$/.test(value)) throw new Error("Invalid filing amount");
  return BigInt(value.replace(".", ""));
}

/** Exact integer cents; each edge is counted once, and every category has receipts. */
export function numbers(card: Pick<ReceiptCard, "lines">) {
  const edges = new Set<string>();
  const categories = new Map<string, { cents: bigint; edgeIds: string[] }>();
  for (const line of card.lines) {
    if (edges.has(line.edgeId)) throw new Error("Duplicate filing edge");
    if (line.donorKind === "person" && !line.aggregate) throw new Error("Individual donor requires employer or industry aggregation");
    const url = new URL(line.url);
    if (url.protocol !== "https:" || !line.filingId || !line.edgeId || !line.category.trim()) throw new Error("Missing filing evidence");
    edges.add(line.edgeId);
    const category = categories.get(line.category) ?? { cents: BigInt(0), edgeIds: [] };
    category.cents += cents(line.amount);
    category.edgeIds.push(line.edgeId);
    categories.set(line.category, category);
  }
  if (!categories.size || categories.size > 5) throw new Error("Cards require one to five labeled numbers");
  return [...categories].map(([label, value]) => ({ label, ...value }));
}

export function formatMoney(value: bigint) {
  const sign = value < BigInt(0) ? "−" : "";
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}$${(absolute / BigInt(100)).toLocaleString("en-US")}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export function validateCard(card: ReceiptCard) {
  if (!Object.hasOwn(CARD_TYPES, card.type) || !card.finding.trim() || [...card.finding].length > 90) throw new Error("Invalid card finding");
  numbers(card);
  return card;
}

/** Deliberately fail closed: no trusted verifier/approval/publication/kill-state adapter exists yet. */
export function publicationBlockers() {
  return ["Verifier has not run.", "Human approval is not recorded.", "Publication and correction kill-state storage is not connected.", "Public card export is disabled."];
}
