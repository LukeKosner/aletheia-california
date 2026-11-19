import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { Download, Empty, ExternalLink, Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import { getMeasure, measureElections, money, type Side, type Spender } from "@/lib/gov";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/gov/print-button";

type Params = PageProps<"/measures/[year]/[number]">["params"];
const parse = async (params: Params) => { const p = await params; return { year: Number(p.year), n: Number(p.number) }; };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, n } = await parse(params);
  return { title: `Prop ${n} (${year}) — Aletheia` };
}

function SideColumn({ label, side, tone }: { label: string; side: Side; tone: "yes" | "no" }) {
  return (
    <Section title={label}>
      <div className={cn("rounded-xl px-4 py-3", tone === "yes" ? "bg-stamp/10" : "bg-muted")}>
        <p className="text-xs text-muted-foreground">Raised by committees named “{label}”</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{money(side.total)}</p>
        <p className="text-xs text-muted-foreground">{side.donors.toLocaleString("en-US")} contributors · {side.committees.length} {side.committees.length === 1 ? "committee" : "committees"}</p>
      </div>
      {side.top.length ? (
        <ol className="divide-y divide-border rounded-xl border border-border">
          {side.top.map((item) => (
            <li key={item.id} className="flex items-center gap-4 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.count} {item.count === 1 ? "contribution" : "contributions"}{item.url ? <> · <ExternalLink href={item.url}>filing</ExternalLink></> : null}</p>
              </div>
              <span className="text-sm font-medium tabular-nums">{money(item.total)}</span>
            </li>
          ))}
        </ol>
      ) : <Empty>No contributions on file.</Empty>}
    </Section>
  );
}

function Spenders({ title, rows }: { title: string; rows: Spender[] }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-4 px-4 py-2.5">
            <p className="min-w-0 flex-1 truncate text-sm" title={row.name}>{row.name}{row.url ? <> · <ExternalLink href={row.url} className="text-xs">filing</ExternalLink></> : null}</p>
            <span className="text-sm tabular-nums">{money(row.total)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

async function Detail({ params }: { params: Params }) {
  const { year, n } = await parse(params);
  const [measure, elections] = await Promise.all([getMeasure(n, year).catch(() => undefined), measureElections(n).catch(() => [])]);
  if (measure === null) notFound();
  if (!measure) return <Empty>Campaign records are unavailable right now. Try again shortly.</Empty>;
  const question = `Who is funding Prop ${n} in ${year}, and where does that money come from?`;
  return (
    <>
      <PageTitle back={{ href: "/measures", label: "Ballot measures" }} title={<>Prop {n} <span className="text-muted-foreground">· {year}</span></>}>
        {measure.title || "California ballot measure"}
      </PageTitle>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <PrintButton />
        <Link prefetch={false} href={`/i/new?${new URLSearchParams({ question, type: "general" })}`} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/85">
          <MessageSquareText aria-hidden className="size-4" /> Trace the money in detail
        </Link>
        {elections.filter((item) => item.year !== year).map((item) => (
          <Link key={item.year} href={`/measures/${item.year}/${n}`} className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Prop {n} · {item.year}</Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <SideColumn label={`Yes on ${n}`} side={measure.yes} tone="yes" />
        <SideColumn label={`No on ${n}`} side={measure.no} tone="no" />
        <Spenders title="Independent spending in support" rows={measure.ieSupport} />
        <Spenders title="Independent spending in opposition" rows={measure.ieOppose} />
      </div>
      <Download href={`/api/export?kind=measure&n=${n}&year=${year}`} />
      <p className="text-xs text-muted-foreground">Committees are grouped by their own names. Contributions from {year - 1} to {year}; the same contributor, date and amount is counted once per side.</p>
    </>
  );
}

export default function Route({ params }: PageProps<"/measures/[year]/[number]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton rows={8} />}><Detail params={params} /></Suspense>
    </Page>
  );
}
