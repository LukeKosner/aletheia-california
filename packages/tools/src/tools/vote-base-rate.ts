import { readOnly, TEXT_DATES, type ToolsDb } from "../db";
import { untrusted, type UntrustedText } from "../untrusted";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const VOTE_MAX_ROWS = 5_000;

/** "SB 329", "sb329", "SB-329" -> "SB-329"; "SBX1 1" -> "SBX1-1" (leginfo's display form, used in bill.measure). */
export function normalizeMeasure(input: string): string | undefined {
  const m = input.trim().toUpperCase().match(/^([A-Z]{2,3}(?:X\d+)?)\s*-?\s*0*(\d{1,5})$/u);
  return m ? `${m[1]}-${Number(m[2])}` : undefined;
}

export interface RollCall {
  vote_date: string | null;
  location: string | null;
  motion: UntrustedText | null;
  counts: { aye: number; no: number; nvr: number; total: number };
  members: { legislator_entity_id: string; name: UntrustedText | null; result: string }[];
}

export interface VoteBaseRateResult {
  bill: { bill_id: string; session: string | null; measure: string | null; title: UntrustedText | null } | null;
  motion_filter: string;
  roll_calls: RollCall[];
  totals: { aye: number; no: number; nvr: number; total: number };
  truncated: boolean;
}

interface Row {
  bill_id: string;
  session: string | null;
  measure: string | null;
  bill_title: string | null;
  vote_date: string | null;
  location: string | null;
  motion: string | null;
  legislator_entity_id: string;
  legislator_name: string | null;
  result: "aye" | "no" | "nvr";
}

/**
 * How every member voted on a bill's roll calls whose motion contains `motion` (case-insensitive; empty matches all).
 * `bill_id` is the bill uuid or a measure such as "SB 329" (latest session that has votes for it).
 * Roll calls are grouped by date, location and motion.
 */
export async function voteBaseRate(db: ToolsDb, billId: string, motion: string): Promise<VoteBaseRateResult> {
  const id = billId.trim();
  const measure = UUID.test(id) ? undefined : normalizeMeasure(id);
  if (!UUID.test(id) && !measure) throw new Error(`bill_id must be a bill uuid or a measure like "SB 329", got "${id}"`);
  const pattern = `%${motion.trim().replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;

  return readOnly(db, async (tx) => {
    const rows = measure
      ? await tx<Row[]>`
          select bill_id, session, measure, bill_title, vote_date, location, motion, legislator_entity_id,
                 legislator_name, result::text as result
          from v_votes
          where measure = ${measure}
            and session = (select max(session) from v_votes where measure = ${measure})
            and coalesce(motion, '') ilike ${pattern}
          order by vote_date, location, motion, legislator_name
          limit ${VOTE_MAX_ROWS + 1}
        `.parsers(TEXT_DATES)
      : await tx<Row[]>`
          select bill_id, session, measure, bill_title, vote_date, location, motion, legislator_entity_id,
                 legislator_name, result::text as result
          from v_votes
          where bill_id = ${id.toLowerCase()}::uuid and coalesce(motion, '') ilike ${pattern}
          order by vote_date, location, motion, legislator_name
          limit ${VOTE_MAX_ROWS + 1}
        `.parsers(TEXT_DATES);

    const kept = rows.slice(0, VOTE_MAX_ROWS);
    const calls = new Map<string, RollCall>();
    const totals = { aye: 0, no: 0, nvr: 0, total: 0 };
    for (const r of kept) {
      const key = JSON.stringify([r.vote_date, r.location, r.motion]);
      let call = calls.get(key);
      if (!call) {
        call = {
          vote_date: r.vote_date,
          location: r.location,
          motion: untrusted(r.motion),
          counts: { aye: 0, no: 0, nvr: 0, total: 0 },
          members: [],
        };
        calls.set(key, call);
      }
      call.counts[r.result] += 1;
      call.counts.total += 1;
      totals[r.result] += 1;
      totals.total += 1;
      call.members.push({ legislator_entity_id: r.legislator_entity_id, name: untrusted(r.legislator_name), result: r.result });
    }
    const first = kept[0];
    return {
      bill: first
        ? { bill_id: first.bill_id, session: first.session, measure: first.measure, title: untrusted(first.bill_title) }
        : null,
      motion_filter: motion,
      roll_calls: [...calls.values()],
      totals,
      truncated: rows.length > VOTE_MAX_ROWS,
    };
  });
}
