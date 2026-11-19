/** Input validation for the interview prototype. Pure functions; tested in parse.test.ts. */
import {
  AGE_RANGES, COUNTIES, ISSUES, LIKELIHOOD, MAX_CUSTOM_FIELDS, MAX_CUSTOM_OPTIONS, MAX_STUDY_QUESTIONS, NOT_ASKED, PARTIES,
  PROFILE_FIELDS, SPONSOR_KINDS, STUDY_SIZES, VOTER_FIELDS, type CustomField, type ProfileField, type SponsorKind, type StudyFields,
} from "./taxonomy";
import { IDENTIFYING } from "./study-draft";

const BANNED = /\b(bought|paid off|corrupt\w*|in the pocket of|bribe\w*|kickbacks?|rigged|puppets?)\b/giu;

export class InvalidInput extends Error {}

function pick<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new InvalidInput(`Choose a ${label}.`);
  return value as T;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

/** Keeps stored summaries in the project's neutral vocabulary. */
export function neutral(text: string): string {
  return text.replace(BANNED, "[removed]");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Form name for a study's custom field, by position. */
export const customFieldName = (i: number) => `custom_${i}`;

/**
 * Reads the start form. Only the fields the study asks for are read; the rest are stored as "Not asked".
 * City or town and custom answers go into `profile`, keyed by their label.
 */
export function parseDemographics(form: { get(name: string): unknown }, fields: StudyFields = VOTER_FIELDS) {
  if (form.get("consent") !== "on") throw new InvalidInput("Please check the box to confirm how your answers are used.");
  const email = clean(form.get("email"), 200).toLowerCase();
  if (!EMAIL.test(email)) throw new InvalidInput("Add an email so we can send your $5.");
  const asks = (f: ProfileField) => fields.standard.includes(f);
  const profile: Record<string, string> = {};
  if (asks("city")) {
    const city = neutral(clean(form.get("city"), 60));
    if (!city) throw new InvalidInput("Add your city or town.");
    profile[PROFILE_FIELDS.city] = city;
  }
  fields.custom.forEach((c, i) => { profile[c.label] = pick(form.get(customFieldName(i)), c.options, c.label.toLowerCase()); });
  return {
    county: asks("county") ? pick(form.get("county"), COUNTIES, "county") : NOT_ASKED,
    ageRange: asks("ageRange") ? pick(form.get("ageRange"), AGE_RANGES, "age range") : NOT_ASKED,
    party: asks("party") ? pick(form.get("party"), PARTIES, "party preference") : NOT_ASKED,
    voteLikelihood: asks("voteLikelihood") ? pick(form.get("voteLikelihood"), LIKELIHOOD, "voting plan") : NOT_ASKED,
    rewardEmail: email,
    profile,
  };
}

export function parseCompletion(value: unknown) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const result = (v.result && typeof v.result === "object" ? v.result : {}) as Record<string, unknown>;
  const list = (x: unknown, max: number) => (Array.isArray(x) ? x : []).map((s) => neutral(clean(s, 300))).filter(Boolean).slice(0, max);
  const transcript = (Array.isArray(v.transcript) ? v.transcript : [])
    .map((line) => (line && typeof line === "object" ? line : {}) as Record<string, unknown>)
    .filter((line) => line.role === "voter" || line.role === "interviewer")
    .map((line) => ({ role: line.role as "voter" | "interviewer", text: clean(line.text, 2000) }))
    .filter((line) => line.text)
    .slice(0, 400);
  return {
    transcript,
    issues: [...new Set((Array.isArray(result.issues) ? result.issues : []).filter((i): i is string => typeof i === "string" && (ISSUES as readonly string[]).includes(i)))].slice(0, 5),
    questions: list(result.questions, 6),
    candidateViews: list(result.candidate_views, 6),
    summary: neutral(clean(result.summary, 1500)) || null,
    details: {
      sources: list(result.sources, 6),
      quotes: list(result.quotes, 3),
      toLeaders: neutral(clean(result.to_leaders, 600)) || null,
    },
    answers: (Array.isArray(result.answers) ? result.answers : [])
      .map((a) => (a && typeof a === "object" ? a : {}) as Record<string, unknown>)
      .map((a) => ({ question: neutral(clean(a.question, 200)), answer: neutral(clean(a.answer, 600)) }))
      .filter((a) => a.question && a.answer)
      .slice(0, MAX_STUDY_QUESTIONS),
  };
}

/**
 * The same neutrality check as an Ask study draft: say what to fix rather than silently editing the sponsor's words.
 * Studies never ask for names, addresses or contact details.
 */
const ONE_BANNED = new RegExp(BANNED.source, "iu");
function studyLine(value: unknown, max: number, what: string): string {
  const text = clean(value, max);
  const banned = text.match(ONE_BANNED)?.[0];
  if (banned) throw new InvalidInput(`Use neutral wording in the ${what}: "${banned}" is not allowed.`);
  if (IDENTIFYING.test(text)) throw new InvalidInput(`The ${what} must not ask for names, addresses or contact details.`);
  return text;
}

export function parseStudy(form: { get(name: string): unknown }) {
  const kind = form.get("sponsorKind");
  if (typeof kind !== "string" || !(kind in SPONSOR_KINDS)) throw new InvalidInput("Choose government or business.");
  const sponsorName = studyLine(form.get("sponsorName"), 80, "organization name");
  const title = studyLine(form.get("title"), 120, "title");
  const goal = studyLine(form.get("goal"), 500, "goal");
  const questions = String(form.get("questions") ?? "").split(/\r?\n/u).map((q, i) => studyLine(q, 200, `question ${i + 1}`)).filter(Boolean);
  if (questions.length > MAX_STUDY_QUESTIONS) throw new InvalidInput(`Keep it to ${MAX_STUDY_QUESTIONS} questions.`);
  if (!sponsorName) throw new InvalidInput("Add your organization's name.");
  if (!title) throw new InvalidInput("Give your study a title.");
  if (!goal) throw new InvalidInput("Say what you want to learn.");
  if (!questions.length) throw new InvalidInput("Add at least one question.");
  const size = STUDY_SIZES.find((x) => String(x.interviews) === String(form.get("interviews") ?? STUDY_SIZES[0].interviews));
  if (!size) throw new InvalidInput("Choose how many interviews.");
  return {
    sponsorKind: kind as SponsorKind, sponsorName, title, goal, questions,
    fields: parseStudyFields(form, kind as SponsorKind), interviewTarget: size.interviews, priceCents: size.cents,
  };
}

/** Builder checkboxes are `field_<key>`; custom fields are `customLabel_<i>` with `customOptions_<i>` (one per line). */
function parseStudyFields(form: { get(name: string): unknown }, kind?: SponsorKind): StudyFields {
  // Public agencies may not use public funds on electioneering, so government studies never ask party or voting plan.
  const electoral: ProfileField[] = kind === "government" ? ["party", "voteLikelihood"] : [];
  const standard = (Object.keys(PROFILE_FIELDS) as ProfileField[]).filter((f) => form.get(`field_${f}`) === "on" && !electoral.includes(f));
  const custom: CustomField[] = [];
  for (let i = 0; i < MAX_CUSTOM_FIELDS; i++) {
    const label = studyLine(form.get(`customLabel_${i}`), 80, `field ${i + 1} label`);
    const options = [...new Set(String(form.get(`customOptions_${i}`) ?? "").split(/\r?\n/u).map((o) => studyLine(o, 80, `field ${i + 1} option`)).filter(Boolean))];
    if (!label && !options.length) continue;
    if (!label) throw new InvalidInput("Give each custom field a label.");
    if (options.length < 2) throw new InvalidInput(`Add at least two choices for "${label}", one per line.`);
    if (options.length > MAX_CUSTOM_OPTIONS) throw new InvalidInput(`Keep "${label}" to ${MAX_CUSTOM_OPTIONS} choices.`);
    if (custom.some((c) => c.label === label) || Object.values(PROFILE_FIELDS).includes(label as never)) throw new InvalidInput(`Use a different label than "${label}".`);
    custom.push({ label, options });
  }
  return { standard, custom };
}
