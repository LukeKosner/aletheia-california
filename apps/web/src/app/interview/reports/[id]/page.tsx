import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadResult } from "@/app/api/investigations/service";
import { INSIGHTS_PAGE, isCited, isInsight, type InvestigationResult } from "@/app/api/investigations/contract";
import { ExternalLink, Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { requirePreview, UUID } from "@/lib/interview/guard";
import { getResearch, updateResearch } from "@/lib/interview/store";
import { readable, sameText, sourceLabel } from "@/lib/interview/report-text";
import { AutoRefresh } from "../../auto-refresh";

export const metadata = { title: "Report · Aletheia" };

function domain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return url; }
}

async function result(investigationId: string | null): Promise<{ data: InvestigationResult | null; error: string | null }> {
  if (!investigationId) return { data: null, error: null };
  try { return { data: await loadResult(investigationId), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : "The report is unavailable." }; }
}

async function Content({ params }: PageProps<"/interview/reports/[id]">) {
  await connection();
  requirePreview();
  const { id } = await params;
  const research = UUID.test(id) ? await getResearch(id) : null;
  if (!research) notFound();
  // Research and reports are free to read in full.
  const { data, error } = await result(research.investigationId);
  const status = data?.status ?? research.status;
  if (data && data.status !== research.status && ["completed", "failed", "incomplete"].includes(data.status)) await updateResearch(research.id, { status: data.status });
  const problem = research.error ?? error;
  const running = !problem && !["completed", "failed", "incomplete"].includes(status);
  const claims = new Map((data?.claims ?? []).map((c) => [c.claim_id, c]));
  const sources = [...new Map((data?.claims ?? []).flatMap((c) => c.sources ?? []).map((s) => [s.filing_id, s])).values()];
  const summary = data?.answer ? readable(data.answer.summary) : "";
  const firstSentence = data?.answer?.sections[0]?.sentences[0]?.text;
  const showSummary = Boolean(summary) && !(firstSentence && sameText(summary, readable(firstSentence)));
  const date = research.createdAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" });

  return (
    <Page narrow>
      {running ? <AutoRefresh seconds={8} /> : null}
      <PageTitle title={research.question} back={research.sessionId ? { href: `/interview/${research.sessionId}`, label: "Interview" } : { href: "/interview/insights", label: "Insights" }}>
        {research.origin === "periodic" ? "Weekly research" : "Voter request"} · {date}
      </PageTitle>

      {problem && !data?.answer ? <Alert><AlertDescription>We couldn&apos;t finish looking this up right now. Nothing is wrong with your interview; please check back later.</AlertDescription></Alert> : null}
      {running ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Looking this up in public records. This usually takes a few minutes.</p> : null}

      {data?.answer ? (
        <div className="flex flex-col gap-10 break-words">
          {showSummary ? <p className="leading-7">{summary}</p> : null}
          {data.answer.sections.map((s) => (
            <Section key={s.heading} title={readable(s.heading)}>
              <p className="leading-7">
                {s.sentences.map((sentence, i) => {
                  if (isInsight(sentence)) {
                    return <span key={`insight-${i}`}>{readable(sentence.text)} <span className="text-xs text-muted-foreground">(<Link href={INSIGHTS_PAGE} className="underline underline-offset-4">Aletheia interviews</Link>)</span> </span>;
                  }
                  if (!isCited(sentence)) {
                    return <span key={`web-${i}`}>{readable(sentence.text)} <span className="text-xs text-muted-foreground">(web source: {/^https?:\/\//iu.test(sentence.source.url) ? <ExternalLink href={sentence.source.url}>{domain(sentence.source.url)}</ExternalLink> : domain(sentence.source.url)})</span> </span>;
                  }
                  const first = claims.get(sentence.claim_id)?.sources?.[0];
                  const n = first ? sources.findIndex((x) => x.filing_id === first.filing_id) + 1 : 0;
                  return <span key={sentence.claim_id}>{readable(sentence.text)}{n ? <sup><a href={`#source-${n}`} className="text-muted-foreground"> {n}</a></sup> : null} </span>;
                })}
              </p>
            </Section>
          ))}
          {sources.length ? (
            <Section title="Sources">
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {sources.map((s, i) => <li key={s.filing_id} id={`source-${i + 1}`}>{s.url ? <ExternalLink href={s.url}>{sourceLabel(s.title)}</ExternalLink> : sourceLabel(s.title)}</li>)}
              </ol>
            </Section>
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}

export default function Report(props: PageProps<"/interview/reports/[id]">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
