import { Suspense } from "react";
import { correctionReader, getCorrectionChangelog } from "@aletheia/tools";
import { DraftPage } from "@/components/investigations/draft-page";
import { CorrectionRequestForm } from "@/components/feedback/forms";
import { CorrectionChangelog } from "@/components/feedback/changelog";
import { UUID } from "@/components/feedback/model";
async function Content({ searchParams }: {
    searchParams: Promise<{
        card?: string;
    }>;
}) {
    const { card } = await searchParams;
    const cardId = card && UUID.test(card) ? card : "";
    let reader;
    let entries = null;
    if (cardId) {
        try {
            reader = correctionReader();
            entries = await getCorrectionChangelog(reader, cardId);
        }
        catch { /* Explicit unavailable notice below; never invent history. */ }
        finally {
            await reader?.end();
        }
    }
    return <><CorrectionRequestForm cardId={cardId}/>{entries ? <CorrectionChangelog entries={entries}/> : <p className="rounded border border-border bg-muted p-4 text-sm">{cardId ? "Correction history is unavailable. No saved or resolved request is inferred." : "Open this page from a saved receipt card to view its correction history. Recorded examples have no saved card."}</p>}</>;
}
export default function Page({ searchParams }: {
    searchParams: Promise<{
        card?: string;
    }>;
}) {
    return <DraftPage title="Request a correction"><p>Help the team review a specific statement. Include the saved card identifier, original public filing, and what needs correction. Avoid sensitive personal information.</p><p className="rounded border border-border bg-muted p-4 text-sm">You get a receipt once your request is saved. We review each request and post any change in the card’s history.</p><Suspense fallback={<p role="status">Loading correction form…</p>}><Content searchParams={searchParams}/></Suspense></DraftPage>;
}
