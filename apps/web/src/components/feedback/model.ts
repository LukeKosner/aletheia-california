export const CATEGORIES = ["wrong_number", "wrong_person_org", "missing_context", "other"] as const;
export const CATEGORY_LABELS: Record<typeof CATEGORIES[number], string> = { wrong_number: "Wrong number", wrong_person_org: "Wrong person or organization", missing_context: "Missing context", other: "Other" };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FeedbackInput = {
    targetKind: "claim" | "investigation";
    targetId: string;
    choice: string;
    text: string;
};
export type CorrectionInput = {
    cardId: string;
    category: typeof CATEGORIES[number];
    detail: string;
    filingUrl: string;
};
export type ResolutionInput = {
    correctionId: string;
    action: "fixed" | "rejected";
    reason: string;
    claimId?: string;
    correctedSentence?: string;
    edgeIds?: string[];
    filingIds?: string[];
};
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provide a valid report."); return value as Record<string, unknown>; }
function text(value: unknown, max: number, required = true): string { if (typeof value !== "string" || value.trim().length > max || (required && !value.trim()))
    throw new Error("Complete the required fields within the displayed limits."); return value.trim(); }
function id(value: unknown): string { const result = text(value, 36); if (!UUID.test(result))
    throw new Error("A saved record is required. Recorded previews cannot receive stored reports."); return result; }
export function parseFeedback(value: unknown): FeedbackInput {
    const data = object(value);
    const targetKind = data.targetKind;
    if (targetKind !== "claim" && targetKind !== "investigation")
        throw new Error("Choose a saved statement or investigation.");
    const choice = text(data.choice, 40);
    if (!(targetKind === "claim" ? CATEGORIES.includes(choice as typeof CATEGORIES[number]) : ["yes", "no"].includes(choice)))
        throw new Error("Choose a feedback option.");
    return { targetKind, targetId: id(data.targetId), choice, text: text(data.text, 4000) };
}
export function parseCorrection(value: unknown): CorrectionInput {
    const data = object(value);
    const category = text(data.category, 40) as typeof CATEGORIES[number];
    if (!CATEGORIES.includes(category))
        throw new Error("Choose a correction category.");
    const filingUrl = text(data.filingUrl, 2000);
    let url: URL;
    try {
        url = new URL(filingUrl);
    }
    catch {
        throw new Error("Include the original public filing URL.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Include an HTTP or HTTPS public filing URL.");
    return { cardId: id(data.cardId), category, detail: text(data.detail, 4000), filingUrl: url.href };
}
function ids(value: unknown, required: boolean): string[] { if (!Array.isArray(value) || value.length > 100 || (required && !value.length))
    throw new Error("Supply up to 100 supporting evidence identifiers."); return [...new Set(value.map(id))]; }
export function parseResolution(value: unknown): ResolutionInput {
    const data = object(value);
    const action = data.action;
    if (action !== "fixed" && action !== "rejected")
        throw new Error("Choose Fix or Reject.");
    return { correctionId: id(data.correctionId), action, reason: text(data.reason, 4000), ...(action === "fixed" ? { claimId: id(data.claimId), correctedSentence: text(data.correctedSentence, 4000), edgeIds: ids(data.edgeIds, false), filingIds: ids(data.filingIds, true) } : {}) };
}
export function parseUnpublish(value: unknown) { const data = object(value); return { cardId: id(data.cardId), reason: text(data.reason, 4000) }; }
