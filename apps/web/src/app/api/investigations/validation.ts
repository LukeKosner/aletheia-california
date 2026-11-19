import { bannedPhrase } from "@aletheia/tools";
import { InvalidDraft, parseStudyDraft } from "../../../lib/interview/study-draft";
import { TYPES, isCited, type Answer, type Claim, type InvestigationInput, type Sentence, type TargetedType } from "./contract";
export const HEADINGS = ["Interviews", "Study", "Findings", "Funding", "Support", "Opposition", "Sources", "Geography", "Lobbying", "Votes", "Recipients", "Jurisdictions", "Disclosed interests", "Limitations", "Context", "Background"] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export class InvestigationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvestigationError("invalid_data", "Expected an object.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new InvestigationError("invalid_data", "Text is missing or too long.");
  return value.trim();
}
export function parseInput(value: unknown): InvestigationInput {
  const v = object(value), question = text(v.question, 2000);
  if (!TYPES.includes(v.type as never)) throw new InvestigationError("invalid_type", "Choose an investigation type.");
  if (/\b(home address|phone number|social security|private person|my neighbor|my neighbour|family members?|personal contact)\b/iu.test(question)) {
    throw new InvestigationError("private_person", "Investigations cover public institutional activity, not private-person information.");
  }
  // A general question carries no target; any supplied target is ignored, never forwarded.
  if (v.type === "general") return { question, type: "general" };
  const target = object(v.target);
  if (v.type === "bill") {
    const bill = text(target.bill_id, 100).toUpperCase().replace(/\s+/gu, " ");
    if (!/^(AB|SB|ACA|SCA|ACR|SCR|AJR|SJR|HR|SR) \d{1,5}(?: \(\d{4}-\d{4}\))?$/u.test(bill)) throw new InvestigationError("invalid_target", "Use a California bill identifier.");
    return { question, type: v.type, target: { bill_id: bill } };
  }
  const id = text(target.entity_id, 36);
  if (!UUID.test(id)) throw new InvestigationError("invalid_target", "Choose a public entity from the records.");
  return { question, type: v.type as TargetedType, target: { entity_id: id.toLowerCase() } };
}
/** A web source link: public HTTPS only, no embedded credentials, bounded length. */
export function webSource(value: unknown): { url: string; title: string } {
  const v = object(value), raw = text(v.url, 2000), title = text(v.title, 200);
  let url: URL;
  try { url = new URL(raw); } catch { throw new InvestigationError("invalid_answer", "A web source needs a valid link.", 502); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new InvestigationError("invalid_answer", "Web sources must be public HTTPS links.", 502);
  // Page titles are third-party text; one that uses banned wording is shown as its domain instead.
  return { url: url.href, title: bannedPhrase(title) ? url.hostname : title };
}
/**
 * Each sentence carries exactly one of: a recorded claim_id (verified record), a web source (labeled, not verified),
 * or `insight: true` (a figure from Aletheia's own public voter interviews via interview_insights).
 */
function parseSentence(value: unknown): Sentence {
  const item = object(value), sentenceText = text(item.text);
  if (bannedPhrase(sentenceText)) throw new InvestigationError("invalid_answer", "Every sentence must use neutral language.", 502);
  const present = (x: unknown) => x !== undefined && x !== null && x !== false;
  const hasClaim = present(item.claim_id), hasSource = present(item.source), hasInsight = present(item.insight);
  if (Number(hasClaim) + Number(hasSource) + Number(hasInsight) !== 1) throw new InvestigationError("invalid_answer", "Every neutral sentence needs a citation.", 502);
  if (hasInsight) {
    if (item.insight !== true) throw new InvestigationError("invalid_answer", "An interview sentence sets insight to true.", 502);
    return { text: sentenceText, insight: true };
  }
  if (hasSource) return { text: sentenceText, source: webSource(item.source) };
  const claimId = text(item.claim_id, 36);
  if (!UUID.test(claimId)) throw new InvestigationError("invalid_answer", "Every neutral sentence needs a citation.", 502);
  return { text: sentenceText, claim_id: claimId };
}
export function parseAnswer(value: unknown): Answer {
  const v = object(value), card = object(v.card);
  if (typeof v.summary !== "string" || v.summary.length > 1000 || !Array.isArray(v.sections) || v.sections.length > 20) throw new InvestigationError("invalid_answer", "The answer has an invalid structure.", 502);
  const sections = v.sections.map((section) => {
    const s = object(section), heading = text(s.heading, 120);
    if (!HEADINGS.includes(heading as never)) throw new InvestigationError("invalid_answer", "Section headings must be neutral labels.", 502);
    if (!Array.isArray(s.sentences) || s.sentences.length > 100) throw new InvestigationError("invalid_answer", "The answer has invalid sentences.", 502);
    const sentences = s.sentences.map(parseSentence);
    return { heading, sentences };
  });
  const sentences = sections.flatMap((s) => s.sentences), ids = new Set(sentences.filter(isCited).map((s) => s.claim_id));
  if (sentences.length > 100 || (v.summary !== "" && !sentences.some((s) => s.text === v.summary))) throw new InvestigationError("invalid_answer", "The summary must reuse a cited sentence.", 502);
  const title = text(card.title, 120);
  if (!sections.some((s) => s.heading === title) || !Array.isArray(card.claim_ids) || card.claim_ids.some((id) => typeof id !== "string" || !ids.has(id))) throw new InvestigationError("invalid_answer", "The card must reuse cited findings.", 502);
  const answer: Answer = { summary: v.summary, sections, card: { title, claim_ids: card.claim_ids as string[] } };
  if (v.study !== undefined && v.study !== null) {
    try { answer.study = parseStudyDraft(v.study); }
    catch (error) { throw new InvestigationError("invalid_answer", error instanceof InvalidDraft ? error.message : "The study draft is invalid.", 502); }
  }
  return answer;
}
export function validateClaims(answer: Answer, claims: Claim[]): void {
  const byId = new Map(claims.map((c) => [c.claim_id, c]));
  // Web-sourced sentences carry no claim; only recorded-claim sentences are checked against this investigation's rows.
  for (const sentence of answer.sections.flatMap((s) => s.sentences).filter(isCited)) {
    const claim = byId.get(sentence.claim_id);
    if (!claim || claim.text !== sentence.text || !claim.edge_ids.length) throw new InvestigationError("invalid_citation", "A sentence does not match this investigation's recorded evidence.", 502);
  }
}
