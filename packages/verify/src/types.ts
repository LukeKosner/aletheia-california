/** Structurally compatible with P9; no runtime web/database dependency. */
export type Sentence = { text: string; claim_id: string };
export type Answer = { summary: string; sections: { heading: string; sentences: Sentence[] }[]; card: { title: string; claim_ids: string[] } };
export type Claim = {
  claim_id: string; text: string; edge_ids: string[]; filing_ids: string[];
  verdict: "supported" | "overstated" | "unsupported" | null;
  confidence: "high" | "likely" | null; verifier_model: string | null;
  sources?: { filing_id: string; title: string; url: string | null }[];
};
export type PendingInvestigation = {
  investigation_id: string; question: string; type: "measure" | "bill" | "footprint" | "interests";
  status: string; answer: Answer | null; claims: Claim[]; verification_status: "pending";
  cost_usd: number | null; tokens: number | null;
};
export type VerifiedInvestigation = Omit<PendingInvestigation, "verification_status"> & {
  verification_status: "verified" | "partial" | "failed";
};
export type Check = "binding" | "numbers" | "identity" | "model" | "base_rate" | "language";
export type Failure = { check: Check; code: string; message: string };
export type Verdict = "supported" | "overstated" | "unsupported";
export type QueryResult = { rows: Record<string, unknown>[]; truncated: boolean };
export type EvidenceRow = { id: string; kind: "money" | "lobby" | "vote" | "interest"; record: Record<string, unknown> };
export type RollCallKey = { bill_id: string; vote_date: string; location: string; motion: string };
export type RollCall = RollCallKey & { members: { legislator_entity_id: string; result: string }[]; counts: { aye: number; no: number; nvr: number; total: number } };
export type ReadTools = {
  /** Production adapter delegates only to packages/tools.runQuery (agent_ro, read-only transaction). */
  query(sql: string): Promise<QueryResult>;
  /** No donor/member filter exists on this tool. */
  voteBaseRate(billId: string, motion: string): Promise<{
    bill: { bill_id: string } | null; truncated: boolean;
    roll_calls: { vote_date: string | null; location: string | null; motion: unknown; counts: RollCall["counts"]; members: RollCall["members"] }[];
  }>;
};
/** Plans are untrusted proposals, never SQL or asserted expected totals. UTF-16 offsets bind visible text. */
export type NumericAssertion = {
  start: number; end: number;
  operation: "sum_amount" | "count" | "field" | "vote_aye" | "vote_no" | "vote_nvr" | "vote_total" | "vote_percent_aye";
  edge_ids: string[]; field?: string; roll_call?: RollCallKey;
};
export type NameAssertion = { start: number; end: number; edge_id: string; field: string };
export type VerificationPlan = { numbers: NumericAssertion[]; names?: NameAssertion[] };
export type Judge = {
  model: string;
  /** Only sentence and freshly loaded evidence cross this boundary. No writer messages, tools, or repair history. */
  assess(input: { sentence: string; rows: EvidenceRow[] }): Promise<{ verdict: Verdict; reason: string }>;
};
export type Session = { investigation_id: string; response_id: string; session_id: string; harness_id: string };
export type RepairRequest = { session: Session; sentence: Sentence; claim: Claim; failures: Failure[]; retry: 1 | 2 };
export type RepairResponse = { session: Session; previous_response_id: string; sentence: Sentence; claim: Claim; plan: VerificationPlan };
export type Dependencies = {
  tools: ReadTools; judge: Judge; plans: Record<string, VerificationPlan>; session: Session;
  /** Host must continue the existing HR session, then reload its actual recorded claim through its server store. */
  repair?: (request: RepairRequest) => Promise<RepairResponse>;
};
export type Audit = { claim_id: string; verdict: Verdict; reasons: Failure[]; attempts: number; verifier_model: string | null };
export type VerificationResult = { result: VerifiedInvestigation; audit: Audit[]; removed_claim_ids: string[] };
