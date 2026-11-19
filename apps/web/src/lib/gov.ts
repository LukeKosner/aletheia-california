/**
 * Read-only government data for pages. Every query goes through
 * `runQuery` in packages/tools (agent_ro role, read-only transaction,
 * v_* views only). Inputs are validated or quoted before they reach SQL.
 */
import { cacheLife } from "next/cache";
import { runQuery, sharedDb } from "@aletheia/tools";
import { flags } from "./flags";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const isUuid = (value: string) => UUID.test(value);

/** Quote a string literal for a fixed SELECT (standard_conforming_strings is on). */
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** An ILIKE pattern that matches `value` anywhere, with wildcards escaped. */
const contains = (value: string) => lit(`%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/** Database text arrives wrapped as { untrusted_text }. React escapes it on render. */
function text(value: unknown): string {
  if (value && typeof value === "object" && "untrusted_text" in value) return String((value as { untrusted_text: unknown }).untrusted_text ?? "");
  return value == null ? "" : String(value);
}
function json(value: unknown): Record<string, unknown> {
  try { return JSON.parse(text(value)) as Record<string, unknown>; } catch { return {}; }
}

export type Legislator = {
  id: string;
  name: string;
  lastName: string;
  house: "Assembly" | "Senate";
  district: number;
  party: string;
  active: boolean;
  committeeFilerIds: string[];
};

const PARTIES: Record<string, string> = { DEM: "Democrat", REP: "Republican", IND: "Independent" };

function toLegislator(row: Record<string, unknown>): Legislator {
  const attrs = json(row.attrs);
  const party = String(attrs.party ?? "");
  return {
    id: String(row.entity_id),
    name: text(row.name),
    lastName: String(attrs.last_name ?? text(row.name)),
    house: attrs.house === "S" ? "Senate" : "Assembly",
    district: Number(String(attrs.district ?? "").replace(/\D/g, "")) || 0,
    party: PARTIES[party] ?? party,
    active: attrs.active === true,
    committeeFilerIds: Array.isArray(attrs.calaccess_committee_filer_ids) ? attrs.calaccess_committee_filer_ids.map(String).filter((id) => /^\d+$/.test(id)) : [],
  };
}

export async function getLegislators(): Promise<Legislator[]> {
  "use cache";
  cacheLife("hours");
  const result = await runQuery(sharedDb(), "select entity_id, name, attrs from v_entities where kind = 'legislator'");
  return result.rows.map(toLegislator).sort((a, b) => a.house.localeCompare(b.house) || a.district - b.district || a.lastName.localeCompare(b.lastName));
}

export async function getLegislator(id: string): Promise<Legislator | null> {
  if (!isUuid(id)) return null;
  return (await getLegislators()).find((item) => item.id === id) ?? null;
}

export type Committee = { id: string; filerId: string; name: string };

/** The legislator's own campaign committees, as filed with CAL-ACCESS. */
export async function getCommittees(legislator: Legislator): Promise<Committee[]> {
  "use cache";
  cacheLife("hours");
  if (!legislator.committeeFilerIds.length) return [];
  const keys = legislator.committeeFilerIds.map((id) => lit(`calaccess:filer:${id}`)).join(",");
  const result = await runQuery(sharedDb(), `select entity_id, name, canonical_key from v_entities where canonical_key in (${keys})`);
  return result.rows.map((row) => ({ id: String(row.entity_id), filerId: String(row.canonical_key).replace("calaccess:filer:", ""), name: text(row.name) }));
}

export type Contributor = { id: string; name: string; kind: string; total: number; count: number; last: string; url: string | null };
export type Funding = { total: number; donors: number; top: Contributor[] };

/**
 * Contributions reported to a legislator's own campaign committees. One
 * contribution can appear on more than one report (e.g. Form 497 and 460), so
 * lines with the same contributor, date and amount are counted once.
 */
export async function getFunding(legislator: Legislator): Promise<Funding | null> {
  "use cache";
  cacheLife("hours");
  if (!legislator.committeeFilerIds.length) return null;
  const keys = legislator.committeeFilerIds.map((id) => lit(`calaccess:filer:${id}`)).join(",");
  const people = flags.SHOW_INDIVIDUAL_DONORS ? "" : "and from_kind <> 'person'";
  const lines = `select distinct on (from_entity_id, date, amount) from_entity_id, from_name, from_kind, amount::numeric as amount, date, filing_url
    from v_money
    where kind = 'contribution' ${people}
      and to_entity_id in (select entity_id from v_entities where canonical_key in (${keys}))
    order by from_entity_id, date, amount, filed_at desc`;
  const [top, totals] = await Promise.all([
    runQuery(sharedDb(), `select from_entity_id, min(from_name) as name, min(from_kind) as kind, sum(amount) as total, count(*) as n, max(date) as last,
        (array_agg(filing_url order by date desc))[1] as url
      from (${lines}) d group by from_entity_id order by total desc limit 10`),
    runQuery(sharedDb(), `select coalesce(sum(amount), 0) as total, count(distinct from_entity_id) as donors from (${lines}) d`),
  ]);
  return {
    total: Number(totals.rows[0]?.total ?? 0),
    donors: Number(totals.rows[0]?.donors ?? 0),
    top: top.rows.map((row) => ({ id: String(row.from_entity_id), name: text(row.name), kind: text(row.kind), total: Number(row.total), count: Number(row.n), last: String(row.last ?? ""), url: safeUrl(text(row.url)) })),
  };
}

export type Vote = { billId: string; measure: string; session: string; title: string; status: string; date: string; motion: string; location: string; result: "aye" | "no" | "nvr" };

export async function getVotes(legislator: Legislator, topic = ""): Promise<Vote[]> {
  "use cache";
  cacheLife("hours");
  const match = titleMatch(topic.trim().slice(0, 80));
  const filter = match ? `and ${match}` : "";
  const result = await runQuery(sharedDb(), `select bill_id, measure, session, bill_title, bill_status, vote_date, motion, location, result
    from v_votes where legislator_entity_id = ${lit(legislator.id)} ${filter} order by vote_date desc, measure limit 30`);
  return result.rows.map((row) => ({
    billId: String(row.bill_id), measure: String(row.measure), session: String(row.session), title: text(row.bill_title), status: text(row.bill_status),
    date: String(row.vote_date ?? ""), motion: text(row.motion), location: text(row.location), result: row.result === "aye" || row.result === "no" ? row.result : "nvr",
  }));
}

export type Bill = { id: string; measure: string; session: string; title: string; status: string };
export type Supporter = { id: string; name: string; yes: number; no: number };
export type Lobbyist = { name: string; filings: number; bills: string[] };
export type Author = { id: string; name: string; lead: number; coauthor: number };
export type IssueResults = { bills: Bill[]; legislators: Supporter[]; lobbying: Lobbyist[] | null; authors: Author[] | null };

export const ISSUE_BILL_LIMIT = 150;

const STOPWORDS = new Set(["prop", "proposition", "measure", "bill", "bills", "the", "and", "for", "who", "what", "about", "with"]);

/** Every word of the query (up to five) must appear in the bill title, in any order. */
function titleMatch(topic: string): string | null {
  const words = topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !STOPWORDS.has(word)).slice(0, 5);
  return words.length ? words.map((word) => `bill_title ilike ${contains(word)}`).join(" and ") : null;
}

/** Bills whose title mentions the topic, who voted on and authored them, and who reported lobbying on them. */
export async function searchIssue(topic: string): Promise<IssueResults> {
  "use cache";
  cacheLife("hours");
  const match = titleMatch(topic.trim().slice(0, 80));
  if (!match) return { bills: [], legislators: [], lobbying: [], authors: [] };
  const [bills, legislators] = await Promise.all([
    runQuery(sharedDb(), `select bill_id, measure, session, min(bill_title) as title, min(bill_status) as status, max(vote_date) as last
      from v_votes where ${match} group by bill_id, measure, session order by last desc limit ${ISSUE_BILL_LIMIT}`),
    runQuery(sharedDb(), `select legislator_entity_id, min(legislator_name) as name,
        count(distinct bill_id) filter (where result = 'aye') as yes,
        count(distinct bill_id) filter (where result = 'no') as no
      from v_votes where ${match} group by legislator_entity_id`),
  ]);
  const billList: Bill[] = bills.rows.map((row) => ({ id: String(row.bill_id), measure: String(row.measure), session: String(row.session), title: text(row.title), status: text(row.status) }));
  const [lobbying, authors] = await Promise.all([lobbyingOn(billList), authorsOf(billList)]);
  return {
    bills: billList,
    legislators: legislators.rows.map((row) => ({ id: String(row.legislator_entity_id), name: text(row.name), yes: Number(row.yes), no: Number(row.no) })),
    lobbying,
    authors,
  };
}

/** Null when the v_bill_authors view is not available yet. */
async function authorsOf(bills: Bill[]): Promise<Author[] | null> {
  if (!bills.length) return [];
  try {
    const result = await runQuery(sharedDb(), `select legislator_entity_id, min(legislator_name) as name,
        count(*) filter (where role = 'lead') as lead, count(*) filter (where role = 'coauthor') as coauthor
      from v_bill_authors where bill_id in (${bills.map((bill) => lit(bill.id)).join(",")})
      group by legislator_entity_id order by lead desc, coauthor desc limit 15`);
    return result.rows.map((row) => ({ id: String(row.legislator_entity_id), name: text(row.name), lead: Number(row.lead), coauthor: Number(row.coauthor) }));
  } catch {
    return null;
  }
}

export type AuthoredBill = Bill & { role: "lead" | "coauthor" };

/** Bills the legislator authored. Null when the v_bill_authors view is not available yet. */
export async function getAuthoredBills(legislator: Legislator, topic = ""): Promise<AuthoredBill[] | null> {
  "use cache";
  cacheLife("hours");
  const match = topic.trim() ? titleMatch(topic.trim().slice(0, 80)) : null;
  try {
    const result = await runQuery(sharedDb(), `select bill_id, measure, session, bill_title, bill_status, role
      from v_bill_authors where legislator_entity_id = ${lit(legislator.id)} ${match ? `and ${match}` : ""}
      order by (role = 'lead') desc, session desc, measure limit 40`);
    return result.rows.map((row) => ({ id: String(row.bill_id), measure: String(row.measure), session: String(row.session), title: text(row.bill_title), status: text(row.bill_status), role: row.role === "lead" ? "lead" : "coauthor" }));
  } catch {
    return null;
  }
}

/** Lobbying reports name bills as "AB 123"; bill numbers repeat each session, so reports are limited to the session years. */
async function lobbyingOn(bills: Bill[]): Promise<Lobbyist[] | null> {
  const bySession = new Map<string, string[]>();
  for (const bill of bills) {
    const years = bill.session.match(/^(\d{4})-(\d{4})$/);
    if (!years) continue;
    bySession.set(bill.session, [...(bySession.get(bill.session) ?? []), bill.measure.replace("-", " ")]);
  }
  if (!bySession.size) return [];
  const where = [...bySession].map(([session, labels]) => {
    const [start, end] = session.split("-");
    const list = `array[${labels.map(lit).join(",")}]::text[]`;
    return `(bills && ${list} and b = any(${list}) and period_start >= '${start}-01-01' and period_start <= '${end}-12-31')`;
  }).join(" or ");
  try {
    const result = await runQuery(sharedDb(), `select employer_name, count(distinct filing_uuid) as filings, array_agg(distinct b) as bills
      from v_lobby, unnest(bills) as b where (${where}) group by employer_name order by filings desc limit 15`);
    const wanted = new Set([...bySession.values()].flat());
    return result.rows.map((row) => ({
      name: text(row.employer_name),
      filings: Number(row.filings),
      bills: (Array.isArray(row.bills) ? row.bills.map(text) : []).filter((bill) => wanted.has(bill)).slice(0, 6),
    }));
  } catch {
    return null;
  }
}

export function safeUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}

/** Official bill page on leginfo.legislature.ca.gov, e.g. 2025-2026 AB-113 → 202520260AB113. */
export function billUrl(session: string, measure: string): string | null {
  if (!/^\d{4}-\d{4}$/.test(session) || !/^[A-Z]+-\d+$/.test(measure)) return null;
  return `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=${session.replace("-", "")}0${measure.replace("-", "")}`;
}

export const committeeUrl = (filerId: string) => `https://cal-access.sos.ca.gov/Campaign/Committees/Detail.aspx?id=${encodeURIComponent(filerId)}`;

export const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const measureLabel = (measure: string) => measure.replace("-", " ");

/* ───────────────────────── Ballot measures ───────────────────────── */

/** "Prop 40", "proposition 40", "40" → 40. */
export function measureNumber(q: string): number | null {
  const m = q.trim().match(/^(?:prop(?:osition)?\.?\s*)?(\d{1,3})$/i) ?? q.match(/\bprop(?:osition)?\.?\s*(\d{1,3})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

/** Committees whose own name says "Yes on (Prop) N" or "No on (Prop) N". The name is the only link. */
const sideRegex = (n: number, side: "yes|no" | "yes" | "no") => `'\\m(${side})\\s+on\\s+(prop(osition)?\\.?\\s*)?${n}\\M'`;
const measureNameRegex = (n: number) => `'(^|[^0-9])${n}([^0-9]|$)'`;
/** Odd-year receipts belong to the next even-year election. */
const electionYear = (year: number) => year + (year % 2);

export type MeasureRef = { number: number; year: number; title: string };

function cleanMeasureTitle(name: string, n: number): string {
  return name
    .replace(new RegExp(`^\\s*${n}\\s+`), "")
    .replace(new RegExp(`\\b(prop(osition)?\\.?:?\\s*${n})\\b\\s*[-–:,]?\\s*`, "i"), "")
    .replace(/\.\s*(Initiative|Referendum|Legislative)\b.*$/i, "")
    .replace(/[,.\s-]+$/, "")
    // A curly apostrophe in the source file decodes as "?" mid-word ("Voters? Ability").
    .replace(/(\w)\?(s?\s)/g, "$1’$2")
    .trim()
    // Some filers type titles in capitals; show them in sentence case.
    .replace(/^[^a-z]*$/, (all) => all.charAt(0) + all.slice(1).toLowerCase());
}

/** Elections in which a measure with this number had campaign committees, newest first. */
export async function measureElections(n: number): Promise<MeasureRef[]> {
  "use cache";
  cacheLife("days") // Filings arrive as a bulk export; a day is fresh enough.;
  const [years, titles] = await Promise.all([
    runQuery(sharedDb(), `select extract(year from date)::int as y, count(*) as n from v_money
      where kind = 'contribution' and date is not null
        and to_entity_id in (select entity_id from v_entities where kind = 'committee' and name ~* ${sideRegex(n, "yes|no")})
      group by 1 order by 1 desc`),
    runQuery(sharedDb(), `select e.name, extract(year from m.date)::int as y, count(distinct m.from_entity_id) as n
      from v_entities e join v_money m on m.to_entity_id = e.entity_id
      where e.kind = 'measure' and e.name ~ ${measureNameRegex(n)} and m.date is not null
      group by 1, 2 order by 3 desc`),
  ]);
  const elections = new Map<number, number>();
  for (const row of years.rows) {
    const year = electionYear(Number(row.y));
    if (year > 1990 && year <= new Date().getFullYear() + 1) elections.set(year, (elections.get(year) ?? 0) + Number(row.n));
  }
  // Title: the descriptive name used by the most distinct filers, after merging case and punctuation variants.
  const votes = new Map<number, Map<string, { title: string; n: number }>>();
  for (const row of titles.rows) {
    const year = electionYear(Number(row.y));
    const title = cleanMeasureTitle(text(row.name), n);
    if (title.length <= 12) continue;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(initiative|constitutional|amendment|and|statute)\b/g, "").trim();
    const byYear = votes.get(year) ?? new Map();
    const entry = byYear.get(key) ?? { title, n: 0 };
    entry.n += Number(row.n);
    byYear.set(key, entry);
    votes.set(year, byYear);
  }
  const title = (year: number) => [...(votes.get(year)?.values() ?? [])].sort((a, b) => b.n - a.n)[0]?.title ?? "";
  // Drop stray years: a few late filings for an old committee are not an election.
  const peak = Math.max(0, ...elections.values());
  return [...elections].filter(([, count]) => count >= Math.max(20, peak * 0.02)).map(([year]) => year)
    .sort((a, b) => b - a).map((year) => ({ number: n, year, title: title(year) }))
    // An election with no measure name on file is usually a local committee reusing the number.
    .filter((ref, i, all) => ref.title || all.length === 1).slice(0, 4);
}

/** Measures named in the query ("Prop 40") or whose committees or names mention its words ("billionaire tax"). */
export async function findMeasures(q: string): Promise<MeasureRef[]> {
  "use cache";
  cacheLife("hours");
  const n = measureNumber(q);
  if (n) return (await measureElections(n)).slice(0, 3);
  // Any word may match; committees matching more of the words rank first. "taxes" also matches "tax".
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w)))].slice(0, 4);
  if (!words.length) return [];
  const hits = words.map((w) => `(name ilike ${contains(w)})::int`).join(" + ");
  const result = await runQuery(sharedDb(), `select substring(name from '(?i)\\m(?:yes|no)\\s+on\\s+(?:prop(?:osition)?\\.?\\s*)?([0-9]{1,3})\\M') as num,
      max(${hits}) as score, count(*) as n
    from v_entities where kind = 'committee' and (${words.map((w) => `name ilike ${contains(w)}`).join(" or ")})
      and name ~* '\\m(yes|no)\\s+on\\s+(prop(osition)?\\.?\\s*)?[0-9]{1,3}\\M'
    group by 1 having max(${hits}) >= ${Math.min(2, words.length)} order by 2 desc, 3 desc limit 3`);
  const numbers = result.rows.map((row) => Number(text(row.num))).filter((num) => Number.isInteger(num) && num > 0);
  const refs = await Promise.all(numbers.map(async (num) => (await measureElections(num))[0]));
  return refs.filter((ref): ref is MeasureRef => Boolean(ref));
}

export type SideCommittee = { id: string; name: string; total: number; count: number };
export type Side = { total: number; donors: number; committees: SideCommittee[]; top: Contributor[] };
export type Spender = { name: string; total: number; count: number; url: string | null };
export type MeasureDetail = MeasureRef & { yes: Side; no: Side; ieSupport: Spender[]; ieOppose: Spender[] };

export async function getMeasure(n: number, year: number): Promise<MeasureDetail | null> {
  "use cache";
  cacheLife("hours");
  if (!Number.isInteger(n) || n < 1 || n > 999 || !Number.isInteger(year) || year < 1990 || year > 2100) return null;
  const ref = (await measureElections(n)).find((item) => item.year === year);
  if (!ref) return null;
  const from = `${year - 1}-01-01`, to = `${year}-12-31`;
  const people = flags.SHOW_INDIVIDUAL_DONORS ? "" : "and m.from_kind <> 'person'";
  const lines = `select distinct on (side, m.from_entity_id, m.date, m.amount) side, c.entity_id as committee_id, c.name as committee_name,
      m.from_entity_id, m.from_name, m.from_kind, m.amount::numeric as amount, m.date, m.filing_url
    from (select entity_id, name, case when name ~* ${sideRegex(n, "yes")} then 'yes' else 'no' end as side
          from v_entities where kind = 'committee' and name ~* ${sideRegex(n, "yes|no")}) c
    join v_money m on m.to_entity_id = c.entity_id
    where m.kind = 'contribution' and m.date between '${from}' and '${to}' ${people}
    order by side, m.from_entity_id, m.date, m.amount, m.filed_at desc`;
  const [committees, donors, totals, ie] = await Promise.all([
    runQuery(sharedDb(), `select side, committee_id, min(committee_name) as name, sum(amount) as total, count(*) as n from (${lines}) l group by side, committee_id order by total desc`),
    runQuery(sharedDb(), `select * from (select side, from_entity_id, min(from_name) as name, min(from_kind) as kind, sum(amount) as total, count(*) as n, max(date) as last,
        (array_agg(filing_url order by date desc))[1] as url, row_number() over (partition by side order by sum(amount) desc) as r
      from (${lines}) l group by side, from_entity_id) x where r <= 10 order by side, total desc`),
    runQuery(sharedDb(), `select side, sum(amount) as total, count(distinct from_entity_id) as donors from (${lines}) l group by side`),
    runQuery(sharedDb(), `select m.kind, min(m.from_name) as name, sum(m.amount::numeric) as total, count(*) as n, (array_agg(m.filing_url order by m.date desc))[1] as url
      from v_money m where m.kind in ('ie_support', 'ie_oppose') and m.date between '${from}' and '${to}'
        and m.to_entity_id in (select entity_id from v_entities where kind = 'measure' and name ~ ${measureNameRegex(n)})
      group by m.kind, m.from_entity_id order by total desc limit 30`),
  ]);
  const side = (key: "yes" | "no"): Side => {
    const t = totals.rows.find((row) => text(row.side) === key);
    return {
      total: Number(t?.total ?? 0),
      donors: Number(t?.donors ?? 0),
      committees: committees.rows.filter((row) => text(row.side) === key).map((row) => ({ id: String(row.committee_id), name: text(row.name), total: Number(row.total), count: Number(row.n) })),
      top: donors.rows.filter((row) => text(row.side) === key).map((row) => ({ id: String(row.from_entity_id), name: text(row.name), kind: text(row.kind), total: Number(row.total), count: Number(row.n), last: String(row.last ?? ""), url: safeUrl(text(row.url)) })),
    };
  };
  const spenders = (kind: string) => ie.rows.filter((row) => text(row.kind) === kind).slice(0, 8).map((row) => ({ name: text(row.name), total: Number(row.total), count: Number(row.n), url: safeUrl(text(row.url)) }));
  return { ...ref, yes: side("yes"), no: side("no"), ieSupport: spenders("ie_support"), ieOppose: spenders("ie_oppose") };
}

export type MeasureSummary = MeasureRef & { yes: number; no: number };

/** Run `fn` over `items` with at most `limit` in flight, so a cold cache does not flood the database. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/**
 * Statewide-numbered measures in one election, ranked by money raised by committees named
 * "Yes on N" / "No on N" (contributor, date and amount counted once per side).
 */
export async function measuresOverview(year: number): Promise<MeasureSummary[]> {
  "use cache";
  cacheLife("days") // Filings arrive as a bulk export; a day is fresh enough.;
  const re = `'(?i)\\m(yes|no)\\s+on\\s+(?:prop(?:osition)?\\.?\\s*)?([0-9]{1,3})\\M'`;
  const groups = await runQuery(sharedDb(), `select m[2] as num, lower(m[1]) as side, array_agg(entity_id) as ids
    from (select entity_id, regexp_match(name, ${re}) as m from v_entities where kind = 'committee' and name ~* '\\m(yes|no)\\s+on\\s+(prop(osition)?\\.?\\s*)?[0-9]{1,3}\\M') x
    group by 1, 2`);
  // runQuery caps SQL at 20,000 characters, so committee ids go in chunks. Every committee for one
  // measure number stays in the same chunk, so the per-side de-duplication is unaffected.
  const byNumber = new Map<number, [string, number, string][]>();
  for (const row of groups.rows) {
    const num = Number(text(row.num)), side = text(row.side);
    if (!Number.isInteger(num) || (side !== "yes" && side !== "no")) continue;
    const ids = Array.isArray(row.ids) ? row.ids.map(String).filter(isUuid) : [];
    byNumber.set(num, [...(byNumber.get(num) ?? []), ...ids.map((id) => [id, num, side[0]] as [string, number, string])]);
  }
  const SIZE = 175;
  const chunks: [string, number, string][][] = [[]];
  for (const tuples of byNumber.values()) {
    if (chunks[chunks.length - 1].length + tuples.length > SIZE) chunks.push([]);
    chunks[chunks.length - 1].push(...tuples.slice(0, SIZE));
  }
  // Filter v_money by the id list first (index lookups), then attach number and side.
  const results = await pool(chunks.filter((chunk) => chunk.length), 3, (chunk) => runQuery(sharedDb(), `with m as materialized (
      select to_entity_id, from_entity_id, date, amount::numeric as a from v_money
      where kind = 'contribution' and date between '${year - 1}-01-01' and '${year}-12-31' and to_entity_id in (${chunk.map(([id]) => `'${id}'`).join(",")})),
    c(id, num, side) as (values ${chunk.map(([id, num, side]) => `('${id}',${num},'${side}')`).join(",")})
    select num, side, sum(a) as total from (
      select distinct on (c.num, c.side, m.from_entity_id, m.date, m.a) c.num, c.side, m.a
      from m join c on c.id::uuid = m.to_entity_id order by c.num, c.side, m.from_entity_id, m.date, m.a) d
    group by num, side`));
  const byNum = new Map<number, { yes: number; no: number }>();
  for (const row of results.flatMap((result) => result.rows)) {
    const num = Number(row.num), entry = byNum.get(num) ?? { yes: 0, no: 0 };
    entry[text(row.side) === "y" ? "yes" : "no"] += Number(row.total);
    byNum.set(num, entry);
  }
  const ranked = [...byNum].filter(([, v]) => v.yes + v.no >= 50_000).sort((a, b) => (b[1].yes + b[1].no) - (a[1].yes + a[1].no)).slice(0, 12);
  const refs = await pool(ranked, 4, async ([num]) => (await measureElections(num).catch(() => [])).find((ref) => ref.year === year));
  return ranked.flatMap(([num, v], i) => (refs[i]?.title ? [{ ...refs[i]!, number: num, yes: v.yes, no: v.no }] : [])).sort((a, b) => a.number - b.number);
}

/** The election the site leads with: this year if even, otherwise the next one. */
export async function currentElection(): Promise<number> {
  "use cache";
  cacheLife("days");
  return electionYear(new Date().getFullYear());
}
