import { checkBaseRate, checkIdentity, checkLanguage, checkNumbers, failure, type Context } from "./checks";
import { loadEvidence, UUID } from "./evidence";
import type { Audit, Claim, Dependencies, EvidenceRow, Failure, PendingInvestigation, Sentence, Session, VerificationPlan, VerificationResult } from "./types";
const HEADINGS = new Set(["Findings", "Funding", "Support", "Opposition", "Sources", "Geography", "Lobbying", "Votes", "Recipients", "Jurisdictions", "Disclosed interests", "Limitations"]);
function sessionEqual(a: Session, b: Session): boolean {
  return a.investigation_id === b.investigation_id && a.session_id === b.session_id && a.harness_id === b.harness_id;
}
function sourceMetadata(rows: EvidenceRow[]): NonNullable<Claim["sources"]> {
  return [...new Map(rows.filter((r) => r.record.filing_uuid).map(({ record: r }) => [String(r.filing_uuid), {
    filing_id: String(r.filing_uuid), title: `${r.filing_source ?? "Filing"} ${r.filing_id ?? ""} ${r.form ?? ""}`.trim(), url: typeof r.filing_url === "string" ? r.filing_url : null,
  }])).values()];
}
export async function verifySentence(sentence: Sentence, claim: Claim | undefined, plan: VerificationPlan | undefined, deps: Pick<Dependencies, "tools" | "judge">): Promise<{ failures: Failure[]; verdict: Audit["verdict"]; rows: EvidenceRow[] }> {
  let rows: EvidenceRow[];
  if (!claim || typeof sentence?.text !== "string" || !UUID.test(claim.claim_id) || sentence.claim_id !== claim.claim_id || sentence.text !== claim.text || !sentence.text.trim() || sentence.text.length > 1000) return { failures: [failure("binding", "claim_mismatch", "The sentence must exactly match its recorded claim.")], verdict: "unsupported", rows: [] };
  try { rows = await loadEvidence(claim, deps.tools); }
  catch { return { failures: [failure("binding", "evidence_mismatch", "Cited edges and filing IDs must match complete source rows.")], verdict: "unsupported", rows: [] }; }
  const context: Context = { bases: new Map(), entities: [] };
  // Order is intentional: do not let model confidence bypass a deterministic failure.
  const numbers = await checkNumbers(sentence.text, plan, rows, deps.tools, context);
  if (numbers.length) return { failures: numbers, verdict: "unsupported", rows };
  const identity = await checkIdentity(claim, plan!, rows, deps.tools, context);
  if (identity.length) return { failures: identity, verdict: "unsupported", rows };
  try {
    const assessed = await deps.judge.assess({ sentence: sentence.text, rows: rows.map((r) => ({ ...r, record: {
      ...r.record, _entity_metadata: context.entities, _all_member_roll_calls: [...context.bases.values()],
    } })) });
    if (!["supported", "overstated", "unsupported"].includes(assessed.verdict) || !assessed.reason || !deps.judge.model) throw new Error("invalid verdict");
    if (assessed.verdict !== "supported") return { failures: [failure("model", assessed.verdict, assessed.reason)], verdict: assessed.verdict, rows };
  } catch { return { failures: [failure("model", "model_unavailable", "The independent model check did not complete with confirmed routing.")], verdict: "unsupported", rows }; }
  const base = checkBaseRate(sentence.text, plan!, rows);
  if (base.length) return { failures: base, verdict: "unsupported", rows };
  const language = checkLanguage(sentence.text);
  return { failures: language, verdict: language.length ? "unsupported" : "supported", rows };
}
function validEnvelope(input: PendingInvestigation, session: Session): boolean {
  try {
  if (input.verification_status !== "pending" || input.status !== "completed" || !input.answer || !UUID.test(input.investigation_id) || session.investigation_id !== input.investigation_id || !/^resp_[\w-]+$/u.test(session.response_id) || !session.harness_id || !session.session_id) return false;
  const answer = input.answer, sentences = answer.sections.flatMap((s) => s.sentences), claims = input.claims;
  return sentences.length > 0 && sentences.length <= 100 && claims.length <= 100 && new Set(claims.map((c) => c.claim_id)).size === claims.length &&
    answer.sections.every((s) => HEADINGS.has(s.heading)) && sentences.every((s) => claims.some((c) => c.claim_id === s.claim_id && c.text === s.text)) && (answer.summary === "" || sentences.some((s) => s.text === answer.summary)) &&
    answer.sections.some((s) => s.heading === answer.card.title) && answer.card.claim_ids.every((id) => sentences.some((s) => s.claim_id === id));
  } catch { return false; }
}
/** No persistence or publishing side effects; the host owns lifecycle storage and human approval. */
export async function verifyInvestigation(input: PendingInvestigation, deps: Dependencies): Promise<VerificationResult> {
  if (!validEnvelope(input, deps.session)) return {
    result: { ...input, answer: null, claims: [], verification_status: "failed" }, removed_claim_ids: input.claims.map((c) => c.claim_id),
    audit: input.claims.map((c) => ({ claim_id: c.claim_id, verdict: "unsupported", reasons: [failure("binding", "invalid_envelope", "A completed pending investigation and its existing HarnessRouter session are required.")], attempts: 0, verifier_model: null })),
  };
  const replacements = new Map<string, { sentence: Sentence; claim: Claim }>(), audit: Audit[] = [], removed: string[] = [];
  const originalSession = { ...deps.session };
  let currentSession = { ...originalSession };
  for (const original of input.answer!.sections.flatMap((s) => s.sentences)) {
    // Repeated summary/card references do not create extra repair budgets.
    if (replacements.has(original.claim_id) || removed.includes(original.claim_id)) continue;
    let sentence = original, claim = input.claims.find((c) => c.claim_id === original.claim_id), plan = deps.plans[original.claim_id], attempts = 0;
    let checked = await verifySentence(sentence, claim, plan, deps);
    while (checked.failures.length && claim && deps.repair && attempts < 2) {
      attempts++;
      try {
        const request = { session: { ...currentSession }, sentence: { ...sentence }, claim: structuredClone(claim), failures: structuredClone(checked.failures), retry: attempts as 1 | 2 };
        const repaired = await deps.repair(request);
        if (!sessionEqual(originalSession, repaired.session) || repaired.previous_response_id !== currentSession.response_id || !/^resp_[\w-]+$/u.test(repaired.session.response_id) || repaired.session.response_id === currentSession.response_id || repaired.sentence.claim_id !== repaired.claim.claim_id) throw new Error("session changed");
        currentSession = { ...repaired.session };
        sentence = repaired.sentence; claim = repaired.claim; plan = repaired.plan;
        checked = await verifySentence(sentence, claim, plan, deps);
      } catch {
        checked = { failures: [failure("binding", "repair_session", "Repair must continue the same investigation and HarnessRouter session with a recorded claim.")], verdict: "unsupported", rows: [] };
        break;
      }
    }
    audit.push({ claim_id: original.claim_id, verdict: checked.verdict, reasons: checked.failures, attempts: attempts + 1, verifier_model: checked.verdict === "supported" ? deps.judge.model : null });
    if (checked.failures.length || !claim) { removed.push(original.claim_id); continue; }
    // Provider verdicts/confidence/source URLs from the writer are never used as verification evidence.
    const hasLikely = /\blikely the same donor\b/iu.test(sentence.text);
    replacements.set(original.claim_id, { sentence, claim: { ...claim, verdict: "supported", confidence: hasLikely ? "likely" : "high", verifier_model: deps.judge.model, sources: sourceMetadata(checked.rows) } });
  }
  const sections = input.answer!.sections.map((s) => ({ heading: s.heading, sentences: s.sentences.flatMap((v) => replacements.get(v.claim_id)?.sentence ?? []) })).filter((s) => s.sentences.length);
  const summaryOriginal = input.answer!.sections.flatMap((s) => s.sentences).find((s) => s.text === input.answer!.summary);
  const claims = [...new Map([...replacements.values()].map((v) => [v.claim.claim_id, v.claim])).values()];
  // Duplicate repaired claim IDs cannot silently replace another independently checked sentence.
  if (claims.length !== replacements.size) return { result: { ...input, answer: null, claims: [], verification_status: "failed" }, audit, removed_claim_ids: input.claims.map((c) => c.claim_id) };
  const cardIds = [...new Set(input.answer!.card.claim_ids.flatMap((id) => replacements.get(id)?.claim.claim_id ?? []))];
  return {
    result: { ...input, tokens: null, cost_usd: null, verification_status: claims.length === 0 ? "failed" : removed.length ? "partial" : "verified", claims,
      answer: claims.length ? { sections, summary: summaryOriginal ? replacements.get(summaryOriginal.claim_id)?.sentence.text ?? "" : "", card: { title: sections.some((s) => s.heading === input.answer!.card.title) ? input.answer!.card.title : sections[0].heading, claim_ids: cardIds } } : null },
    audit, removed_claim_ids: removed,
  };
}
