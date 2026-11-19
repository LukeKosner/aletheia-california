import type { PublicResolution } from "@aletheia/tools";
// React renders all resolution text as text, never HTML. Reporter text is excluded.
export function CorrectionChangelog({ entries }: {
    entries: (PublicResolution & {
        id: string;
        status: "fixed" | "rejected";
    })[];
}) {
    return <section aria-labelledby="correction-history" className="space-y-4"><h2 id="correction-history" className="font-heading text-2xl">Correction changelog</h2>{entries.length ? <ol className="space-y-4">{entries.map((entry) => <li key={entry.id} className="rounded border border-border p-4"><p className="font-mono text-xs">{entry.status === "fixed" ? "Correction resolved · revised text awaits verification" : "Request declined"} · <time dateTime={entry.resolvedAt}>{entry.resolvedAt}</time></p><p className="mt-2 whitespace-pre-wrap break-words">{entry.reason}</p>{entry.correctedSentence ? <p className="mt-2 break-words text-sm text-muted-foreground">Revised statement: {entry.correctedSentence}</p> : null}</li>)}</ol> : <p className="text-sm text-muted-foreground">No published resolutions are recorded for this card.</p>}</section>;
}
