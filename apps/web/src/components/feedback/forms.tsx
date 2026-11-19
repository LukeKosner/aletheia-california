"use client";
import { useState, type FormEvent } from "react";
import { CATEGORIES, CATEGORY_LABELS, UUID } from "./model";
const field = "mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus-visible:ring-2 focus-visible:ring-ring";
const button = "rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring";
async function submit(endpoint: string, data: unknown): Promise<string> {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error ?? "Your report could not be saved. Keep your text and retry.");
    return result.message ?? `Feedback saved. Receipt: ${result.id}`;
}
function Category() { return <label className="block text-sm">What needs review?<select name="category" className={field} required defaultValue=""><option value="" disabled>Choose a category</option>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>; }
/**
 * One "Report an error" per answer, under it. A reader can point at one recorded statement (stored as statement
 * feedback) or at the answer as a whole (stored as "not useful" answer feedback, with the category in the text).
 */
export function ErrorReport({ investigationId, statements }: {
    investigationId: string;
    statements: { claimId: string; text: string }[];
}) {
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    const saved = UUID.test(investigationId);
    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const claimId = String(data.get("statement") ?? "");
        const category = String(data.get("category") ?? "") as typeof CATEGORIES[number];
        const detail = String(data.get("detail") ?? "");
        setPending(true);
        setMessage("");
        try {
            setMessage(await submit("/api/feedback", UUID.test(claimId)
                ? { targetKind: "claim", targetId: claimId, choice: category, text: detail }
                : { targetKind: "investigation", targetId: investigationId, choice: "no", text: `${CATEGORY_LABELS[category] ?? "Error"}: ${detail}`.slice(0, 4000) }));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Feedback could not be saved.");
        }
        finally {
            setPending(false);
        }
    }
    return <details className="text-sm"><summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">Report an error</summary><form onSubmit={send} className="mt-3 space-y-4 rounded-xl border border-border p-4">{statements.length ? <label className="block text-sm">Which part?<select name="statement" className={field} defaultValue=""><option value="">The answer as a whole</option>{statements.map((statement) => <option key={statement.claimId} value={statement.claimId}>{statement.text.length > 90 ? `${statement.text.slice(0, 88)}…` : statement.text}</option>)}</select></label> : null}<Category /><label className="block text-sm">What should we review?<textarea required name="detail" maxLength={3900} rows={3} className={field}/></label><p className="text-xs text-muted-foreground">Include public evidence. Avoid sensitive personal information.</p>{saved ? <button disabled={pending} type="submit" className={button}>{pending ? "Saving…" : "Send report"}</button> : <p role="status" className="text-muted-foreground">This recorded preview has no saved answer. Reports cannot be submitted yet.</p>}<p role="status" aria-live="polite">{message}</p></form></details>;
}
export function InvestigationFeedback({ investigationId }: {
    investigationId: string;
}) {
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        try {
            setMessage(await submit("/api/feedback", { targetKind: "investigation", targetId: investigationId, choice: data.get("choice"), text: data.get("detail") }));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Feedback could not be saved.");
        }
        finally {
            setPending(false);
        }
    }
    return <details className="text-sm"><summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">Was this useful? Send feedback</summary><form onSubmit={send} className="mt-3 space-y-4 rounded-xl border border-border p-4"><fieldset><legend className="font-medium">Was this investigation useful?</legend><div className="mt-3 flex gap-6"><label className="flex items-center gap-2"><input type="radio" name="choice" value="yes" required/>Yes</label><label className="flex items-center gap-2"><input type="radio" name="choice" value="no" required/>No</label></div></fieldset><label className="block text-sm">Why?<textarea required name="detail" rows={3} maxLength={4000} className={field}/></label>{UUID.test(investigationId) ? <button className={button} type="submit" disabled={pending}>{pending ? "Saving…" : "Send feedback"}</button> : <p className="text-sm text-muted-foreground">This recorded preview has no saved investigation. Feedback cannot be submitted yet.</p>}<p role="status" aria-live="polite">{message}</p></form></details>;
}
export function CorrectionRequestForm({ cardId = "" }: {
    cardId?: string;
}) {
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        try {
            setMessage(await submit("/api/corrections", { cardId: data.get("cardId"), category: data.get("category"), detail: data.get("detail"), filingUrl: data.get("filingUrl") }));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Correction could not be saved.");
        }
        finally {
            setPending(false);
        }
    }
    return <form onSubmit={send} className="space-y-4"><label className="block text-sm">Saved card identifier<input name="cardId" required defaultValue={cardId} pattern={UUID.source.slice(1, -1)} maxLength={36} className={field}/></label><Category /><label className="block text-sm">Original public filing URL<input name="filingUrl" required type="url" maxLength={2000} className={field}/></label><label className="block text-sm">What needs correction, and what does the filing show?<textarea required name="detail" rows={5} maxLength={4000} className={field}/></label><p className="text-xs text-muted-foreground">Maximum 4,000 characters. Requests are private. A written resolution may appear in the card’s changelog; your request text is excluded.</p><button className={button} type="submit" disabled={pending}>{pending ? "Saving…" : "Request a correction"}</button><p role="status" aria-live="polite">{message}</p></form>;
}
