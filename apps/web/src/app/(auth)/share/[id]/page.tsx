import { Suspense } from "react";
import { redirect } from "next/navigation";
import { resolvePublishedReceipt } from "@/lib/published-receipt";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import { shareText, SHARE_PLATFORMS } from "@/lib/share";
import { openShare } from "./actions";

async function Share({ params }: PageProps<"/share/[id]">) {
  const [identity, { id }] = await Promise.all([currentVerifiedIdentity(), params]);
  if (!identity) redirect("/sign-in");
  const card = await resolvePublishedReceipt(id).catch(() => null);
  if (!card) return <main className="mx-auto max-w-lg p-8"><h1 className="font-heading text-3xl">Sharing is unavailable</h1><p className="mt-4 text-muted-foreground">This receipt is not ready to share. Only approved, verified receipts can be shared.</p></main>;
  const text = shareText(card.finding, card.shortlink);
  const names = { x: "X", linkedin: "LinkedIn", bluesky: "Bluesky", threads: "Threads" };
  return <main className="mx-auto w-full max-w-xl p-6 py-16">
    <h1 className="font-heading text-3xl">Share the receipts</h1>
    <p className="mt-4 text-muted-foreground">Review this draft before posting. You choose whether to publish it. Sharing does not earn points.</p>
    <label htmlFor="share-text" className="mt-6 block font-medium">Prepared text ({text.length}/279)</label>
    <textarea id="share-text" readOnly value={text} rows={6} className="mt-2 w-full rounded-md border border-border bg-background p-3" />
    <p className="mt-2 text-sm text-muted-foreground">LinkedIn accepts the receipt link. Copy the prepared text above into its composer.</p>
    <div className="mt-6 flex flex-wrap gap-3">{SHARE_PLATFORMS.map((platform) => <form key={platform} action={openShare.bind(null, card.id, platform)}><button type="submit" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Open {names[platform]} draft</button></form>)}</div>
    <p className="mt-6 text-sm text-muted-foreground">Receipts remain private while the site’s public flags are off.</p>
  </main>;
}
export default function Page(props: PageProps<"/share/[id]">) {
  return <Suspense fallback={<p className="p-8" role="status">Preparing receipt…</p>}><Share {...props} /></Suspense>;
}
