import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { MeasureList } from "@/components/gov/measure-list";
import { Empty, Page, PageTitle, Skeleton } from "@/components/gov/ui";
import { currentElection, measuresOverview } from "@/lib/gov";

export const metadata: Metadata = { title: "Ballot measures — Aletheia" };

async function List() {
  await connection(); // Too slow to prerender; streams at request time, then stays cached.
  const year = await currentElection();
  const measures = await measuresOverview(year).catch(() => null);
  if (!measures) return <><PageTitle title="Ballot measures" /><Empty>Campaign records are unavailable right now. Try again shortly.</Empty></>;
  if (!measures.length) return <><PageTitle title="Ballot measures" /><Empty>No measure committees have reported money for {year} yet.</Empty></>;
  return (
    <>
      <PageTitle title={`${year} ballot measures`}>Who is paying for each side.</PageTitle>
      <MeasureList measures={measures} />
      <p className="text-xs text-muted-foreground">Money raised by committees named “Yes on N” or “No on N”, {year - 1}–{year}. The same contributor, date and amount is counted once per side.</p>
    </>
  );
}

export default function Route() {
  return (
    <Page>
      <Suspense fallback={<Skeleton rows={10} />}><List /></Suspense>
    </Page>
  );
}
