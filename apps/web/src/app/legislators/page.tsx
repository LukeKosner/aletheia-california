import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Empty, Page, PageTitle, SearchBox, Section, Skeleton } from "@/components/gov/ui";
import { DistrictFinder } from "@/components/gov/district-finder";
import { getLegislators, type Legislator } from "@/lib/gov";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Legislators — Aletheia" };

const HOUSES = [{ id: "", label: "All" }, { id: "assembly", label: "Assembly" }, { id: "senate", label: "Senate" }] as const;

function matches(item: Legislator, q: string) {
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (digits && digits === q.replace(/^(district|ad|sd)\s*/i, "").trim()) return item.district === Number(digits);
  return item.name.toLowerCase().includes(q.toLowerCase());
}

async function Finder() {
  const all = await getLegislators().catch(() => []);
  return <DistrictFinder legislators={all.filter((item) => item.active)} />;
}

async function List({ searchParams }: { searchParams: PageProps<"/legislators">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const house = params.house === "assembly" || params.house === "senate" ? params.house : "";
  const all = await getLegislators().catch(() => null);
  const list = (all ?? []).filter((item) => item.active && (!house || item.house.toLowerCase() === house) && matches(item, q));
  return (
    <Section title="All members">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-sm sm:flex-1"><SearchBox action="/legislators" defaultValue={q} placeholder="Name or district number" hidden={house ? { house } : undefined} /></div>
        <nav aria-label="Chamber" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          {HOUSES.map((item) => {
            const href = `/legislators?${new URLSearchParams({ ...(item.id ? { house: item.id } : {}), ...(q ? { q } : {}) })}`;
            return <Link key={item.id} href={href} aria-current={house === item.id ? "page" : undefined} className={cn("rounded-md px-3 py-1", house === item.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{item.label}</Link>;
          })}
        </nav>
      </div>
      {!all ? <Empty>Legislator records are unavailable right now. Try again shortly.</Empty>
        : !list.length ? <Empty>No current legislator matches “{q}”.</Empty>
        : <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {list.map((item) => (
              <li key={item.id}>
                <Link href={`/legislators/${item.id}`} className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-accent">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{item.house === "Senate" ? "SD" : "AD"} {String(item.district).padStart(2, "0")}</span>
                  <span className="flex-1 text-sm font-medium">{item.name}</span>
                  <span className="hidden text-sm text-muted-foreground sm:inline">{item.party}</span>
                </Link>
              </li>
            ))}
          </ul>}
      {list.length ? <p className="text-xs text-muted-foreground">{list.length} current {list.length === 1 ? "member" : "members"}</p> : null}
    </Section>
  );
}

export default function Route(props: PageProps<"/legislators">) {
  return (
    <Page narrow>
      <PageTitle title="Legislators" />
      <Section title="Who represents you">
        <Suspense fallback={<Skeleton rows={1} />}><Finder /></Suspense>
      </Section>
      <Suspense fallback={<Skeleton rows={8} />}><List searchParams={props.searchParams} /></Suspense>
    </Page>
  );
}
