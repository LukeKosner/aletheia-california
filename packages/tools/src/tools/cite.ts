import { randomUUID } from "node:crypto";
import { readOnly, type ToolsDb } from "../db";
import { bannedPhrase } from "../untrusted";

export const CITE_MAX_EDGES = 100;
export const CITE_MAX_SENTENCE = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface CiteResult {
  claim_id: string;
  investigation_id: string;
  edge_ids: string[];
  filing_ids: string[];
}

/**
 * Records a claim: one sentence and the ids of the rows that support it. Ids may be money edges (v_money.edge_id),
 * lobbying rows (v_lobby.activity_id), votes (v_votes.vote_id) or Form 700 interests (v_interests.interest_id).
 * Every id must exist. The filings behind them are stored alongside.
 *
 * The ids are checked through the read-only connection; the insert uses the claim_writer connection, which can only
 * INSERT into claim. The claim id is generated here, so the insert needs no RETURNING (and no SELECT on claim).
 */
export async function cite(
  db: ToolsDb,
  investigationId: string | undefined,
  sentence: string,
  edgeIds: string[],
): Promise<CiteResult> {
  if (!investigationId || !UUID.test(investigationId)) {
    throw new Error("cite needs the investigation id: send the X-Aletheia-Investigation-Id header (a uuid)");
  }
  const text = sentence.trim().replace(/\s+/gu, " ");
  if (!text) throw new Error("sentence is empty");
  if (text.length > CITE_MAX_SENTENCE) throw new Error(`sentence is longer than ${CITE_MAX_SENTENCE} characters`);
  const banned = bannedPhrase(text);
  if (banned) throw new Error(`sentence uses "${banned}"; describe facts, not motive (AGENTS.md rule 10)`);

  const ids = [...new Set(edgeIds.map((e) => e.trim().toLowerCase()))];
  if (ids.length === 0) throw new Error("edge_ids is empty: every claim needs at least one supporting row");
  if (ids.length > CITE_MAX_EDGES) throw new Error(`at most ${CITE_MAX_EDGES} edge_ids`);
  const bad = ids.filter((e) => !UUID.test(e));
  if (bad.length) throw new Error(`not uuids: ${bad.join(", ")}`);

  const found = await readOnly(db, (tx) => tx<{ id: string; filing_uuid: string | null }[]>`
    select edge_id as id, filing_uuid from v_money where edge_id = any(${ids}::uuid[])
    union all select activity_id, filing_uuid from v_lobby where activity_id = any(${ids}::uuid[])
    union all select vote_id, null::uuid from v_votes where vote_id = any(${ids}::uuid[])
    union all select interest_id, filing_uuid from v_interests where interest_id = any(${ids}::uuid[])
  `);
  const known = new Set(found.map((r) => r.id));
  const missing = ids.filter((e) => !known.has(e));
  if (missing.length) throw new Error(`unknown edge_ids (not in v_money, v_lobby, v_votes or v_interests): ${missing.join(", ")}`);
  const filingIds = [...new Set(found.map((r) => r.filing_uuid).filter((f): f is string => !!f))].sort();

  const claimId = randomUUID();
  await db.writer`
    insert into claim (id, investigation_id, sentence, edge_ids, filing_ids)
    values (${claimId}, ${investigationId.toLowerCase()}, ${text}, ${ids}::uuid[], ${filingIds}::uuid[])
  `;
  return { claim_id: claimId, investigation_id: investigationId.toLowerCase(), edge_ids: ids, filing_ids: filingIds };
}
