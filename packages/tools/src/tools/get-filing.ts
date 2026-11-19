import { readOnly, TEXT_DATES, type ToolsDb } from "../db";
import { untrusted, type UntrustedText } from "../untrusted";

export const FILING_MAX_ITEMS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface FilingInfo {
  filing_uuid: string;
  source: string | null;
  filing_id: string | null;
  amendment_no: number | null;
  form: string | null;
  filed_at: string | null;
  period_start: string | null;
  period_end: string | null;
  url: string | null;
}

export interface FilingItem {
  edge_id: string;
  schedule: string | null;
  line_item: string | null;
  kind: string;
  amount: string;
  date: string | null;
  from_entity_id: string;
  from_name: UntrustedText | null;
  to_entity_id: string;
  to_name: UntrustedText | null;
}

export interface FilingResult {
  filings: FilingInfo[];
  items: FilingItem[];
  item_count: number;
  truncated: boolean;
  lobby_activity_ids: string[];
  /** Employer and lobbying firm on each lobbying line (distinct pairs), so a lobbying report can be named. */
  lobby_parties: { employer_name: UntrustedText | null; firm_name: UntrustedText | null }[];
  interest_ids: string[];
}

/**
 * A filing by its uuid (`filing_uuid` / `money_edge.filing_id`) or by the source's own filing id (for CAL-ACCESS the
 * number in the PDF URL). Returns form, dates, URL and every itemized line on it: schedule, line, amount, parties.
 * Agents only see filings through the views, so a filing with no money, lobbying or Form 700 rows is not found.
 */
export async function getFiling(db: ToolsDb, filingId: string): Promise<FilingResult> {
  const id = filingId.trim();
  if (!id) throw new Error("filing_id is empty");
  const byUuid = UUID.test(id);
  const col = byUuid ? "filing_uuid" : "filing_id";
  const param = byUuid ? id.toLowerCase() : id;

  return readOnly(db, async (tx) => {
    const filings = await tx.unsafe<FilingInfo[]>(
      `
      select distinct on (filing_uuid) filing_uuid, source, filing_id, amendment_no, form, filed_at, period_start,
             period_end, url
      from (
        select filing_uuid, filing_source as source, filing_id, amendment_no, form, filed_at, period_start, period_end,
               filing_url as url
        from v_money where ${col} = $1
        union all
        select filing_uuid, filing_source, filing_id, amendment_no, form, filed_at, period_start, period_end, filing_url
        from v_lobby where ${col} = $1
        union all
        select filing_uuid, filing_source, filing_id, amendment_no, form, filed_at, null::date, null::date, filing_url
        from v_interests where ${col} = $1
      ) f
      where filing_uuid is not null
      order by filing_uuid, period_start nulls last
      `,
      [param],
    ).parsers(TEXT_DATES);
    if (filings.length === 0) {
      return { filings: [], items: [], item_count: 0, truncated: false, lobby_activity_ids: [], lobby_parties: [], interest_ids: [] };
    }
    const uuids = filings.map((f) => f.filing_uuid);
    const items = await tx<(Omit<FilingItem, "from_name" | "to_name"> & { from_name: string; to_name: string })[]>`
      select edge_id, schedule, line_item, kind::text as kind, amount::text as amount, date,
             from_entity_id, from_name, to_entity_id, to_name
      from v_money where filing_uuid = any(${uuids}::uuid[])
      order by schedule, length(line_item), line_item, edge_id
      limit ${FILING_MAX_ITEMS + 1}
    `.parsers(TEXT_DATES);
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from v_money where filing_uuid = any(${uuids}::uuid[])
    `;
    const lobby = await tx<{ id: string }[]>`
      select activity_id as id from v_lobby where filing_uuid = any(${uuids}::uuid[]) limit ${FILING_MAX_ITEMS}
    `;
    const parties = await tx<{ employer_name: string | null; firm_name: string | null }[]>`
      select distinct employer_name, firm_name from v_lobby where filing_uuid = any(${uuids}::uuid[]) limit 50
    `;
    const interests = await tx<{ id: string }[]>`
      select interest_id as id from v_interests where filing_uuid = any(${uuids}::uuid[]) limit ${FILING_MAX_ITEMS}
    `;
    return {
      filings: [...filings],
      items: items.slice(0, FILING_MAX_ITEMS).map((i) => ({
        ...i,
        from_name: untrusted(i.from_name),
        to_name: untrusted(i.to_name),
      })),
      item_count: n,
      truncated: n > FILING_MAX_ITEMS,
      lobby_activity_ids: lobby.map((r) => r.id),
      lobby_parties: parties.map((r) => ({ employer_name: untrusted(r.employer_name), firm_name: untrusted(r.firm_name) })),
      interest_ids: interests.map((r) => r.id),
    };
  });
}
