import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requirePreview } from "@/lib/interview/guard";
import { completedSessions, listResearch } from "@/lib/interview/store";
import { percent, tally } from "@/lib/interview/insights";
import { COUNTIES, describePerson, NOT_ASKED, PARTIES } from "@/lib/interview/taxonomy";
import { AutoRefresh } from "../auto-refresh";
import { ResearchList } from "../research-list";

export const metadata = { title: "What California is saying · Aletheia" };

function Bars({ rows, total }: { rows: [string, number][]; total: number }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(([label, n]) => (
        <li key={label} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate">{label}</span>
          <span className="h-2 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums text-muted-foreground">{percent(n, total)}%</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

const pick = (v: unknown, allowed: readonly string[]) => (typeof v === "string" && allowed.includes(v) ? v : "");

async function Content({ searchParams }: PageProps<"/interview/insights">) {
  await connection();
  requirePreview();
  const search = await searchParams;
  const county = pick(search.county, COUNTIES), party = pick(search.party, PARTIES);
  // Public results leave out sponsored study interviews.
  const [all, periodic, voter] = await Promise.all([completedSessions(2000, { publicOnly: true }), listResearch({ origin: "periodic" }, 10), listResearch({ origin: "voter" }, 10)]);
  const sessions = all.filter((s) => (!county || s.county === county) && (!party || s.party === party));
  const issues = tally(sessions.map((s) => s.issues));
  const top = issues[0];
  const counties = new Set(sessions.map((s) => s.county).filter((c) => c !== NOT_ASKED)).size;
  const byCounty = new Map<string, typeof sessions>();
  for (const s of sessions) if (s.county !== NOT_ASKED) byCounty.set(s.county, [...(byCounty.get(s.county) ?? []), s]);
  const running = [...periodic, ...voter].some((r) => r.status === "queued" || r.status === "running");
  const questions = sessions.flatMap((s) => s.questions.map((q) => ({ q, s }))).slice(0, 10);

  if (!all.length) {
    return (
      <Page narrow>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No interviews yet</EmptyTitle>
            <EmptyDescription>Be the first to share what matters to you.</EmptyDescription>
          </EmptyHeader>
          <Button nativeButton={false} render={<Link href="/interview" />}>Take the interview</Button>
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      {running ? <AutoRefresh seconds={15} /> : null}
      <PageTitle title="What California is saying" />

      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat label="Top issue" value={top ? top[0] : "None yet"} note={top ? `Raised in ${percent(top[1], sessions.length)}% of interviews` : undefined} />
        <Stat label="Interviews" value={sessions.length.toLocaleString("en-US")} note={county || party ? "Matching your filters" : undefined} />
        <Stat label="Counties" value={counties.toLocaleString("en-US")} note="Of 58" />
      </dl>

      <form className="flex flex-wrap items-center gap-2" action="/interview/insights">
        <NativeSelect name="county" defaultValue={county} aria-label="County">
          <NativeSelectOption value="">All counties</NativeSelectOption>
          {COUNTIES.map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect name="party" defaultValue={party} aria-label="Party">
          <NativeSelectOption value="">All parties</NativeSelectOption>
          {PARTIES.map((p) => <NativeSelectOption key={p} value={p}>{p}</NativeSelectOption>)}
        </NativeSelect>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Top issues" note={`${sessions.length} interview${sessions.length === 1 ? "" : "s"}`}>
          {issues.length ? <Bars rows={issues.slice(0, 10)} total={sessions.length} /> : <p className="text-sm text-muted-foreground">No matches.</p>}
        </Section>
        <Section title="By county">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {[...byCounty.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([c, list]) => (
              <li key={c} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/interview/insights?county=${encodeURIComponent(c)}`} className="hover:underline">{c} <span className="text-muted-foreground">{list.length}</span></Link>
                <span className="flex flex-wrap gap-1">{tally(list.map((s) => s.issues)).slice(0, 3).map(([i]) => <Badge key={i} variant="secondary">{i}</Badge>)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {questions.length ? (
        <Section title="Questions">
          <ItemGroup className="gap-2">
            {questions.map(({ q, s }, i) => (
              <Item key={i} variant="outline" size="sm" render={<Link href={`/interview/${s.id}`} />}>
                <ItemContent><ItemTitle>{q}</ItemTitle><ItemDescription>{describePerson(s)}</ItemDescription></ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </Section>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-2">
        {periodic.length ? (
          <Section title="Weekly research">
            <ResearchList rows={periodic} empty="None yet." />
          </Section>
        ) : null}
        <Section title="Voter research">
          <ResearchList rows={voter} empty="None yet." />
        </Section>
      </div>

      <Section title="Recent interviews">
        <ItemGroup className="grid gap-2 sm:grid-cols-2">
          {sessions.slice(0, 8).map((s) => (
            <Item key={s.id} variant="outline" render={<Link href={`/interview/${s.id}`} />}>
              <ItemContent>
                <ItemTitle>{describePerson({ ...s, party: NOT_ASKED }) || "Interview"}</ItemTitle>
                <ItemDescription>{s.summary ?? "No summary."}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </Section>
    </Page>
  );
}

export default function Insights(props: PageProps<"/interview/insights">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
