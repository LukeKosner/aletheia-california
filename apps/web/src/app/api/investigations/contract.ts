/** Shared browser/server contract. No secrets, database client or runtime imports. */
import type { StudyDraft } from "../../../lib/interview/study-draft";
export const TYPES = ["measure", "bill", "footprint", "interests", "general"] as const;
export type InvestigationType = (typeof TYPES)[number];
/** Types that investigate one server-validated record. "general" takes only a question; its harness picks public targets itself. */
export type TargetedType = Exclude<InvestigationType, "general">;
export type InvestigationInput =
  | { question: string; type: TargetedType; target: { entity_id: string } | { bill_id: string } }
  | { question: string; type: "general" };
/** A web page the ask agent read. A link, not a verified record: Aletheia has not checked it against a filing. */
export type WebSource = { url: string; title: string };
/**
 * Exactly one of: a claim recorded by cite() against public filing evidence, a labeled web source, or a figure from
 * Aletheia's own public voter interviews (interview_insights; links to /interview/insights, not a filing).
 */
export type CitedSentence = { text: string; claim_id: string; source?: undefined; insight?: undefined };
export type WebSentence = { text: string; source: WebSource; claim_id?: undefined; insight?: undefined };
export type InsightSentence = { text: string; insight: true; claim_id?: undefined; source?: undefined };
export type Sentence = CitedSentence | WebSentence | InsightSentence;
export const isCited = (sentence: Sentence): sentence is CitedSentence => typeof sentence.claim_id === "string";
export const isInsight = (sentence: Sentence): sentence is InsightSentence => sentence.insight === true;
/** Where an insight sentence's figures can be checked. */
export const INSIGHTS_PAGE = "/interview/insights";

/**
 * A study the Ask agent drafted for a sponsor. A draft only: nothing is saved until a person reviews it in the study
 * builder (/interview/studies/new) and submits the form. Validated by parseStudyDraft.
 */
export type { StudyDraft };
export type Answer = { summary: string; sections: { heading: string; sentences: Sentence[] }[]; card: { title: string; claim_ids: string[] }; study?: StudyDraft };
/** `title` is the raw registry label; the optional fields are its plain-English description for display. */
export type FilingSource = {
  filing_id: string; title: string; url: string | null;
  kind?: string; filer?: string; period?: string | null; filed?: string | null; filedAt?: string | null; periodStart?: string | null; host?: string;
};
export type Claim = {
  claim_id: string; text: string; edge_ids: string[]; filing_ids: string[];
  verdict: "supported" | "overstated" | "unsupported" | null;
  confidence: "high" | "likely" | null; verifier_model: string | null; sources?: FilingSource[];
};
export type InvestigationResult = {
  investigation_id: string; question: string; type: InvestigationType; status: string;
  answer: Answer | null; claims: Claim[]; verification_status: "pending";
  cost_usd: number | null; tokens: number | null;
};
export type InvestigationEvent =
  | { event: "progress"; data: { investigation_id: string; status: string; message: string } }
  | { event: "result"; data: InvestigationResult }
  | { event: "error"; data: { code: string; message: string; investigation_id?: string } };
