"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Suggestion } from "@/components/ai-elements/suggestion";

// Example questions, ordered so the first six (shown as chips on the home page) span Ask's abilities: research in
// public records, Aletheia's interview metrics, drafting a study, and general questions. The Prop 40, AB 1018 and
// California Realtors PAC questions are answerable from existing 2026 records (Prop 40 committees and IEs in
// CAL-ACCESS; AB 1018 lobbying reports; California Association of Realtors committees in CAL-ACCESS, e.g. filer
// 1400190, see packages/tools/test/fixtures/export_calaccess_slice.py); the budget question is answered from official
// web sources.
const EXAMPLES = [
  "Who is funding Prop 40?",
  "What issues do voters in Los Angeles County raise most?",
  "Who lobbied on AB 1018?",
  "Set up a study asking renters in San Diego about housing costs",
  "Where does the California Realtors’ PAC money go?",
  "How does California's budget process work?",
];

/**
 * One question box. A link that already names a record (type + target) keeps that
 * investigation type; everything else is a general question. `followUp` is the quieter box under an answer.
 */
export function QuestionForm({ initial, compact = false, followUp = false }: { initial?: { q?: string; type?: string; target?: string }; compact?: boolean; followUp?: boolean }) {
  const router = useRouter();
  const [question, setQuestion] = useState(initial?.q ?? "");
  const pinned = initial?.type && initial?.target ? { type: initial.type, target: initial.target } : null;

  function submit(value: string) {
    const text = value.trim();
    if (!text) return;
    const params = new URLSearchParams({ question: text, type: pinned?.type ?? "general", ...(pinned ? { target: pinned.target } : {}) });
    router.push(`/i/new?${params}`);
  }

  const empty = !question.trim();
  return (
    <div className="flex flex-col gap-4">
      <PromptInput onSubmit={() => submit(question)} className="[&_[data-slot=input-group]]:border-input [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-sm">
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Your question"
            autoFocus={!compact && !followUp}
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={followUp ? "Ask another question" : "What do you want to know about California politics, money, lobbying or what voters say?"}
            className={followUp ? "min-h-12 text-base md:text-base" : compact ? "min-h-28 px-5 pt-4 text-base leading-relaxed md:text-lg" : "min-h-24 text-base md:text-base"}
          />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit aria-label="Ask" disabled={empty} className="rounded-xl">
            <ArrowUp aria-hidden className="size-4" />
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      {followUp || !empty ? null : (
        <ul className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-1"}>
          {(compact ? EXAMPLES.slice(0, 6) : EXAMPLES).map((example) => (
            <li key={example}>
              <Suggestion
                suggestion={example}
                onClick={(value) => { setQuestion(value); submit(value); }}
                variant={compact ? "outline" : "ghost"}
                className={compact ? "h-auto px-3 py-1.5 text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground" : "h-auto w-full justify-start rounded-lg px-3 py-2 text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
