"use client";
import { useState, type FormEvent } from "react";
import type { CorrectionRecord } from "@aletheia/tools";
const field = "mt-1 block w-full rounded border border-input bg-background px-3 py-2 text-foreground focus-visible:ring-2 focus-visible:ring-ring";
const button = "rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring";
async function command(endpoint: string, input: unknown) { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const result = await response.json(); if (!response.ok)
    throw new Error(result.error ?? "The change could not be saved."); return result; }
function RequestText({ value }: {
    value: string;
}) {
    let request: Record<string, unknown> | null = null;
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            request = parsed;
    }
    catch { /* Legacy plain text request. */ }
    return request ? <div className="space-y-2"><p>{String(request.category ?? "")}</p><p className="whitespace-pre-wrap break-words">{String(request.detail ?? "")}</p><p className="break-all text-sm">Source supplied: {String(request.filingUrl ?? "")}</p></div> : <p className="whitespace-pre-wrap break-words">{value}</p>;
}
function Review({ item }: {
    item: CorrectionRecord;
}) {
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    const [resolved, setResolved] = useState(item.status !== "open");
    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
        setPending(true);
        setMessage("");
        const ids = (name: string) => String(data.get(name) ?? "").split(",").map((id) => id.trim()).filter(Boolean);
        try {
            const result = await command("/api/admin/corrections", { correctionId: item.id, action, reason: data.get("reason"), claimId: data.get("claimId"), correctedSentence: data.get("correctedSentence"), edgeIds: ids("edgeIds"), filingIds: ids("filingIds") });
            setResolved(true);
            setMessage(result.status === "fixed" ? "Correction resolved. Revised text and every receipt card remain unpublished pending verification." : "Request declined with a written reason.");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Review could not be saved.");
        }
        finally {
            setPending(false);
        }
    }
    return <article className="space-y-4 rounded border border-border p-5"><p className="font-mono text-xs">{item.status} · {item.created_at}</p><p className="break-all text-xs text-muted-foreground">Request {item.id} · Card {item.card_id}</p><RequestText value={item.request}/>{!resolved ? <form onSubmit={send} className="space-y-4"><label className="block text-sm">Written reason (published in changelog; exclude private details)<textarea name="reason" required maxLength={4000} rows={3} className={field}/></label><details><summary className="cursor-pointer text-primary underline">Fix the saved statement</summary><div className="mt-4 space-y-4"><p className="text-sm">Fixing clears prior verification and withdraws the report and every receipt card. Supply the complete evidence set for the revised sentence.</p><label className="block text-sm">Saved claim identifier<input name="claimId" maxLength={36} className={field}/></label><label className="block text-sm">Revised sentence<textarea name="correctedSentence" maxLength={4000} rows={3} className={field}/></label><label className="block text-sm">Supporting filing UUIDs (comma separated; required to fix)<input name="filingIds" className={field}/></label><label className="block text-sm">Supporting money-edge UUIDs (comma separated, if applicable)<input name="edgeIds" className={field}/></label><button className={button} type="submit" name="action" value="fixed" disabled={pending}>Save fix and unpublish report</button></div></details><button className={button} type="submit" name="action" value="rejected" disabled={pending}>Reject request with reason</button></form> : <p className="text-sm text-muted-foreground">This request is resolved. It cannot be resolved a second time.</p>}<p role="status" aria-live="polite">{message}</p></article>;
}
export function ReviewQueue({ items }: {
    items: CorrectionRecord[];
}) { return <section className="space-y-5"><h2 className="font-heading text-2xl">Latest correction requests</h2><p className="text-sm text-muted-foreground">Up to 100 requests, newest first. Request text is private; written resolutions are published.</p>{items.length ? items.map((item) => <Review key={item.id} item={item}/>) : <p>No correction requests are recorded.</p>}</section>; }
export function UnpublishForm() {
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    async function send(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setPending(true); setMessage(""); try {
        await command("/api/admin/publication", { cardId: data.get("cardId"), reason: data.get("reason") });
        setMessage("Report and all of its receipt cards unpublished. Existing links must show an unpublished notice.");
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Publication could not be changed.");
    }
    finally {
        setPending(false);
    } }
    return <form onSubmit={send} className="space-y-4 rounded border border-border bg-muted p-5"><h2 className="font-heading text-2xl">Unpublish a report</h2><p className="text-sm">Withdraw the report and every associated receipt card. This action does not delete the record or republish anything.</p><label className="block text-sm">Saved card identifier<input name="cardId" required maxLength={36} className={field}/></label><label className="block text-sm">Reason<textarea name="reason" required maxLength={4000} rows={3} className={field}/></label><button disabled={pending} className={button} type="submit">{pending ? "Unpublishing…" : "Unpublish report and all cards"}</button><p role="status" aria-live="polite">{message}</p></form>;
}
