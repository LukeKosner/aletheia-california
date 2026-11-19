/**
 * A study drafted by the Ask agent. Pure and browser-safe: it validates the draft and carries it to the study builder
 * in one URL parameter. Nothing here saves anything; a person reviews the builder form and submits it.
 */
import { MAX_CUSTOM_FIELDS, MAX_CUSTOM_OPTIONS, MAX_STUDY_QUESTIONS, PROFILE_FIELDS, SPONSOR_KINDS, STUDY_SIZES, type ProfileField, type SponsorKind } from "./taxonomy";

export type StudyDraft = {
  sponsor_kind: SponsorKind;
  title: string;
  goal: string;
  questions: string[];
  fields?: { standard: ProfileField[]; custom?: { label: string; options: string[] }[] };
  size?: (typeof STUDY_SIZES)[number]["interviews"];
};

export class InvalidDraft extends Error {}

/** Same lengths as the study builder (parse.ts parseStudy). */
export const DRAFT_LIMITS = { title: 120, goal: 500, question: 200, label: 80, option: 80, encoded: 8000 } as const;

export const BANNED = /\b(bought|paid off|corrupt\w*|in the pocket of|bribe\w*|kickbacks?|rigged|puppets?)\b/iu;
/** Studies never ask for identifying details. */
export const IDENTIFYING = /\b(your (full |first |last )?name|home address|street address|mailing address|phone number|email address|social security|date of birth|driver'?s license)\b/iu;

function line(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") throw new InvalidDraft(`The study ${what} is missing.`);
  const text = value.replace(/\s+/gu, " ").trim();
  if (!text || text.length > max) throw new InvalidDraft(`The study ${what} is missing or too long.`);
  if (BANNED.test(text)) throw new InvalidDraft(`The study ${what} must use neutral language.`);
  if (IDENTIFYING.test(text)) throw new InvalidDraft(`The study ${what} must not ask for names, addresses or contact details.`);
  return text;
}

function list(value: unknown, min: number, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new InvalidDraft(`The study needs ${min} to ${max} ${what}.`);
  return value;
}

/** Strict: throws InvalidDraft on any unknown field name, bad size, overlong text or banned wording. */
export function parseStudyDraft(value: unknown): StudyDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidDraft("The study draft is not an object.");
  const v = value as Record<string, unknown>;
  if (typeof v.sponsor_kind !== "string" || !(v.sponsor_kind in SPONSOR_KINDS)) throw new InvalidDraft("The study needs sponsor_kind business or government.");
  const draft: StudyDraft = {
    sponsor_kind: v.sponsor_kind as SponsorKind,
    title: line(v.title, DRAFT_LIMITS.title, "title"),
    goal: line(v.goal, DRAFT_LIMITS.goal, "goal"),
    questions: list(v.questions, 1, MAX_STUDY_QUESTIONS, "questions").map((q) => line(q, DRAFT_LIMITS.question, "question")),
  };
  if (new Set(draft.questions.map((q) => q.toLowerCase())).size !== draft.questions.length) throw new InvalidDraft("The study repeats a question.");
  if (v.size !== undefined && v.size !== null) {
    const size = STUDY_SIZES.find((s) => s.interviews === v.size);
    if (!size) throw new InvalidDraft(`The study size must be one of ${STUDY_SIZES.map((s) => s.interviews).join(", ")}.`);
    draft.size = size.interviews;
  }
  if (v.fields !== undefined && v.fields !== null) {
    if (typeof v.fields !== "object" || Array.isArray(v.fields)) throw new InvalidDraft("The study fields are not an object.");
    const f = v.fields as Record<string, unknown>;
    const standard = list(f.standard ?? [], 0, Object.keys(PROFILE_FIELDS).length, "standard fields").map((name) => {
      if (typeof name !== "string" || !(name in PROFILE_FIELDS)) throw new InvalidDraft(`Standard fields must be from: ${Object.keys(PROFILE_FIELDS).join(", ")}.`);
      return name as ProfileField;
    });
    if (new Set(standard).size !== standard.length) throw new InvalidDraft("The study repeats a standard field.");
    const custom = list(f.custom ?? [], 0, MAX_CUSTOM_FIELDS, "custom fields").map((c) => {
      if (!c || typeof c !== "object") throw new InvalidDraft("A custom field is not an object.");
      const field = c as Record<string, unknown>;
      const label = line(field.label, DRAFT_LIMITS.label, "custom field label");
      const options = list(field.options, 2, MAX_CUSTOM_OPTIONS, "choices per custom field").map((o) => line(o, DRAFT_LIMITS.option, "custom field choice"));
      if (new Set(options).size !== options.length) throw new InvalidDraft(`"${label}" repeats a choice.`);
      if ((Object.values(PROFILE_FIELDS) as string[]).includes(label)) throw new InvalidDraft(`"${label}" is already a standard field.`);
      return { label, options };
    });
    if (new Set(custom.map((c) => c.label)).size !== custom.length) throw new InvalidDraft("The study repeats a custom field label.");
    draft.fields = custom.length ? { standard, custom } : { standard };
  }
  return draft;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Link to the study builder, prefilled with the draft. */
export function studyDraftHref(draft: StudyDraft): string {
  return `/interview/studies/new?kind=${draft.sponsor_kind}&draft=${toBase64Url(JSON.stringify(draft))}`;
}

/** Reads the `draft` URL parameter. Anything invalid is ignored (null), so the builder opens empty. */
export function decodeStudyDraft(value: unknown): StudyDraft | null {
  if (typeof value !== "string" || !value || value.length > DRAFT_LIMITS.encoded || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try { return parseStudyDraft(JSON.parse(fromBase64Url(value))); } catch { return null; }
}
