import type { Metadata } from "next";
import { Suspense } from "react";
import { getGameSummary } from "@aletheia/tools";
import { readFlags } from "@/lib/flags";
import { campusLabels } from "@/lib/auth-policy";
import { RefreshGame } from "./refresh";

export const metadata: Metadata = { title: "Campus game — Aletheia", robots: { index: false, follow: false } };
async function Counts() {
  const flags = readFlags();
  if (!flags.CAMPUS_GAME) return <p className="mt-6 text-muted-foreground">The campus game is off during private preview.</p>;
  const rows = await getGameSummary().catch(() => null);
  if (!rows) return <><RefreshGame /><p className="mt-6 text-muted-foreground" role="status">Campus counts are unavailable. No activity total has been inferred. This page checks again each minute.</p></>;
  const labels = { ...campusLabels(flags.CAMPUS_LABELS), unassigned: "No campus selected" };
  return <><RefreshGame /><table className="mt-8 w-full border-collapse text-left"><caption className="mb-3 text-left text-sm text-muted-foreground">Recorded activity · refreshes each minute</caption><thead><tr className="border-b border-border"><th scope="col" className="p-3">Campus</th><th scope="col" className="p-3">Verified investigations</th><th scope="col" className="p-3">Card views</th></tr></thead><tbody>{rows.map((row) => <tr className="border-b border-border" key={row.campus}><th scope="row" className="p-3 font-medium">{labels[row.campus]}</th><td className="p-3 font-mono">{row.verifiedInvestigations.toLocaleString("en-US")}</td><td className="p-3 font-mono">{row.cardViews.toLocaleString("en-US")}</td></tr>)}</tbody></table><p className="mt-4 text-sm text-muted-foreground">Verification counts unique investigations with final supported claims. Views count recorded page views, not unique people. Campus is optional and self-selected.</p></>;
}
export default function Page() {
  return <main className="mx-auto w-full max-w-3xl p-6 py-16"><h1 className="font-heading text-4xl">Campus game</h1><p className="mt-4 text-muted-foreground">Follow verified investigations and receipt views by campus. Social posting and shares earn no points.</p><Suspense fallback={<p className="mt-6" role="status">Loading recorded activity…</p>}><Counts /></Suspense></main>;
}
