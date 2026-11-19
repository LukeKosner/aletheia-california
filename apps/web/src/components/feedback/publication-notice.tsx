export function PublicationNotice({ state }: {
    state: "unpublished" | "unavailable" | "missing";
}) {
    return <div role="status" className="space-y-2 rounded-lg border border-border bg-muted p-5"><h2 className="font-heading text-xl">{state === "unpublished" ? "This report is unpublished" : state === "missing" ? "This report is unavailable" : "Publication status is unavailable"}</h2><p className="text-sm text-muted-foreground">{state === "unpublished" ? "The team has withdrawn this report and its receipt cards while it reviews the evidence. This link remains available as a notice." : "The report and its receipt cards cannot be shown until their current publication status is confirmed."}</p></div>;
}
