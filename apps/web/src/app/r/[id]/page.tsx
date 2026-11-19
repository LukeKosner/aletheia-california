import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasCardTeamSession } from "@/app/api/card/access";
import { CARD_TYPES, DISCLOSURE, formatMoney, numbers, PREVIEW_ID, publicationBlockers, recordedCard } from "@/app/api/card/model";

async function Content({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  if (!await hasCardTeamSession()) redirect(`/sign-in?next=${encodeURIComponent(`/r/${id}`)}`);
  if (id !== PREVIEW_ID) notFound();
  const card = recordedCard();
  return <main className="mx-auto w-full max-w-4xl space-y-8 px-5 py-12">
    <header className="space-y-3"><p className="font-mono text-sm text-muted-foreground">{CARD_TYPES[card.type]} / recorded preview</p><h1 className="font-heading text-4xl">The receipt behind the card</h1><p className="rounded-lg border border-border bg-muted p-4">Unverified · team only · unpublished. This is a recorded filing example, not a completed investigation or persisted card.</p><p className="text-2xl">{card.finding}</p></header>
    <section aria-labelledby="numbers" className="space-y-3"><h2 id="numbers" className="text-xl font-semibold">Every displayed number</h2>{numbers(card).map((number) => <div key={number.label} className="rounded-lg border border-border bg-paper p-5 text-paper-foreground"><p className="text-3xl">{formatMoney(number.cents)}</p><p>{number.label}</p><p className="text-sm">Sum of the cited filing lines below; not a campaign total or a complete funding footprint.</p></div>)}</section>
    <section aria-labelledby="filings" className="space-y-4"><h2 id="filings" className="text-xl font-semibold">Filing lines and edges</h2>{card.lines.map((line) => <article key={line.edgeId} className="space-y-2 rounded-lg border border-border p-5"><p>{line.from}</p><p className="text-muted-foreground">Contribution to</p><p className="font-semibold">{line.to}</p><p>{formatMoney(BigInt(line.amount.replace(".", "")))} · {line.date}</p><p>Category: {line.category}. Sum includes this edge once.</p><p className="break-all font-mono text-xs">Edge {line.edgeId}</p><a href={line.url} className="underline underline-offset-4" target="_blank" rel="noreferrer">CAL-ACCESS filing {line.filingId} · {line.schedule}, line {line.line}</a></article>)}</section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Method and review</h2><p>As of {card.asOf}, the date of the recorded bulk export. Method: {card.methodVersion}. No supported claim id, verifier verdict, or human approval has been recorded.</p><ul className="list-disc space-y-1 pl-5">{publicationBlockers().map((reason) => <li key={reason}>{reason}</li>)}</ul><p>No matched comparison is available from corresponding evidence.</p></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Corrections and changelog</h2><p>Correction history and publication kill-state are unavailable for this unpersisted preview. No empty history or approval is inferred.</p><Link href="/corrections" className="underline underline-offset-4">Prepare a correction report</Link></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Team image previews</h2><p>Final-card disclosure: “{DISCLOSURE}” This preview has not been verified and is labeled accordingly.</p><div className="flex flex-wrap gap-5">{["wide", "tall"].map((layout) => <a key={layout} className="underline underline-offset-4" href={`/api/card?id=${encodeURIComponent(id)}&preview=1&layout=${layout}`}>Open {layout} preview</a>)}</div><Link href="/admin/cards" className="inline-block underline underline-offset-4">Review queue</Link></section>
  </main>;
}

export default function ReceiptPage(props: PageProps<"/r/[id]">) { return <Suspense fallback={<p className="p-8" role="status">Loading receipt…</p>}><Content {...props} /></Suspense>; }
