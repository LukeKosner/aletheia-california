import { Suspense } from "react";
import { Page, PageTitle, Skeleton } from "@/components/gov/ui";
import { requirePreview } from "@/lib/interview/guard";
import { decodeStudyDraft } from "@/lib/interview/study-draft";
import { dollars, STUDY_SIZES } from "@/lib/interview/taxonomy";
import { saveStudy } from "../../actions";
import { StudyForm } from "../../forms";

export const metadata = { title: "Run a study · Aletheia" };

const COPY = {
  government: { title: "Hear from your residents", body: "Write your questions and choose what people fill in. Share your link with residents; our interviewer talks with each person by voice for about ten minutes, and you see what they said." },
  business: { title: "Hear from your customers in California", body: "Write your questions and choose what people fill in. Share your link with your customers; our interviewer talks with each person by voice for about ten minutes, and you see what they said." },
} as const;

async function Content({ searchParams }: PageProps<"/interview/studies/new">) {
  const { kind: raw, draft: encoded } = await searchParams;
  // A draft from Ask only prefills the form (validated, length-capped); nothing is saved until the person submits.
  const draft = decodeStudyDraft(encoded);
  const kind = draft?.sponsor_kind ?? (raw === "business" ? "business" : "government");
  return (
    <Page narrow>
      <PageTitle title={COPY[kind].title}>{COPY[kind].body} Starting at {dollars(STUDY_SIZES[0].cents)} for {STUDY_SIZES[0].interviews} interviews.</PageTitle>
      {draft ? <p className="text-sm text-muted-foreground">Prefilled from your Ask draft. Add your organization, then review and edit before you continue.</p> : null}
      <StudyForm action={saveStudy} kind={kind} draft={draft} />
    </Page>
  );
}

export default function NewStudy(props: PageProps<"/interview/studies/new">) {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content {...props} /></Suspense>;
}
