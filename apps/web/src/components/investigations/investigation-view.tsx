"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { fromApi, hydrateEvidence, type ApiResult } from "./evidence";
import { consumeStream, savedInvestigationPath } from "./stream";
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Page, PageTitle } from "@/components/gov/ui";
import { ReportPublicationGate } from "@/components/feedback/report-publication-gate";
import { ChainOfThought, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { InvestigationAnswer } from "./answer";
import { QuestionForm } from "./question-form";

// The flow canvas is heavy; load it only for answers that have a map.
const MoneyMapView = dynamic(() => import("./money-map").then((m) => m.MoneyMapView), { ssr: false, loading: () => <div className="h-72 rounded-xl border border-border sm:h-80" /> });
import { recordedInvestigation } from "./recorded";
import type { Investigation, QuestionType } from "./model";

type Progress = { status: string; message: string };

export function InvestigationView({ id, question = "", type = "general", target = "" }: { id: string; question?: string; type?: QuestionType; target?: string }) {
  const recorded = id === recordedInvestigation.investigation_id;
  const [investigation, setInvestigation] = useState<Investigation | null>(recorded ? recordedInvestigation : null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(!recorded);
  const [title, setTitle] = useState(question);
  useEffect(() => {
    if (recorded) return;
    const controller = new AbortController();
    let completed = false;
    let recoveryPath: string | null = id === "new" ? null : `/i/${encodeURIComponent(id)}`;
    async function load() {
      try {
        if (id === "new" && (!question.trim() || (type !== "general" && !target.trim()))) throw new Error("Add a question to start.");
        const response = await fetch(id === "new" ? "/api/investigations" : `/api/investigations/${encodeURIComponent(id)}`, {
          method: id === "new" ? "POST" : "GET", signal: controller.signal,
          ...(id === "new" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, type, ...(type === "general" ? {} : { target: type === "bill" ? { bill_id: target } : { entity_id: target } }) }) } : {}),
        });
        if (response.status === 422) {
          // Scope refusals (private-person or off-topic) carry a short, fixed server message.
          const body = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
          throw new Error(typeof body?.error?.message === "string" ? body.error.message : "This question is outside what Ask covers.");
        }
        if (!response.ok) throw new Error(response.status === 410 ? "This report is unpublished while the team reviews its evidence." : response.status === 401 ? "Team sign-in is required. Sign in again and retry your question." : response.status === 410 ? "This report has been unpublished while it is reviewed." : response.status === 404 ? "This investigation is unavailable. You can open the recorded example or start a new question." : "The investigation could not start. Please try again.");
        if (id === "new") {
          recoveryPath = savedInvestigationPath(response);
          if (!recoveryPath) throw new Error("The service did not return a saved investigation link. Go back home to try again.");
          // Preserve the existing job before reading the stream. Native history
          // updates the URL without navigating away and aborting this request.
          window.history.replaceState(null, "", recoveryPath);
        }
        const acceptResult = (result: ApiResult) => {
          const next = fromApi(result, question);
          if (next) { completed = true; setInvestigation(next);
            void hydrateEvidence(next, result, controller.signal).then((hydrated) => { if (!controller.signal.aborted) setInvestigation(hydrated); }).catch(() => { /* Evidence stays explicitly unavailable. */ });
            window.history.replaceState(null, "", `/i/${encodeURIComponent(next.investigation_id)}`); }
          else {
            if (result.question) setTitle(result.question);
            setProgress((items) => items.at(-1)?.message === "Still working" ? items : [...items, { status: result.status, message: "Still working" }]);
          }
        };
        if (id !== "new") {
          // A saved investigation that is still running: check again every 5 seconds for up to 5 minutes.
          let result = await response.json() as ApiResult;
          acceptResult(result);
          for (let attempt = 0; !completed && ["queued", "running", "validating"].includes(result.status) && attempt < 60; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            if (controller.signal.aborted) return;
            const next = await fetch(`/api/investigations/${encodeURIComponent(id)}`, { signal: controller.signal });
            if (!next.ok) throw new Error("The investigation could not be loaded.");
            result = await next.json() as ApiResult;
            acceptResult(result);
          }
          if (!completed) throw new Error(result.status === "failed" ? "This investigation stopped before it found an answer. Try asking again." : result.status === "incomplete" ? "This question took too long. Try a narrower question." : "This is taking longer than usual. Check back in a few minutes.");
        }
        else await consumeStream(response, controller.signal, (name, data) => {
          if (name === "progress") setProgress((items) => [...items.slice(-49), data as Progress]);
          if (name === "result") acceptResult(data as ApiResult);
          if (name === "error") throw new Error((data as { message: string }).message);
        });
        if (id === "new" && !completed) throw new Error(recoveryPath ? "The stream ended before an answer was ready. Reload this page to recover the saved investigation." : "The stream ended before an answer was ready. Go back home to try again.");
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The investigation could not be loaded."); }
      finally { if (!controller.signal.aborted) setRunning(false); }
    }
    // Start on the next tick: React's development double-mount cancels the first timer before any request is sent,
    // so one question never starts two paid investigations.
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, question, type, target, recorded]);
  // The last few distinct messages, oldest first; repeated status pings collapse into one line.
  const distinct = progress.map((item) => item.message).filter((message, index, all) => message !== all[index - 1]);
  const steps = distinct.length ? distinct.slice(-5) : [running ? (id === "new" ? "Starting" : "Loading the saved answer") : "Stopped"];
  const answer = investigation ? <InvestigationAnswer investigation={investigation} map={investigation.graph ? <MoneyMapView investigation={investigation} inline /> : null} /> : null;
  return (
    <Page narrow>
      <PageTitle title={<span className="break-words">{investigation?.question || title || "Your question"}</span>} />
      {!recorded && (running || progress.length) && !investigation ? (
        <ChainOfThought role="status" aria-live="polite" aria-label="Progress" className="space-y-3">
          {steps.map((message, index) => {
            const current = index === steps.length - 1 && running;
            return (
              <ChainOfThoughtStep key={`${index}-${message}`} status={current ? "active" : "complete"} icon={current ? Loader2 : Check}
                className={cn(index === steps.length - 1 && "[&>div:first-child>div]:hidden", current && "[&>div:first-child>svg]:animate-spin")}
                label={current ? <Shimmer as="span">{message.replace(/\.$/u, "")}</Shimmer> : message.replace(/\.$/u, "")} />
            );
          })}
        </ChainOfThought>
      ) : null}
      {error ? <div role="alert" className="flex flex-col gap-2 rounded-xl border border-border p-4 text-sm"><p>{error}</p><p className="flex gap-4 text-muted-foreground"><Link href="/" className="hover:text-foreground">Ask a new question</Link><Link href="/i/recorded-calaccess-3214397" className="hover:text-foreground">Open the recorded example</Link></p></div> : null}
      {investigation ? recorded ? answer : <ReportPublicationGate key={investigation.investigation_id} investigationId={investigation.investigation_id}>{answer}</ReportPublicationGate> : null}
      {investigation || error ? <div className="print:hidden"><QuestionForm followUp /></div> : null}
    </Page>
  );
}
