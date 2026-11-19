/** Server-owned commands only. No database operation is performed during builds,
 * tests, or agent work. A separately provisioned least-privilege role is required. */
import { createDb, card, claim, correction, event, feedback, investigation } from "@aletheia/db";
import { and, eq, sql } from "drizzle-orm";
import { correctionReader, validateCorrectionEvidence } from "@aletheia/tools";
import type { CorrectionInput, FeedbackInput, ResolutionInput } from "@/components/feedback/model";
import type { VerifiedIdentity } from "./auth";
let shared: ReturnType<typeof createDb> | undefined;
function writer() {
    const url = process.env.CORRECTIONS_WRITER_DATABASE_URL;
    if (!url || decodeURIComponent(new URL(url).username) !== "corrections_writer")
        throw new Error("Correction service unavailable");
    return shared ??= createDb(url);
}
export async function saveFeedback(input: FeedbackInput) {
    const db = writer();
    return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = 10000`);
        const target = input.targetKind === "claim" ? await tx.select({ id: claim.id }).from(claim).where(eq(claim.id, input.targetId)).limit(1) : await tx.select({ id: investigation.id }).from(investigation).where(eq(investigation.id, input.targetId)).limit(1);
        if (!target.length)
            throw new Error("Saved record unavailable");
        const [saved] = await tx.insert(feedback).values({ ...input, userId: null }).returning({ id: feedback.id });
        return saved;
    });
}
export async function saveCorrection(input: CorrectionInput) {
    return writer().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = 10000`);
        const [saved] = await tx.insert(correction).values({ cardId: input.cardId, request: JSON.stringify({ category: input.category, detail: input.detail, filingUrl: input.filingUrl }), status: "open" }).returning({ id: correction.id });
        return saved;
    });
}
export async function resolveCorrection(input: ResolutionInput, actor: VerifiedIdentity) {
    if (input.action === "fixed") {
        const reader = correctionReader();
        try {
            if (!await validateCorrectionEvidence(reader, input.edgeIds!, input.filingIds!))
                throw new Error("Supporting evidence unavailable");
        }
        finally {
            await reader.end();
        }
    }
    return writer().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = 10000`);
        // Lock the open request so two reviewers cannot both resolve it.
        const rows = await tx.select({ id: correction.id, cardId: correction.cardId, investigationId: card.investigationId }).from(correction).innerJoin(card, eq(card.id, correction.cardId)).where(and(eq(correction.id, input.correctionId), eq(correction.status, "open"))).for("update");
        const row = rows[0];
        if (!row)
            throw new Error("Open correction unavailable");
        if (input.action === "fixed") {
            const changed = await tx.update(claim).set({ sentence: input.correctedSentence!, edgeIds: input.edgeIds!, filingIds: input.filingIds!, verdict: null, verifierModel: null, confidence: null }).where(and(eq(claim.id, input.claimId!), eq(claim.investigationId, row.investigationId))).returning({ id: claim.id });
            if (!changed.length)
                throw new Error("Statement does not belong to this report");
            await tx.update(card).set({ published: false }).where(eq(card.investigationId, row.investigationId));
            await tx.update(investigation).set({ status: "unpublished" }).where(eq(investigation.id, row.investigationId));
        }
        const resolution = JSON.stringify({ reason: input.reason, resolvedAt: new Date().toISOString(), ...(input.action === "fixed" ? { correctedSentence: input.correctedSentence } : {}) });
        await tx.update(correction).set({ status: input.action, resolution }).where(eq(correction.id, row.id));
        await tx.insert(event).values({ name: `correction_${input.action}`, userId: actor.userId, props: { correctionId: row.id, cardId: row.cardId, investigationId: row.investigationId, reason: input.reason } });
        return { id: row.id, status: input.action, publication: input.action === "fixed" ? "unpublished" : "unchanged" };
    });
}
export async function unpublish(input: {
    cardId: string;
    reason: string;
}, actor: VerifiedIdentity) {
    return writer().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = 10000`);
        const rows = await tx.select({ investigationId: card.investigationId }).from(card).where(eq(card.id, input.cardId)).for("update");
        if (!rows.length)
            throw new Error("Saved card unavailable");
        const investigationId = rows[0].investigationId;
        await tx.update(investigation).set({ status: "unpublished" }).where(eq(investigation.id, investigationId));
        await tx.update(card).set({ published: false }).where(eq(card.investigationId, investigationId));
        await tx.insert(event).values({ name: "report_unpublished", userId: actor.userId, props: { cardId: input.cardId, investigationId, reason: input.reason } });
        return { state: "unpublished", investigationId };
    });
}
