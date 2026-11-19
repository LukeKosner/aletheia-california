import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { requirePreview, UUID } from "@/lib/interview/guard";
import { canSeeStudy } from "@/lib/interview/staff";
import { getStudy, studyInterviewCount, studySessions } from "@/lib/interview/store";
import { describePerson, dollars, PROFILE_FIELDS, REWARD_CENTS, SPONSOR_KINDS, studyFields, type SponsorKind } from "@/lib/interview/taxonomy";
import { checkout } from "../../actions";
import { ActionForm } from "../../forms";
import { CopyLink } from "./copy-link";

export const metadata = { title: "Study · Aletheia" };

async function Content({ params, searchParams }: PageProps<"/interview/studies/[id]">) {
  await connection();
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const study = UUID.test(id) ? await getStudy(id) : null;
  if (!study) notFound();
  const kind = SPONSOR_KINDS[study.sponsorKind as SponsorKind] ?? "Organization";
  const open = study.status === "open";
  const [sessions, started] = open ? await Promise.all([studySessions(study.id), studyInterviewCount(study.id)]) : [[], 0];
  const path = `/interview?study=${study.id}`;
  if (!await canSeeStudy(study.id)) {
    return (
      <Page narrow>
        <PageTitle title={study.title}>{study.sponsorName} · {kind}</PageTitle>
        <p className="text-muted-foreground">Results are shared only with the organization that ran this study.</p>
        {open ? <Link href={path} className="w-fit text-sm font-medium underline-offset-4 hover:underline">Take this interview</Link> : null}
      </Page>
    );
  }
  const fields = studyFields(study);
  const asked = [...fields.standard.map((f) => PROFILE_FIELDS[f]), ...fields.custom.map((c) => c.label)];

  return (
    <Page narrow>
      <PageTitle title={study.title} back={open ? undefined : { href: `/interview/studies/new?kind=${encodeURIComponent(study.sponsorKind)}`, label: "Start over" }}>{study.sponsorName} · {kind}</PageTitle>
      {search.checkout === "paid" ? <Alert><AlertDescription>Your study is live. Bookmark this page to come back to your results.</AlertDescription></Alert> : null}
      {search.checkout === "cancelled" ? <Alert><AlertDescription>No charge was made. You can launch any time.</AlertDescription></Alert> : null}
      {search.checkout === "unpaid" ? <Alert><AlertDescription>We&apos;re still confirming your payment.</AlertDescription></Alert> : null}

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Share this link</CardTitle>
            <CardDescription>{Math.min(started, study.interviewTarget)} of {study.interviewTarget} interviews done or in progress. Anyone with the link can take it.</CardDescription>
          </CardHeader>
          <CardContent><CopyLink path={path} /></CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Ready to launch</CardTitle>
            <CardDescription>{study.interviewTarget} voice interviews of about ten minutes each, with follow-up questions. We pay each person {dollars(REWARD_CENTS)} and show you every answer here. Answers are shared only with you, never published, so don&apos;t ask for names or addresses.</CardDescription>
          </CardHeader>
          <CardFooter>
            <ActionForm action={checkout} label={`Launch for ${dollars(study.priceCents)}`} pendingLabel="Opening Stripe…" hidden={{ product: "study", studyId: study.id }} />
          </CardFooter>
        </Card>
      )}

      <Section title="Questions">
        <ol className="list-decimal space-y-1 pl-5">{study.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
      </Section>

      <Section title="What people fill in">
        {asked.length ? <p className="text-sm text-muted-foreground">{asked.join(" · ")}</p> : <p className="text-sm text-muted-foreground">Nothing beyond their email for the {dollars(REWARD_CENTS)} reward.</p>}
        {fields.custom.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{fields.custom.map((c) => <li key={c.label}>{c.label}: {c.options.join(", ")}</li>)}</ul>
        ) : null}
      </Section>

      {open ? (
        <Section title={`Answers (${sessions.length})`}>
          {sessions.length ? (
            <ItemGroup className="gap-3">
              {sessions.map((s) => (
                <Item key={s.id} variant="outline" className="flex-col items-stretch">
                  <ItemContent>
                    <ItemTitle>{describePerson(s) || "Interview"}</ItemTitle>
                    {s.summary ? <ItemDescription className="line-clamp-none">{s.summary}</ItemDescription> : null}
                  </ItemContent>
                  {s.answers.length ? (
                    <dl className="flex flex-col gap-2 text-sm">
                      {s.answers.map((a, i) => <div key={i}><dt className="font-medium">{a.question}</dt><dd className="text-muted-foreground">{a.answer}</dd></div>)}
                    </dl>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
          ) : <p className="text-sm text-muted-foreground">No interviews yet. Share the link to get started.</p>}
        </Section>
      ) : null}
    </Page>
  );
}

export default function Study(props: PageProps<"/interview/studies/[id]">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
