import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Empty, ExternalLink, Page, PageTitle, SearchBox, Section, Skeleton } from "@/components/gov/ui";
import { billUrl, findMeasures, getLegislators, ISSUE_BILL_LIMIT, measureLabel, measureNumber, searchIssue, type Bill, type Legislator, type Supporter } from "@/lib/gov";

export const metadata: Metadata = { title: "Issues — Aletheia" };

const TOPICS = ["Prop 40", "Housing", "Wildfire", "Artificial intelligence", "Child care", "Insurance"];

function TopicChips() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TOPICS.map((topic) => <Link key={topic} href={`/search?q=${encodeURIComponent(topic)}`} className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:text-foreground">{topic}</Link>)}
    </div>
  );
}

type Ranked = Supporter & { member: Legislator; voted: number };

/** Current members only, with enough related votes that a share means something. */
function rank(rows: Supporter[], members: Map<string, Legislator>) {
  const ranked: Ranked[] = rows.flatMap((row) => {
    const member = members.get(row.id);
    return member?.active ? [{ ...row, member, voted: row.yes + row.no }] : [];
  });
  const floor = Math.max(3, Math.ceil(0.3 * Math.max(0, ...ranked.map((row) => row.voted))));
  const eligible = ranked.filter((row) => row.voted >= floor);
  const share = (n: number, row: Ranked) => n / row.voted;
  return {
    yes: [...eligible].sort((a, b) => share(b.yes, b) - share(a.yes, a) || b.voted - a.voted).slice(0, 8),
    no: [...eligible].filter((row) => row.no > 0).sort((a, b) => share(b.no, b) - share(a.no, a) || b.voted - a.voted).slice(0, 8),
    floor,
  };
}

function MemberRow({ member, href, children }: { member: Legislator; href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{member.name}</span>
          <span className="block text-xs text-muted-foreground">{member.house} {member.district} · {member.party}</span>
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{children}</span>
      </Link>
    </li>
  );
}

function BillRow({ bill }: { bill: Bill }) {
  const url = billUrl(bill.session, bill.measure);
  return (
    <li className="flex items-start gap-4 px-4 py-2.5">
      <span className="w-16 shrink-0 font-mono text-xs font-medium leading-5">{url ? <ExternalLink href={url}>{measureLabel(bill.measure)}</ExternalLink> : measureLabel(bill.measure)}</span>
      <span className="min-w-0 flex-1 text-sm">{bill.title}</span>
      <span className="hidden shrink-0 text-xs leading-5 text-muted-foreground sm:inline">{bill.status}</span>
    </li>
  );
}

async function Issue({ q }: { q: string }) {
  const [result, all] = await Promise.all([searchIssue(q).catch(() => null), getLegislators().catch(() => [])]);
  if (!result) return <Empty>Records are unavailable right now. Try again shortly.</Empty>;
  if (!result.bills.length) return <Empty>No bills with “{q}” in the title.</Empty>;
  const members = new Map(all.map((item) => [item.id, item]));
  const { yes, no } = rank(result.legislators, members);
  const topic = `?topic=${encodeURIComponent(q)}`;
  const authors = (result.authors ?? []).flatMap((row) => { const member = members.get(row.id); return member?.active ? [{ ...row, member }] : []; }).slice(0, 8);
  const [shown, rest] = [result.bills.slice(0, 8), result.bills.slice(8)];
  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-muted-foreground">{result.bills.length}{result.bills.length === ISSUE_BILL_LIMIT ? "+" : ""} bills with “{q}” in the title, most recent first.</p>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <Section title="Most often voted yes" note={<Download href={`/api/export?kind=issue&part=votes&q=${encodeURIComponent(q)}`} />}>
          {yes.length ? <ol className="divide-y divide-border rounded-xl border border-border">{yes.map((row) => <MemberRow key={row.id} member={row.member} href={`/legislators/${row.id}${topic}`}>Yes on {row.yes} of {row.voted}</MemberRow>)}</ol> : <Empty>Not enough recorded votes.</Empty>}
        </Section>
        <Section title="Most often voted no">
          {no.length ? <ol className="divide-y divide-border rounded-xl border border-border">{no.map((row) => <MemberRow key={row.id} member={row.member} href={`/legislators/${row.id}${topic}`}>No on {row.no} of {row.voted}</MemberRow>)}</ol> : <Empty>No current member voted no on these bills.</Empty>}
        </Section>
        {authors.length ? (
          <Section title="Wrote these bills">
            <ol className="divide-y divide-border rounded-xl border border-border">{authors.map((row) => <MemberRow key={row.id} member={row.member} href={`/legislators/${row.id}${topic}`}>{row.lead} lead{row.coauthor ? ` · ${row.coauthor} co` : ""}</MemberRow>)}</ol>
          </Section>
        ) : null}
        <Section title="Lobbying on these bills" note={<Download href={`/api/export?kind=issue&part=lobbying&q=${encodeURIComponent(q)}`} />}>
          {result.lobbying === null ? <Empty>Lobbying records are unavailable right now.</Empty>
            : !result.lobbying.length ? <Empty>No lobbying reports name these bills.</Empty>
            : <ol className="divide-y divide-border rounded-xl border border-border">
                {result.lobbying.slice(0, 8).map((item) => (
                  <li key={item.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={item.name}>{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.bills.join(", ")}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.filings} {item.filings === 1 ? "report" : "reports"}</span>
                  </li>
                ))}
              </ol>}
        </Section>
      </div>
      <Section title="Bills" note={<Download href={`/api/export?kind=issue&q=${encodeURIComponent(q)}`} />}>
        <ul className="divide-y divide-border rounded-xl border border-border">{shown.map((bill) => <BillRow key={bill.id} bill={bill} />)}</ul>
        {rest.length ? (
          <details className="group">
            <summary className="w-fit cursor-pointer text-sm text-stamp hover:underline group-open:mb-3">Show {rest.length} more</summary>
            <ul className="divide-y divide-border rounded-xl border border-border">{rest.map((bill) => <BillRow key={bill.id} bill={bill} />)}</ul>
          </details>
        ) : null}
      </Section>
    </div>
  );
}

async function Measures({ q }: { q: string }) {
  const found = await findMeasures(q).catch(() => []);
  if (!found.length) return measureNumber(q) ? <Empty>No campaign committees on file for Prop {measureNumber(q)}.</Empty> : null;
  return (
    <Section title="Ballot measures">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {found.map((item) => (
          <li key={`${item.number}-${item.year}`}>
            <Link href={`/measures/${item.year}/${item.number}`} className="flex items-center gap-4 px-4 py-3 hover:bg-accent">
              <span className="w-20 shrink-0 text-sm font-semibold">Prop {item.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title || "California ballot measure"}</span>
              <span className="text-xs text-muted-foreground">{item.year}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

async function NameMatches({ q }: { q: string }) {
  const all = await getLegislators().catch(() => []);
  const found = all.filter((item) => item.active && item.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  if (!found.length) return null;
  return (
    <Section title="Legislators">
      <ul className="flex flex-wrap gap-2">
        {found.map((item) => (
          <li key={item.id}><Link href={`/legislators/${item.id}`} className="block rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"><span className="font-medium">{item.name}</span> <span className="text-muted-foreground">· {item.house} {item.district}</span></Link></li>
        ))}
      </ul>
    </Section>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  return (
    <>
      <div className="flex max-w-2xl flex-col gap-3">
        <SearchBox action="/search" defaultValue={q} placeholder="An issue, a ballot measure, or a legislator" size="lg" />
        {!q ? <TopicChips /> : null}
      </div>
      {q ? (
        <>
          <Suspense fallback={null}><NameMatches q={q} /></Suspense>
          <Suspense key={`m-${q}`} fallback={<Skeleton rows={2} />}><Measures q={q} /></Suspense>
          {measureNumber(q) ? null : q.length >= 3 ? <Suspense key={q} fallback={<Skeleton rows={8} />}><Issue q={q} /></Suspense> : <Empty>Use at least three letters to search bills.</Empty>}
        </>
      ) : null}
    </>
  );
}

export default function Route(props: PageProps<"/search">) {
  return (
    <Page>
      <PageTitle title="Search">Find an issue, a ballot measure or a legislator: who votes on it and who lobbies on it.</PageTitle>
      <Suspense fallback={<Skeleton rows={1} />}><Results searchParams={props.searchParams} /></Suspense>
    </Page>
  );
}
