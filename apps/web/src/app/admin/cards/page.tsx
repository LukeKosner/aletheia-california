import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Queue, QueueList, QueueItem, QueueItemContent, QueueItemDescription, QueueItemIndicator } from "@/components/ai-elements/queue";
import { hasCardTeamSession } from "@/app/api/card/access";
import { isStaff } from "@/lib/interview/staff";
import { CARD_TYPES, PREVIEW_ID, publicationBlockers, recordedCard } from "@/app/api/card/model";

async function Content() {
  if (!await hasCardTeamSession()) redirect("/sign-in?next=/admin/cards");
  // Layouts are not an authorization boundary; check administrator access on the page itself.
  if (!await isStaff()) redirect("/admin");
  const card = recordedCard();
  return <main className="mx-auto w-full max-w-4xl space-y-7 px-5 py-12"><header className="space-y-3"><p className="font-mono text-sm text-muted-foreground">Team review</p><h1 className="font-heading text-4xl">Receipt cards</h1><p>Recorded preview awaiting verification. Approval storage, reviewer identity and role enforcement must be connected before a human can approve or publish.</p></header>
    <Queue><QueueList><QueueItem><QueueItemIndicator /><QueueItemContent>{CARD_TYPES[card.type]} · {card.finding}</QueueItemContent><QueueItemDescription>Unverified · unpublished · no stored queue item</QueueItemDescription></QueueItem></QueueList></Queue>
    <Link className="inline-block underline underline-offset-4" href={`/r/${PREVIEW_ID}`}>Inspect the filing receipt and image previews</Link>
    <ul className="list-disc space-y-2 pl-5">{publicationBlockers().map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <div className="flex gap-3"><button disabled className="rounded-md border border-border px-4 py-2 text-muted-foreground">Approve</button><button disabled className="rounded-md border border-border px-4 py-2 text-muted-foreground">Publish</button></div>
    <section className="space-y-2"><h2 className="text-xl font-semibold">Card formats</h2><p>{Object.values(CARD_TYPES).join(" · ")}</p><p className="text-sm text-muted-foreground">Only Organization footprint has a recorded source here. Other formats need real supported receipts. No comparison across sides is generated without corresponding evidence. Individual donors may appear only in employer or industry aggregates.</p></section>
  </main>;
}

export default function CardsQueue() { return <Suspense fallback={<p className="p-8" role="status">Loading review queue…</p>}><Content /></Suspense>; }
