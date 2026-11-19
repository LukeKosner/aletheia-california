"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, FileText, Globe, MessageSquareText } from "lucide-react";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import { InlineCitationCard, InlineCitationCardBody, InlineCitationSource } from "@/components/ai-elements/inline-citation";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { ErrorReport, InvestigationFeedback } from "@/components/feedback/forms";
import { cn } from "@/lib/utils";
import { filingUrl, webDomain, webUrl, type FilingSource, type Investigation, type Sentence } from "./model";
import { StudyDraftCard } from "./study-draft";
import { formLabel } from "./filing-label";
import { INSIGHTS_PAGE } from "@/app/api/investigations/contract";

/** Interview sentences link to the public insights page, where the same counts are shown. */
const isInsight = (sentence: Sentence) => sentence.insight === true && !sentence.claim_id && !sentence.source;

/** Drop internal record keys such as "(calaccess:filer:741666)" from display text; the citations carry the source. */
const readable = (text: string) => text
  .replace(/\s*\([^()]*\bcalaccess:[^()]*\)/giu, "")
  .replace(/,?\s*\bcalaccess:(?:filer|filing|entity):\d+/giu, "")
  .replace(/\s+([,.;])/gu, "$1");

type WebLink = { url: string; title: string; domain: string };
function webLink(sentence: Sentence): WebLink | null {
  const url = sentence.source && !sentence.source_ids?.length ? webUrl(sentence.source.url) : undefined;
  return url && sentence.source ? { url, title: sentence.source.title, domain: webDomain(url) } : null;
}

/** One quiet pill per sentence; the hover card lists what it cites. */
const pill = "ml-1 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 align-[0.1em] text-xs leading-5 text-muted-foreground no-underline outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** "Lobbying firm report · Rocket, LLC". Older saved answers carry only "calaccess 3224798 F496", so read the form from it. */
export function filingTitle(source: FilingSource): string {
  const kind = source.kind ?? formLabel(source.title.match(/\bF\d{3}\b/u)?.[0]);
  return [kind, source.filer].filter(Boolean).join(" · ");
}
export function filingMeta(source: FilingSource): string {
  const host = source.host ?? (/^calaccess\b/iu.test(source.title) ? "CAL\u2011ACCESS" : undefined);
  return [source.period, source.filed ? `Filed ${source.filed}` : null, host].filter(Boolean).join(" · ");
}

function RecordCitation({ filings }: { filings: FilingSource[] }) {
  const first = filings.map((source) => filingUrl(source.url)).find(Boolean);
  if (!first) return null;
  const label = filings.length === 1 ? "1 filing" : `${filings.length} filings`;
  return (
    <InlineCitationCard>
      <HoverCardTrigger delay={150} closeDelay={100} render={<a href={first} target="_blank" rel="noreferrer" aria-label={`Public records: ${label}`} className={pill} />}>
        <FileText aria-hidden className="size-3" />{label}
      </HoverCardTrigger>
      <InlineCitationCardBody className="w-80 rounded-xl p-3">
        <p className="px-1 pb-2 text-xs text-muted-foreground">From public filings</p>
        <ul className="flex flex-col">
          {filings.slice(0, 5).map((source) => {
            const url = filingUrl(source.url);
            return (
              <li key={source.id}>
                <a href={url} target="_blank" rel="noreferrer" className="block rounded-lg px-1 py-1.5 hover:bg-muted">
                  <InlineCitationSource title={filingTitle(source)} description={filingMeta(source) || undefined} />
                </a>
              </li>
            );
          })}
        </ul>
        {filings.length > 5 ? <p className="px-1 pt-1 text-xs text-muted-foreground">{filings.length - 5} more in Sources below</p> : null}
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}

function WebCitation({ link }: { link: WebLink }) {
  return (
    <InlineCitationCard>
      <HoverCardTrigger delay={150} closeDelay={100} render={<a href={link.url} target="_blank" rel="noreferrer nofollow" aria-label={`Web source, not checked by Aletheia: ${link.title}`} className={cn(pill, "max-w-48")} />}>
        <Globe aria-hidden className="size-3 shrink-0" /><span className="truncate">{link.domain}</span>
      </HoverCardTrigger>
      <InlineCitationCardBody className="w-80 rounded-xl p-4">
        <InlineCitationSource title={link.title} url={link.domain} description="A web page. Aletheia has not checked it against public filings." />
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}

function Citation({ sentence, sources, section }: { sentence: Sentence; sources: Map<string, FilingSource>; section: string }): ReactNode {
  if (sentence.source_ids?.length) return <RecordCitation filings={sentence.source_ids.flatMap((id) => sources.get(id) ?? [])} />;
  const web = webLink(sentence);
  if (web) return <WebCitation link={web} />;
  // Sentences describing a study draft are about the draft, not interview data, so they carry no pill.
  if (isInsight(sentence) && section !== "Study") {
    return (
      <Link href={INSIGHTS_PAGE} aria-label="From Aletheia's own voter interviews: open interview insights" className={pill}>
        <MessageSquareText aria-hidden className="size-3" />Interviews
      </Link>
    );
  }
  return null;
}

/** One source: what it is on the first line, when and where on the second. */
function SourceRow({ href, title, meta, icon: Icon, web = false }: { href: string; title: string; meta: string; icon: typeof FileText; web?: boolean }) {
  return (
    <li>
      <a href={href} target="_blank" rel={web ? "noreferrer nofollow" : "noreferrer"} className="-mx-3 flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-sm leading-5">{title}</span>
          {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
        </span>
      </a>
    </li>
  );
}

/** Collapsed by default: the answer leads, and the list is there for anyone who wants to check it. */
function SourceList({ investigation, webSources }: { investigation: Investigation; webSources: WebLink[] }) {
  const filings = investigation.sources.filter((source) => filingUrl(source.url));
  if (!filings.length && !webSources.length) return null;
  // Same kind and filer, shown once: ten quarterly reports from one committee become one line with ten dates, latest period first.
  const groups = new Map<string, FilingSource[]>();
  for (const source of filings) groups.set(filingTitle(source), [...(groups.get(filingTitle(source)) ?? []), source]);
  for (const list of groups.values()) list.sort((a, b) => (b.periodStart ?? b.filedAt ?? "").localeCompare(a.periodStart ?? a.filedAt ?? ""));
  const summary = [filings.length ? `${filings.length} public filing${filings.length === 1 ? "" : "s"}` : null, webSources.length ? `${webSources.length} web page${webSources.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
  return (
    <Sources className="mb-0 text-sm text-foreground">
      <SourcesTrigger count={filings.length + webSources.length} className="group/sources text-muted-foreground hover:text-foreground">
        <span>Based on {summary}</span>
        <ChevronDown aria-hidden className="size-4 transition-transform group-data-[panel-open]/sources:rotate-180" />
      </SourcesTrigger>
      <SourcesContent className="w-full gap-0">
        <ul className="flex flex-col">
          {[...groups.entries()].map(([title, list]) => list.length === 1
            ? <SourceRow key={list[0].id} href={filingUrl(list[0].url)!} title={title} meta={filingMeta(list[0])} icon={FileText} />
            : (
              <li key={title} className="flex gap-3 py-2.5">
                <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="break-words text-sm leading-5">{title} <span className="text-muted-foreground">· {list.length} filings</span></span>
                  <ul className="flex flex-wrap gap-1.5">
                    {list.map((source) => (
                      <li key={source.id}>
                        <a href={filingUrl(source.url)} target="_blank" rel="noreferrer" title={filingMeta(source)} className="inline-block rounded-md bg-muted px-1.5 text-xs leading-5 text-muted-foreground hover:bg-accent hover:text-foreground">
                          {source.period ?? source.filed ?? "Filing"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          {webSources.map((source) => <SourceRow key={source.url} href={source.url} title={source.title} meta={`${source.domain} · Web page, not checked by Aletheia`} icon={Globe} web />)}
        </ul>
      </SourcesContent>
    </Sources>
  );
}

export function InvestigationAnswer({ investigation, map }: { investigation: Investigation; map?: ReactNode }) {
  const sources = new Map(investigation.sources.map((source) => [source.id, source]));
  const sentences = investigation.answer.sections.flatMap((section) => section.sentences);
  const webSources = [...new Map(sentences.flatMap((sentence) => { const link = webLink(sentence); return link ? [[link.url, link] as const] : []; })).values()];
  const study = investigation.answer.study;
  const statements = sentences.flatMap((sentence) => sentence.claim_id && sentence.source_ids?.length ? [{ claimId: sentence.claim_id, text: readable(sentence.text) }] : []);
  // The agent returns an empty answer when nothing it may cite (records, interviews, official pages) answers the question.
  if (!sentences.length && !study) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border p-5">
        <p className="font-medium">No sourced answer this time.</p>
        <p className="text-muted-foreground">Aletheia only answers with what it can cite from public records, its voter interviews or official pages, and it found nothing it could cite for this question. Try asking again, or ask about one part, e.g. “What does the Legislative Analyst’s Office say about the state budget timeline?”</p>
      </div>
    );
  }
  return (
    <article className="flex flex-col gap-8">
      {investigation.answer.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{section.heading}</h2>
          {section.sentences.map((sentence, sentenceIndex) => (
            <p key={`${sentence.claim_id ?? sentence.source?.url ?? "s"}-${sentenceIndex}`} className="break-words leading-7">
              {readable(sentence.text)}<Citation sentence={sentence} sources={sources} section={section.heading} />
            </p>
          ))}
        </section>
      ))}
      {study ? <StudyDraftCard draft={study} /> : null}
      {map}
      {investigation.evidence_note && investigation.graph ? <p className="text-xs text-muted-foreground">{investigation.evidence_note}</p> : null}
      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <SourceList investigation={investigation} webSources={webSources} />
        {/* One report link for the whole answer; it can point at a recorded statement. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
          <InvestigationFeedback investigationId={investigation.investigation_id} />
          <ErrorReport investigationId={investigation.investigation_id} statements={statements} />
        </div>
      </div>
    </article>
  );
}
