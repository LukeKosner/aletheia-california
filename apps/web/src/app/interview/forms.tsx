"use client";
import { useActionState, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { customFieldName } from "@/lib/interview/parse";
import {
  AGE_RANGES, COUNTIES, DEFAULT_STUDY_FIELDS, dollars, LIKELIHOOD, MAX_CUSTOM_FIELDS, MAX_CUSTOM_OPTIONS, PARTIES, PROFILE_FIELDS,
  REWARD_CENTS, STUDY_SIZES, VOTER_FIELDS, type ProfileField, type StudyFields,
} from "@/lib/interview/taxonomy";
import type { StudyDraft } from "@/lib/interview/study-draft";
import type { ActionState } from "./actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

function Choice({ name, label, options, defaultValue = "" }: { name: string; label: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <NativeSelect id={name} name={name} required defaultValue={options.includes(defaultValue) ? defaultValue : ""} className="w-full">
        <NativeSelectOption value="" disabled>Choose</NativeSelectOption>
        {options.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
  );
}

function Message({ state }: { state: ActionState }) {
  if (state?.error) return <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>;
  if (state?.notice) return <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>;
  return null;
}

/** Placeholders start with "e.g." so they read as examples, not prefilled answers. */
const STUDY_HINTS = {
  government: { name: "e.g. City planning department", title: "e.g. Housing ideas for downtown", goal: "e.g. Which housing ideas residents support, and why.", questions: "e.g. What makes housing hard to find here?\nWhat do you think about taller buildings near transit?\nWhat should the city do first?" },
  business: { name: "Your company’s name", title: "e.g. Why customers choose a provider", goal: "e.g. What customers weigh when they pick a provider, and what would make them switch.", questions: "e.g. How did you choose the provider you use today?\nWhat would make you consider switching?\nWhat is missing from the options you have now?" },
} as const;

const FIELD_NOTES: Record<ProfileField, string> = {
  county: "One of California's 58 counties.",
  ageRange: "18-24 through 65+.",
  party: "Party preference from the voter registration form.",
  voteLikelihood: "Whether they plan to vote.",
  city: "Typed in. No street addresses.",
};

/**
 * A government or business sets up the study Aletheia will run for them. `draft` (from Ask, already validated) only
 * prefills the fields; the person reviews and submits the form themselves.
 */
export function StudyForm({ action, kind, draft }: { action: Action; kind: keyof typeof STUDY_HINTS; draft?: StudyDraft | null }) {
  const [state, submit, pending] = useActionState(action, undefined);
  const hint = STUDY_HINTS[kind];
  const standard = draft?.fields ? draft.fields.standard : DEFAULT_STUDY_FIELDS.standard;
  const custom = draft?.fields?.custom ?? [];
  // One blank row to start; more on request, so the form stays short.
  const [customCount, setCustomCount] = useState(Math.min(MAX_CUSTOM_FIELDS, Math.max(1, custom.length)));
  return (
    <form action={submit}>
      <input type="hidden" name="sponsorKind" value={kind} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sponsorName">Organization</FieldLabel>
          <Input id="sponsorName" name="sponsorName" required maxLength={80} placeholder={hint.name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="title">Study title</FieldLabel>
          <Input id="title" name="title" required maxLength={120} placeholder={hint.title} defaultValue={draft?.title} />
        </Field>
        <Field>
          <FieldLabel htmlFor="goal">What do you want to learn?</FieldLabel>
          <Textarea id="goal" name="goal" required maxLength={500} rows={2} className="min-h-0" placeholder={hint.goal} defaultValue={draft?.goal} />
        </Field>
        <Field>
          <FieldLabel htmlFor="questions">Questions, one per line</FieldLabel>
          <Textarea id="questions" name="questions" required rows={3} className="min-h-0" placeholder={hint.questions} defaultValue={draft?.questions.join("\n")} />
          <FieldDescription>Up to six. The interviewer asks up to two follow-ups on each. Each interview takes about ten minutes.</FieldDescription>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">What people fill in first</FieldLegend>
          <FieldDescription>Answers are shared only with you, never published. We never ask for names or addresses.</FieldDescription>
          <FieldGroup data-slot="checkbox-group" className="gap-3">
            {(Object.keys(PROFILE_FIELDS) as ProfileField[]).map((f) => (
              <Field key={f} orientation="horizontal">
                <Checkbox id={`field_${f}`} name={`field_${f}`} value="on" defaultChecked={standard.includes(f)} />
                <FieldContent>
                  <FieldLabel htmlFor={`field_${f}`} className="font-normal">{PROFILE_FIELDS[f]}</FieldLabel>
                  <FieldDescription>{FIELD_NOTES[f]}</FieldDescription>
                </FieldContent>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Multiple-choice questions (optional)</FieldLegend>
          <FieldDescription>Asked with the fields above, before the interview. Up to {MAX_CUSTOM_FIELDS}, each with 2 to {MAX_CUSTOM_OPTIONS} choices.</FieldDescription>
          {Array.from({ length: customCount }, (_, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`customLabel_${i}`}>Question</FieldLabel>
                <Input id={`customLabel_${i}`} name={`customLabel_${i}`} maxLength={80} placeholder={i === 0 ? "e.g. Do you rent or own your home?" : undefined} defaultValue={custom[i]?.label} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`customOptions_${i}`}>Choices, one per line</FieldLabel>
                <Textarea id={`customOptions_${i}`} name={`customOptions_${i}`} rows={3} className="min-h-0" placeholder={i === 0 ? "e.g. Rent\nOwn\nOther" : undefined} defaultValue={custom[i]?.options.join("\n")} />
              </Field>
            </div>
          ))}
          {customCount < MAX_CUSTOM_FIELDS ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setCustomCount((n) => n + 1)}>Add another question</Button>
          ) : null}
        </FieldSet>

        <Field>
          <FieldLabel htmlFor="interviews">Number of interviews</FieldLabel>
          <NativeSelect id="interviews" name="interviews" defaultValue={String(draft?.size ?? STUDY_SIZES[0].interviews)} className="w-full">
            {STUDY_SIZES.map((x) => <NativeSelectOption key={x.interviews} value={String(x.interviews)}>{x.interviews} interviews · {dollars(x.cents)}</NativeSelectOption>)}
          </NativeSelect>
          <FieldDescription>You pay when you launch. Each person interviewed gets {dollars(REWARD_CENTS)}.</FieldDescription>
        </Field>

        <Message state={state} />
        <Button type="submit" size="lg" disabled={pending} className="w-fit">{pending ? "Saving…" : "Continue"}</Button>
      </FieldGroup>
    </form>
  );
}

const CONSENT_NAMES: Record<ProfileField, string> = {
  county: "county", ageRange: "age range", party: "party", voteLikelihood: "voting plan", city: "city or town",
};

/**
 * Consent names only what this form asks, and says where it goes: the general interview is published without names;
 * a study is shared with its sponsor and not published. Transcripts are never published.
 */
function consentText(fields: StudyFields, sponsor?: string): string {
  const parts = ["answers", ...fields.standard.map((f) => CONSENT_NAMES[f]), ...(fields.custom.length ? ["other choices above"] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return sponsor
    ? `I understand my ${list} will be shared with ${sponsor}, not published. My email and transcript stay private.`
    : `I understand my ${list} will be published without my name. My email and transcript stay private.`;
}

/** The interviewee's form. A study shows only the fields its sponsor chose; the general interview asks all four. */
/** Answers carried over from the voter's general interview when they take a follow-on study. Consent is never carried. */
export type StartDefaults = { county?: string; ageRange?: string; party?: string; voteLikelihood?: string; email?: string };

export function StartForm({ action, studyId, sponsor, fields = VOTER_FIELDS, defaults = {} }: { action: Action; studyId?: string; sponsor?: string; fields?: StudyFields; defaults?: StartDefaults }) {
  const [state, submit, pending] = useActionState(action, undefined);
  const asks = (f: ProfileField) => fields.standard.includes(f);
  return (
    <form action={submit}>
      {studyId ? <input type="hidden" name="studyId" value={studyId} /> : null}
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          {asks("county") ? <Choice name="county" label="County" options={COUNTIES} defaultValue={defaults.county} /> : null}
          {asks("ageRange") ? <Choice name="ageRange" label="Age" options={AGE_RANGES} defaultValue={defaults.ageRange} /> : null}
          {asks("party") ? <Choice name="party" label="Party" options={PARTIES} defaultValue={defaults.party} /> : null}
          {asks("voteLikelihood") ? <Choice name="voteLikelihood" label="Will you vote?" options={LIKELIHOOD} defaultValue={defaults.voteLikelihood} /> : null}
          {asks("city") ? (
            <Field>
              <FieldLabel htmlFor="city">City or town</FieldLabel>
              <Input id="city" name="city" required maxLength={60} autoComplete="address-level2" />
            </Field>
          ) : null}
          {fields.custom.map((c, i) => <Choice key={c.label} name={customFieldName(i)} label={c.label} options={c.options} />)}
        </div>
        <Field>
          <FieldLabel htmlFor="email">Email for your {dollars(REWARD_CENTS)}</FieldLabel>
          <Input id="email" name="email" type="email" required maxLength={200} autoComplete="email" placeholder="you@example.com" defaultValue={defaults.email} />
          <FieldDescription>Only used to pay you. Never shown.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="consent" name="consent" value="on" required />
          <FieldLabel htmlFor="consent" className="font-normal">{consentText(fields, studyId ? sponsor : undefined)}</FieldLabel>
        </Field>
        <Message state={state} />
        <Button type="submit" size="lg" disabled={pending} className="w-fit">{pending ? "Starting…" : "Start interview"}</Button>
      </FieldGroup>
    </form>
  );
}

/** A one-button form for a server action, with optional hidden fields and extra inputs. */
export function ActionForm({ action, label, pendingLabel, hidden = {}, children, variant = "default" }: {
  action: Action; label: string; pendingLabel?: string; hidden?: Record<string, string>; children?: ReactNode;
  variant?: "default" | "outline" | "secondary";
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  return (
    <form action={submit} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <Button type="submit" variant={variant} disabled={pending}>{pending ? pendingLabel ?? "Working…" : label}</Button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function TextField({ name, label, type = "text", defaultValue, placeholder, className }: {
  name: string; label: string; type?: "text" | "number"; defaultValue?: string; placeholder?: string; className?: string;
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} placeholder={placeholder}
        {...(type === "number" ? { min: 1, max: 1000, step: 1 } : { maxLength: 120 })} />
    </Field>
  );
}
