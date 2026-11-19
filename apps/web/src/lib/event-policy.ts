import type { GameActivity } from "@aletheia/tools";
/** Structural subset of P12 VerifiedInvestigation. Only a trusted host may pass it. */
export type FinalVerification = {
  investigation_id: string;
  status: string;
  verification_status: string;
  claims: { claim_id: string; text: string; verdict: string | null; verifier_model: string | null; edge_ids: string[]; filing_ids: string[]; confidence: string | null }[];
};
function sameIds(left: string[], right: string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}
export function verifiedEventReady(result: FinalVerification, stored: GameActivity | null): boolean {
  if (result.status !== "completed" || result.verification_status !== "verified" || !result.claims.length || !stored || stored.status !== "completed" || result.investigation_id !== stored.investigationId || result.claims.length !== stored.claims.length) return false;
  const ids = new Set(result.claims.map((claim) => claim.claim_id));
  if (ids.size !== result.claims.length) return false;
  return result.claims.every((claim) => {
    const persisted = stored.claims.find((row) => row.id === claim.claim_id);
    return claim.verdict === "supported" && !!claim.verifier_model?.trim() && !!persisted && persisted.verdict === "supported" && persisted.verifierModel === claim.verifier_model && persisted.sentence === claim.text && persisted.confidence === claim.confidence && sameIds(persisted.edgeIds, claim.edge_ids) && sameIds(persisted.filingIds, claim.filing_ids);
  });
}
