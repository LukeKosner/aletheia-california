import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { isOwner } from "@/lib/interview/access";
import { canSeeStudy, isStaff } from "@/lib/interview/staff";
import { requirePreview, UUID } from "@/lib/interview/guard";
import { researchStarting } from "@/lib/interview/research";
import { followOnStudy, getSession, getStudy, listResearch } from "@/lib/interview/store";
import { describePerson, dollars, NOT_ASKED, REWARD_CENTS, SPONSOR_KINDS, type SponsorKind } from "@/lib/interview/taxonomy";
import { AutoRefresh } from "../auto-refresh";
import { ResearchList } from "../research-list";
import { InterviewRoom } from "./interview-room";

export const metadata = { title: "Voter interview · Aletheia" };

function List({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 pl-5">{items.map((x) => <li key={x}>{x}</li>)}</ul>;
}

async function Content({ params }: PageProps<"/interview/[id]">) {
  await connection();
  requirePreview();
  const { id } = await params;
  const session = UUID.test(id) ? await getSession(id) : null;
  if (!session) notFound();
  const who = describePerson({ ...session, voteLikelihood: undefined });
  const owner = await isOwner(session.id);
  // Anyone else (for example, from the public results page) sees a third-person view.
  const visitorTitle = session.county === NOT_ASKED ? "A voter" : `A voter in ${session.county} County`;

  if (session.status !== "completed" && !owner) {
    return (
      <Page narrow>
        <PageTitle title={visitorTitle} back={{ href: "/interview/insights", label: "Insights" }} />
        <p className="text-muted-foreground">This interview is in progress.</p>
      </Page>
    );
  }

  if (session.status !== "completed") {
    return (
      <Page className="gap-6">
        <PageTitle title="Your interview">{who ? `${who} · ` : ""}About ten minutes</PageTitle>
        <InterviewRoom id={session.id} study={Boolean(session.studyId)} />
      </Page>
    );
  }

  const [research, study] = await Promise.all([
    listResearch({ sessionId: session.id }), session.studyId ? getStudy(session.studyId) : null,
  ]);
  const running = research.some((r) => r.status === "queued" || r.status === "running");
  // Just finished: research rows are being created. Older interviews from before free research have none.
  const starting = !research.length && researchStarting(session);
  const reward = `Your ${dollars(REWARD_CENTS)} reward is recorded.`;

  if (study) {
    return (
      <Page narrow>
        {owner
          ? <PageTitle title="Thanks for talking with us">{reward} Your answers went to {study.sponsorName}.</PageTitle>
          : <PageTitle title={visitorTitle}>Interviewed for {study.sponsorName}.</PageTitle>}
        {!owner && !await canSeeStudy(study.id) ? <p className="text-muted-foreground">Answers are shared only with {study.sponsorName}.</p> : session.answers.length ? (
          <Section title={study.title}>
            <dl className="flex flex-col gap-3">
              {session.answers.map((a, i) => <div key={i}><dt className="font-medium">{a.question}</dt><dd className="text-muted-foreground">{a.answer}</dd></div>)}
            </dl>
          </Section>
        ) : session.summary ? <p className="leading-7">{session.summary}</p> : null}
      </Page>
    );
  }

  // After a general interview, the voter may take one open study as a separate, labeled interview.
  const offer = owner && session.rewardEmail ? await followOnStudy(session.rewardEmail) : null;
  return (
    <Page narrow>
      {running || starting ? <AutoRefresh seconds={5} /> : null}
      {owner
        ? <PageTitle title="Thanks for talking with us" back={{ href: "/interview/insights", label: "Insights" }}>{who ? `${who} · ` : ""}{reward}</PageTitle>
        : <PageTitle title={visitorTitle} back={{ href: "/interview/insights", label: "Insights" }}>{describePerson({ ...session, county: NOT_ASKED, voteLikelihood: undefined }) || null}</PageTitle>}
      {offer ? (
        <Card>
          <CardHeader>
            <CardTitle>One more, if you&apos;d like</CardTitle>
            <CardDescription>
              {offer.sponsorName} ({SPONSOR_KINDS[offer.sponsorKind as SponsorKind]?.toLowerCase() ?? "organization"}) is running a study: {offer.title}. It&apos;s a separate interview of about ten minutes, for another {dollars(REWARD_CENTS)}. Your answers go only to {offer.sponsorName} and are not published.
            </CardDescription>
          </CardHeader>
          <CardFooter><Button nativeButton={false} render={<Link href={`/interview?study=${offer.id}&from=${session.id}`} />}>Take this study</Button></CardFooter>
        </Card>
      ) : null}
      {session.summary ? <p className="leading-7">{session.summary}</p> : null}
      {session.issues.length ? <Section title="Issues"><List items={session.issues} /></Section> : null}
      {session.questions.length ? <Section title="Questions"><List items={session.questions} /></Section> : null}
      {session.candidateViews.length ? <Section title={owner ? "Your views" : "Views"}><List items={session.candidateViews} /></Section> : null}
      {session.details.sources?.length ? <Section title={owner ? "Where you get information" : "Where they get information"}><List items={session.details.sources} /></Section> : null}
      {session.details.toLeaders ? <Section title={owner ? "What you'd tell California's leaders" : "What they'd tell California's leaders"}><p className="leading-7">{session.details.toLeaders}</p></Section> : null}
      {session.details.quotes?.length ? (
        <Section title={owner ? "In your words" : "In their words"}>
          <div className="flex flex-col gap-2">{session.details.quotes.map((q) => <blockquote key={q} className="border-l-2 border-border pl-3 text-muted-foreground">&ldquo;{q}&rdquo;</blockquote>)}</div>
        </Section>
      ) : null}

      {research.length || starting ? (
        <Section title="What public records say" note="Free">
          <ResearchList rows={research} empty={owner ? "Getting your research ready…" : "Getting research ready…"} />
        </Section>
      ) : null}

      {/* The raw transcript can hold names or places said aloud, so only the voter and staff see it. */}
      {session.transcript.length && (owner || await isStaff()) ? (
        <Collapsible>
          <CollapsibleTrigger className="text-sm font-medium underline-offset-4 hover:underline">Transcript</CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-3"><CardContent>
              <ol className="flex flex-col gap-2 text-sm">
                {session.transcript.map((line, i) => (
                  <li key={i}><span className="font-medium">{line.role === "voter" ? "Voter" : "Interviewer"}:</span> <span className="text-muted-foreground">{line.text}</span></li>
                ))}
              </ol>
            </CardContent></Card>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Page>
  );
}

export default function InterviewSession(props: PageProps<"/interview/[id]">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
