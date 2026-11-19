import { describe, expect, test } from "bun:test";
import { recordedInvestigation } from "@/components/investigations/recorded";
import { verifiedEventReady, type FinalVerification } from "./event-policy";
import fixture from "../../../../packages/tools/test/fixtures/calaccess_slice.json";
import type { GameActivity } from "@aletheia/tools";

// Structural security contract only: random IDs/model sentinel do not represent
// real verifier runs or claim rows. Sentence is real filing 3214397, F497P1 line 1.
const investigationId = crypto.randomUUID();
const claimId = crypto.randomUUID();
const sentence = recordedInvestigation.answer.sections[0].sentences[0].text;
const edgeIds = recordedInvestigation.graph!.edges.map((edge) => edge.id);
const filingIds = fixture.filings.filter((filing) => filing.filing_id === "3214397").map((filing) => filing.id);
const result: FinalVerification = { investigation_id: investigationId, status: "completed", verification_status: "verified", claims: [{ claim_id: claimId, text: sentence, verdict: "supported", verifier_model: "unit-test-sentinel", edge_ids: edgeIds, filing_ids: filingIds, confidence: null }] };
const stored: GameActivity = { investigationId, status: "completed", userId: null, claims: [{ id: claimId, sentence, verdict: "supported", verifierModel: "unit-test-sentinel", edgeIds, filingIds, confidence: null }] };
describe("truthful verified event boundary", () => {
  test("requires final result and exact persisted supported claim binding", () => {
    expect(verifiedEventReady(result, stored)).toBe(true);
    expect(verifiedEventReady(result, null)).toBe(false);
    for (const verification_status of ["pending", "partial", "failed", "not_run"]) expect(verifiedEventReady({ ...result, verification_status }, stored)).toBe(false);
    expect(verifiedEventReady({ ...result, status: "running" }, stored)).toBe(false);
    expect(verifiedEventReady(result, { ...stored, status: "unpublished" })).toBe(false);
    expect(verifiedEventReady({ ...result, claims: [] }, stored)).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [] })).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [{ ...stored.claims[0], sentence: "" }] })).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [{ ...stored.claims[0], verifierModel: null }] })).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [{ ...stored.claims[0], verdict: "unsupported" }] })).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [{ ...stored.claims[0], edgeIds: [] }] })).toBe(false);
    expect(verifiedEventReady(result, { ...stored, claims: [{ ...stored.claims[0], filingIds: [] }] })).toBe(false);
    expect(verifiedEventReady({ ...result, claims: [...result.claims, ...result.claims] }, { ...stored, claims: [...stored.claims, ...stored.claims] })).toBe(false);
  });
});
