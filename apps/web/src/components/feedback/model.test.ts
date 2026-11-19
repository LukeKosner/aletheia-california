import { describe, expect, test } from "bun:test";
import slice from "../../../../../packages/tools/test/fixtures/calaccess_slice.json";
import { parseCorrection, parseFeedback, parseResolution, parseUnpublish } from "./model";
// UUIDs below test identifier syntax only, never represent persisted cards/claims.
// Real public evidence: CAL-ACCESS filing 3214397, F497P1 line 1,
// https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=3214397&amendid=0
const edge = slice.edges.find((item) => item.id === "e24a8221-3de7-3547-b3cc-42f0da6c5953")!;
const filing = slice.filings.find((item) => item.filing_id === edge.filing_id)!;
const sentence = "The reported contribution was $3,910,600.00.";
const sourceReport = { cardId: edge.id, category: "wrong_number", detail: sentence, filingUrl: filing.url };
describe("feedback and corrections reject incomplete or unsafe submissions", () => {
    test("requires a saved UUID and a written explanation", () => {
        expect(() => parseFeedback({ targetKind: "claim", targetId: "recorded-calaccess-3214397", choice: "other", text: sentence })).toThrow();
        expect(() => parseFeedback({ targetKind: "claim", targetId: edge.id, choice: "other", text: " " })).toThrow();
        expect(() => parseFeedback({ targetKind: "investigation", targetId: edge.id, choice: "wrong_number", text: sentence })).toThrow();
        expect(parseFeedback({ targetKind: "claim", targetId: edge.id, choice: "wrong_number", text: sentence }).targetKind).toBe("claim");
    });
    test("only accepts public HTTP evidence URLs", () => {
        expect(parseCorrection(sourceReport).filingUrl).toBe(filing.url!);
        expect(() => parseCorrection({ ...sourceReport, filingUrl: "javascript:alert(1)" })).toThrow();
        expect(() => parseCorrection({ ...sourceReport, category: "" })).toThrow();
        expect(() => parseCorrection({ ...sourceReport, detail: sentence.repeat(300) })).toThrow();
    });
    test("fix requires specific revised statement and complete supporting evidence IDs", () => {
        const base = { correctionId: edge.id, action: "fixed", reason: sentence };
        expect(() => parseResolution(base)).toThrow();
        expect(() => parseResolution({ ...base, claimId: edge.id, correctedSentence: sentence, edgeIds: [], filingIds: [] })).toThrow();
        const result = parseResolution({ ...base, claimId: edge.id, correctedSentence: sentence, edgeIds: [edge.id], filingIds: [filing.id] });
        expect(result.filingIds).toEqual([filing.id]);
    });
    test("reject requires a reason but accepts no edit payload", () => {
        expect(() => parseResolution({ correctionId: edge.id, action: "rejected", reason: " " })).toThrow();
        expect(parseResolution({ correctionId: edge.id, action: "rejected", reason: sentence, correctedSentence: "ignored" }).correctedSentence).toBeUndefined();
    });
    test("unpublish rejects missing record or written reason", () => {
        expect(() => parseUnpublish({ cardId: edge.id, reason: "" })).toThrow();
        expect(() => parseUnpublish({ cardId: "recorded-calaccess-3214397", reason: sentence })).toThrow();
        expect(parseUnpublish({ cardId: edge.id, reason: sentence }).cardId).toBe(edge.id);
    });
});
