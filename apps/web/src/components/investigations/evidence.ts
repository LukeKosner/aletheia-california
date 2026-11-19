import type { getFiling } from "@aletheia/tools";
import type { FilingSource as ApiFilingSource } from "@/app/api/investigations/contract";
import type { Investigation } from "./model";
import { describeFiling, displayName } from "./filing-label";

export type ApiResult = {
  investigation_id: string; status: string; question?: string;
  answer: Investigation["answer"] | null;
  claims: { claim_id: string; filing_ids: string[]; edge_ids: string[]; sources?: ApiFilingSource[] }[];
  verification_status: string;
};
type FilingTransport = { results: { id: string; result: Awaited<ReturnType<typeof getFiling>> }[] };

export function fromApi(result: ApiResult, question: string): Investigation | null {
  if (!result.answer) return null;
  const claims = new Map((result.claims ?? []).map((claim) => [claim.claim_id, claim]));
  // The server already describes each filing (kind, filer, period), so the first paint is readable.
  const sources = (result.claims ?? []).flatMap((claim) => claim.sources ?? []).filter((source) => source.url !== null)
    .map(({ filing_id, url, ...rest }) => [filing_id, { id: filing_id, url: url!, ...rest }] as const);
  return {
    investigation_id: result.investigation_id, question: result.question ?? question,
    answer: { ...result.answer, sections: result.answer.sections.map((section) => ({ ...section, sentences: section.sentences.map((sentence) => ({ ...sentence, source_ids: sentence.claim_id ? claims.get(sentence.claim_id)?.filing_ids : [] })) })) },
    sources: [...new Map(sources).values()], verification: { status: result.verification_status },
  };
}

/** Enrich only with filing lines cited by the API's real claim rows. */
export async function hydrateEvidence(investigation: Investigation, result: ApiResult, signal: AbortSignal): Promise<Investigation> {
  const ids = [...new Set((result.claims ?? []).flatMap((claim) => claim.filing_ids))];
  if (!ids.length) return investigation;
  const edgeIds = new Set((result.claims ?? []).flatMap((claim) => claim.edge_ids));
  const batches = Array.from({ length: Math.min(5, Math.ceil(ids.length / 20)) }, (_, i) => ids.slice(i * 20, i * 20 + 20));
  const responses = await Promise.all(batches.map(async (batch) => {
    const params = new URLSearchParams(batch.map((id) => ["filing_id", id]));
    const response = await fetch(`/api/evidence?${params}`, { signal });
    if (!response.ok) throw new Error("Filing evidence could not be loaded.");
    return await response.json() as FilingTransport;
  }));
  const sources = new Map(investigation.sources.map((source) => [source.id, source]));
  const nodes = new Map<string, NonNullable<Investigation["graph"]>["nodes"][number]>();
  const edges = new Map<string, NonNullable<Investigation["graph"]>["edges"][number]>();
  for (const { id, result: filing } of responses.flatMap((response) => response.results)) {
    const metadata = filing.filings[0];
    if (metadata?.url) sources.set(id, {
      id, title: `${metadata.source ?? "Public"} filing ${metadata.filing_id ?? id}`, url: metadata.url,
      detail: `${metadata.form ?? "Filing"}${metadata.filed_at ? ` · filed ${metadata.filed_at}` : ""}${filing.truncated ? " · partial item list" : ""}`,
      ...describeFiling(metadata, filing.items, filing.lobby_parties), partial: filing.truncated,
    });
    for (const item of filing.items) {
      if (!edgeIds.has(item.edge_id) || !metadata?.url) continue;
      const source = `donor:${item.from_entity_id}`;
      const target = `recipient:${item.to_entity_id}`;
      nodes.set(source, { id: source, name: displayName(item.from_name?.untrusted_text ?? "Unnamed filer"), side: "donor" });
      nodes.set(target, { id: target, name: displayName(item.to_name?.untrusted_text ?? "Unnamed recipient"), side: "recipient" });
      edges.set(item.edge_id, { id: item.edge_id, source, target, amount: item.amount, source_id: id });
    }
  }
  return { ...investigation, sources: [...sources.values()], ...(ids.length > 100 || edgeIds.size > edges.size ? { evidence_note: "Some cited filing lines could not be loaded, so the money map is partial." } : {}), ...(edges.size ? { graph: { nodes: [...nodes.values()], edges: [...edges.values()] } } : {}) };
}
