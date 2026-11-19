import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Page, PageTitle, Skeleton } from "@/components/gov/ui";
import { requirePreview, UUID } from "@/lib/interview/guard";
import { isOwner } from "@/lib/interview/access";
import { getSession, getStudy } from "@/lib/interview/store";
import { dollars, NOT_ASKED, REWARD_CENTS, studyFields } from "@/lib/interview/taxonomy";
import { startInterview } from "./actions";
import { StartForm, type StartDefaults } from "./forms";

export const metadata = { title: "Voter interview · Aletheia" };

async function Content({ searchParams }: PageProps<"/interview">) {
  await connection();
  const { study: raw, from } = await searchParams;
  const study = typeof raw === "string" && UUID.test(raw) ? await getStudy(raw) : null;
  const open = study?.status === "open";
  // A follow-on from the voter's own general interview carries over what they already told us (never consent).
  const earlier = open && typeof from === "string" && UUID.test(from) && await isOwner(from) ? await getSession(from) : null;
  const known = (value?: string) => value && value !== NOT_ASKED ? value : undefined;
  const defaults: StartDefaults = earlier
    ? { county: known(earlier.county), ageRange: known(earlier.ageRange), party: known(earlier.party), voteLikelihood: known(earlier.voteLikelihood), email: earlier.rewardEmail ?? undefined }
    : {};
  if (study && !open) {
    // A study link that is not live says so, instead of quietly showing the general interview.
    return (
      <Page narrow>
        <PageTitle title={study.title}>{study.sponsorName}</PageTitle>
        <p className="text-muted-foreground">This study isn&apos;t taking interviews right now.</p>
        <Link className="w-fit text-sm text-muted-foreground hover:text-foreground" href="/interview">Take the general voter interview instead</Link>
      </Page>
    );
  }
  return (
    <Page narrow>
      {open ? (
        <PageTitle title={study.title}>A voice interview of about ten minutes for {study.sponsorName}. Get {dollars(REWARD_CENTS)}.{earlier ? " We filled in what you told us last time; check it and confirm below." : ""}</PageTitle>
      ) : (
        <PageTitle title="Tell us what matters to you">Talk for about ten minutes. Get {dollars(REWARD_CENTS)}, and free research on your questions from public records.</PageTitle>
      )}
      <StartForm action={startInterview} studyId={open ? study.id : undefined} sponsor={open ? study.sponsorName : undefined} fields={studyFields(open ? study : null)} defaults={defaults} />
      {open ? null : <Link className="w-fit text-sm text-muted-foreground hover:text-foreground" href="/interview/insights">See what others said</Link>}
    </Page>
  );
}

export default function InterviewHome(props: PageProps<"/interview">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
