import { Suspense } from "react";
import { correctionReader, listCorrections } from "@aletheia/tools";
import { currentAdminIdentity, isAdmin } from "@/app/api/admin/auth";
import { ReviewQueue, UnpublishForm } from "./review-queue";
async function Queue() {
    // Check again at the data boundary; layouts are not an authorization boundary.
    if (!isAdmin(await currentAdminIdentity()))
        return null;
    let reader;
    let items = null;
    try {
        reader = correctionReader();
        items = await listCorrections(reader);
    }
    catch { /* Render explicit unavailable state below. */ }
    finally {
        await reader?.end();
    }
    return items ? <ReviewQueue items={items}/> : <p role="status">The saved correction queue is unavailable. No empty queue or successful change is inferred.</p>;
}
export default function Page() { return <main className="mx-auto max-w-4xl space-y-8 px-4 py-12"><h1 className="font-heading text-3xl">Corrections and publication</h1><UnpublishForm /><Suspense fallback={<p role="status">Loading correction requests…</p>}><Queue /></Suspense></main>; }
