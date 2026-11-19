import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { Download, Empty, ExternalLink, Page, PageTitle, SearchBox, Section, Skeleton } from "@/components/gov/ui";
import { billUrl, committeeUrl, getAuthoredBills, getCommittees, getFunding, getLegislator, getVotes, measureLabel, money, type Legislator, type Vote } from "@/lib/gov";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/gov/print-button";

export async function generateMetadata({ params }: PageProps<"/legislators/[id]">): Promise<Metadata> {
  const legislator = await getLegislator((await params).id).catch(() => null);
  return { title: `${legislator?.name ?? "Legislator"} — Aletheia` };
}

const RESULT: Record<Vote["result"], { label: string; className: string }> = {
  aye: { label: "Yes", className: "bg-stamp/10 text-stamp" },
  no: { label: "No", className: "bg-muted text-foreground" },
  nvr: { label: "No vote", className: "text-muted-foreground" },
};

async function Funding({ legislator }: { legislator: Legislator }) {
  const [funding, committees] = await Promise.all([getFunding(legislator).catch(() => undefined), getCommittees(legislator).catch(() => [])]);
  const trace = committees[0];
  return (
    <Section title="Top contributors" note={<Download href={`/api/export?kind=legislator&id=${legislator.id}`} />}>
      {funding === undefined ? <Empty>Contribution records are unavailable right now.</Empty>
        : !funding || !funding.top.length ? <Empty>No contributions to their committees are on file.</Empty>
        : <>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted px-4 py-3"><dt className="text-xs text-muted-foreground">Raised</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(funding.total)}</dd></div>
              <div className="rounded-xl bg-muted px-4 py-3"><dt className="text-xs text-muted-foreground">Contributors</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{funding.donors.toLocaleString("en-US")}</dd></div>
            </dl>
            <ol className="divide-y divide-border rounded-xl border border-border">
              {funding.top.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.count} {item.count === 1 ? "contribution" : "contributions"} · latest {item.last}{item.url ? <> · <ExternalLink href={item.url}>filing</ExternalLink></> : null}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{money(item.total)}</span>
                </li>
              ))}
            </ol>
          </>}
      {committees.length ? (
        <p className="text-xs text-muted-foreground">
          Committees: {committees.map((item, i) => <span key={item.id}>{i ? ", " : ""}<ExternalLink href={committeeUrl(item.filerId)}>{item.name}</ExternalLink></span>)}
        </p>
      ) : null}
      {trace ? (
        <Link prefetch={false} href={`/i/new?${new URLSearchParams({ question: `Who funds ${legislator.name}'s campaign committee, and where does its money go?`, type: "footprint", target: trace.id })}`} className="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent print:hidden">
          <MessageSquareText aria-hidden className="size-4 text-stamp" /> Trace this money in detail
        </Link>
      ) : null}
    </Section>
  );
}

async function TopicFilter({ id, topic }: { id: string; topic: Promise<string> }) {
  return <SearchBox action={`/legislators/${id}`} name="topic" defaultValue={await topic} placeholder="Filter votes and bills by topic" />;
}

async function Votes({ legislator, topic }: { legislator: Legislator; topic: Promise<string> }) {
  const q = await topic;
  const votes = await getVotes(legislator, q).catch(() => null);
  return (
    <>
      {!votes ? <Empty>Vote records are unavailable right now.</Empty>
        : !votes.length ? <Empty>{q ? `No recorded votes on bills about “${q}”.` : "No recorded votes."}</Empty>
        : <ul className="divide-y divide-border rounded-xl border border-border">
            {votes.map((vote, i) => {
              const url = billUrl(vote.session, vote.measure);
              const result = RESULT[vote.result];
              return (
                <li key={`${vote.billId}-${vote.date}-${i}`} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm"><span className="mr-2 font-mono text-xs font-medium">{url ? <ExternalLink href={url}>{measureLabel(vote.measure)}</ExternalLink> : measureLabel(vote.measure)}</span>{vote.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{vote.date} · {vote.location}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", result.className)}>{result.label}</span>
                </li>
              );
            })}
          </ul>}
    </>
  );
}

async function Authored({ legislator, topic }: { legislator: Legislator; topic: Promise<string> }) {
  const q = await topic;
  const bills = await getAuthoredBills(legislator, q);
  if (bills === null) return null; // v_bill_authors is not available yet
  return (
    <Section title="Bills they wrote">
      {!bills.length ? <Empty>{q ? `No bills about “${q}”.` : "No authored bills on file."}</Empty> : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {bills.map((bill) => {
            const url = billUrl(bill.session, bill.measure);
            return (
              <li key={bill.id} className="flex items-start gap-4 px-4 py-3">
                <p className="min-w-0 flex-1 text-sm"><span className="mr-2 font-mono text-xs font-medium">{url ? <ExternalLink href={url}>{measureLabel(bill.measure)}</ExternalLink> : measureLabel(bill.measure)}</span>{bill.title}</p>
                <span className="shrink-0 text-xs text-muted-foreground">{bill.role === "lead" ? "Lead" : "Co-author"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

async function Profile({ params, searchParams }: PageProps<"/legislators/[id]">) {
  const legislator = await getLegislator((await params).id).catch(() => null);
  if (!legislator) notFound();
  const topic = searchParams.then((p) => (typeof p.topic === "string" ? p.topic.trim().slice(0, 80) : ""));
  return (
    <>
      <PageTitle title={legislator.name} back={{ href: "/legislators", label: "Legislators" }}>
        {legislator.house} District {legislator.district} · {legislator.party}{legislator.active ? "" : " · Former member"}
      </PageTitle>
      <div className="-mt-4"><PrintButton /></div>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Suspense fallback={<Skeleton rows={6} />}><Funding legislator={legislator} /></Suspense>
        <div className="flex flex-col gap-10">
          <Suspense fallback={<Skeleton rows={1} />}><TopicFilter id={legislator.id} topic={topic} /></Suspense>
          <Section title="Recent votes" note={<Download href={`/api/export?kind=legislator&part=votes&id=${legislator.id}`} />}>
            <Suspense fallback={<Skeleton rows={6} />}><Votes legislator={legislator} topic={topic} /></Suspense>
          </Section>
          <Suspense fallback={null}><Authored legislator={legislator} topic={topic} /></Suspense>
        </div>
      </div>
    </>
  );
}

export default function Route(props: PageProps<"/legislators/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton rows={2} />}><Profile {...props} /></Suspense>
    </Page>
  );
}
