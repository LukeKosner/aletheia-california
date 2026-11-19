import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { decodeStudyDraft, studyDraftHref, type StudyDraft } from "@/lib/interview/study-draft";
import { dollars, PROFILE_FIELDS, SPONSOR_KINDS, STUDY_SIZES } from "@/lib/interview/taxonomy";

/**
 * A study the Ask agent drafted. Nothing is saved: the button opens the study builder prefilled, and the person
 * reviews, edits and submits it there.
 */
export function StudyDraftCard({ draft }: { draft: StudyDraft }) {
  const href = studyDraftHref(draft);
  // The link must survive the builder's own checks; if it would not, the builder opens with only the kind.
  const link = decodeStudyDraft(new URL(href, "https://x").searchParams.get("draft")) ? href : `/interview/studies/new?kind=${draft.sponsor_kind}`;
  const fields = [...(draft.fields?.standard ?? []).map((f) => PROFILE_FIELDS[f]), ...(draft.fields?.custom ?? []).map((c) => `${c.label} (${c.options.join(", ")})`)];
  const size = STUDY_SIZES.find((s) => s.interviews === draft.size);
  return (
    <Card aria-label="Study draft">
      <CardHeader>
        <CardDescription>Study draft · {SPONSOR_KINDS[draft.sponsor_kind]}</CardDescription>
        <CardTitle className="text-lg">{draft.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p>{draft.goal}</p>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Questions</h3>
          <ol className="list-decimal space-y-1 pl-5">{draft.questions.map((q) => <li key={q}>{q}</li>)}</ol>
        </div>
        {fields.length ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">What people fill in first</h3>
            <p>{fields.join(" · ")}</p>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3">
        <Button nativeButton={false} render={<Link href={link} />}>Set up this study</Button>
        <span className="text-xs text-muted-foreground">
          {size ? `${size.interviews} interviews · ${dollars(size.cents)}` : `Starting at ${dollars(STUDY_SIZES[0].cents)}`}. You review and edit everything before saving.
        </span>
      </CardFooter>
    </Card>
  );
}
