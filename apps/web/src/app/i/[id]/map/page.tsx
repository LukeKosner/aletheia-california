import { Suspense } from "react";
import { ReportPublicationGate } from "@/components/feedback/report-publication-gate";
import { recordedInvestigation } from "@/components/investigations/recorded";
import { MoneyMap } from "@/components/investigations/money-map";
async function Content({ params }: PageProps<"/i/[id]/map">) { const { id } = await params; return id === recordedInvestigation.investigation_id ? <MoneyMap id={id}/> : <ReportPublicationGate key={id} investigationId={id}><MoneyMap id={id}/></ReportPublicationGate>; }
export default function Page(props: PageProps<"/i/[id]/map">) { return <Suspense fallback={<p role="status" className="p-8">Loading map…</p>}><Content {...props}/></Suspense>; }
