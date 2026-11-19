/** Product-only, read-only correction surface. Never registered as an agent MCP tool.
 * Requires separately provisioned SELECT-only corrections_reader credentials.
 * No fallback to DATABASE_URL, agent_ro, or the claim writer. */
import postgres from "postgres";
export type CorrectionReader = ReturnType<typeof postgres>;
export type CorrectionRecord = {
    id: string;
    card_id: string;
    request: string;
    status: "open" | "fixed" | "rejected";
    resolution: string | null;
    created_at: string;
};
export type PublicationState = {
    state: "published" | "unpublished" | "missing";
};
export type PublicResolution = {
    reason: string;
    resolvedAt: string;
    correctedSentence?: string;
};
export function correctionReader(env: Record<string, string | undefined> = process.env): CorrectionReader {
    const url = env.CORRECTIONS_READER_DATABASE_URL;
    if (!url || decodeURIComponent(new URL(url).username) !== "corrections_reader")
        throw new Error("Correction reader unavailable");
    return postgres(url, { max: 2, connect_timeout: 5, idle_timeout: 10, prepare: false, connection: { application_name: "aletheia-corrections-reader", default_transaction_read_only: true, statement_timeout: 10000 } });
}
export async function getPublicationState(reader: CorrectionReader, target: {
    cardId: string;
} | {
    investigationId: string;
}): Promise<PublicationState> {
    return reader.begin("read only", async (tx) => {
        const rows = "cardId" in target
            ? await tx<{
                published: boolean;
                status: string;
                withdrawn: boolean;
            }[]> `select c.published, i.status, exists(select 1 from event e where e.name in ('report_unpublished', 'correction_fixed') and e.props->>'investigationId' = i.id::text) as withdrawn from card c join investigation i on i.id = c.investigation_id where c.id = ${target.cardId}::uuid`
            : await tx<{
                published: boolean;
                status: string;
                withdrawn: boolean;
            }[]> `select bool_and(c.published) as published, i.status, exists(select 1 from event e where e.name in ('report_unpublished', 'correction_fixed') and e.props->>'investigationId' = i.id::text) as withdrawn from investigation i left join card c on c.investigation_id = i.id where i.id = ${target.investigationId}::uuid group by i.id`;
        if (!rows.length)
            return { state: "missing" };
        return { state: rows[0].published === true && rows[0].status !== "unpublished" && !rows[0].withdrawn ? "published" : "unpublished" };
    }) as Promise<PublicationState>;
}
export async function listCorrections(reader: CorrectionReader): Promise<CorrectionRecord[]> {
    return reader.begin("read only", async (tx) => [...await tx<CorrectionRecord[]> `select id, card_id, request, status, resolution, created_at::text from correction order by created_at desc, id limit 100`]) as Promise<CorrectionRecord[]>;
}
export function publicResolution(value: string | null): PublicResolution | null {
    try {
        const parsed = JSON.parse(value ?? "");
        if (typeof parsed.reason !== "string" || !parsed.reason.trim() || typeof parsed.resolvedAt !== "string")
            return null;
        return { reason: parsed.reason, resolvedAt: parsed.resolvedAt, ...(typeof parsed.correctedSentence === "string" ? { correctedSentence: parsed.correctedSentence } : {}) };
    }
    catch {
        return null;
    }
}
/** Never return request text, requester identity, or administrator identity publicly. */
export async function getCorrectionChangelog(reader: CorrectionReader, cardId: string) {
    return reader.begin("read only", async (tx) => {
        const rows = await tx<{
            id: string;
            status: "fixed" | "rejected";
            resolution: string | null;
        }[]> `select id, status, resolution from correction where card_id = ${cardId}::uuid and status in ('fixed', 'rejected') order by created_at desc, id limit 100`;
        return rows.flatMap((row) => { const resolution = publicResolution(row.resolution); return resolution ? [{ id: row.id, status: row.status, ...resolution }] : []; });
    });
}
/** Validate every supplied evidence identifier on the product-only read surface. */
export async function validateCorrectionEvidence(reader: CorrectionReader, edgeIds: string[], filingIds: string[]): Promise<boolean> {
    if (!filingIds.length)
        return false;
    return reader.begin("read only", async (tx) => {
        const filings = await tx<{
            id: string;
        }[]> `select id from filing where id = any(${filingIds}::uuid[]) and url is not null`;
        if (filings.length !== new Set(filingIds).size)
            return false;
        const edges = await tx<{
            id: string;
        }[]> `select id from money_edge where id = any(${edgeIds}::uuid[]) and filing_id = any(${filingIds}::uuid[])`;
        return edges.length === new Set(edgeIds).size;
    }) as Promise<boolean>;
}
/** A private report may be viewable before any card exists. This is not approval
 * for public sharing; public receipts must use getPublicationState instead. */
export async function getReportAvailability(reader: CorrectionReader, investigationId: string): Promise<"available" | "unpublished" | "missing"> {
    return reader.begin("read only", async (tx) => {
        const rows = await tx<{
            status: string;
            withdrawn: boolean;
        }[]> `select i.status, exists(select 1 from event e where e.name in ('report_unpublished', 'correction_fixed') and e.props->>'investigationId' = i.id::text) as withdrawn from investigation i where i.id = ${investigationId}::uuid`;
        return !rows.length ? "missing" : rows[0].status === "unpublished" || rows[0].withdrawn ? "unpublished" : "available";
    }) as Promise<"available" | "unpublished" | "missing">;
}
