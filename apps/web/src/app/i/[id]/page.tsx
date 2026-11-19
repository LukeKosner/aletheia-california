import { Suspense } from "react";
import { InvestigationView } from "@/components/investigations/investigation-view";
import type { QuestionType } from "@/components/investigations/model";

async function Content({ params, searchParams }: PageProps<"/i/[id]">) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const question = typeof search.question === "string" ? search.question : "";
  const target = typeof search.target === "string" ? search.target : "";
  const type: QuestionType = ["general", "measure", "bill", "footprint", "interests"].includes(String(search.type)) ? search.type as QuestionType : "general";
  return <InvestigationView id={id} question={question} type={type} target={target} />;
}
export default function Page(props: PageProps<"/i/[id]">) {
  return <Suspense fallback={<p className="p-8" role="status">Loading investigation…</p>}><Content {...props} /></Suspense>;
}
