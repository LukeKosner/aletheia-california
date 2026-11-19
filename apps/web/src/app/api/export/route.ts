/**
 * CSV exports of the public-record tables shown on Issues, Measure and Legislator pages.
 * Same read-only queries as the pages; rows carry their filing or bill links.
 */
import { billUrl, getFunding, getLegislator, getMeasure, getVotes, searchIssue } from "@/lib/gov";

type Row = Record<string, string | number | null>;

function csv(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  // Quote every cell; neutralize spreadsheet formulas in record text.
  const cell = (value: Row[string]) => {
    const text = value == null ? "" : String(value);
    return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  return [cols.map(cell).join(","), ...rows.map((row) => cols.map((col) => cell(row[col])).join(","))].join("\r\n") + "\r\n";
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";

function file(name: string, rows: Row[]) {
  return new Response(csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${slug(name)}.csv"`, "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  try {
    if (kind === "issue") {
      const q = (params.get("q") ?? "").trim().slice(0, 80);
      const result = await searchIssue(q);
      const part = params.get("part");
      if (part === "lobbying") return file(`${q}-lobbying`, (result.lobbying ?? []).map((row) => ({ organization: row.name, reports: row.filings, bills: row.bills.join("; ") })));
      if (part === "votes") return file(`${q}-votes`, result.legislators.map((row) => ({ legislator: row.name, bills_voted_yes: row.yes, bills_voted_no: row.no })));
      return file(`${q}-bills`, result.bills.map((bill) => ({ bill: bill.measure.replace("-", " "), session: bill.session, title: bill.title, status: bill.status, url: billUrl(bill.session, bill.measure) })));
    }
    if (kind === "measure") {
      const n = Number(params.get("n")), year = Number(params.get("year"));
      const measure = await getMeasure(n, year);
      if (!measure) return Response.json({ error: "Measure not found." }, { status: 404 });
      return file(`prop-${n}-${year}-contributors`, (["yes", "no"] as const).flatMap((side) => measure[side].top.map((row) => ({ side: `${side === "yes" ? "Yes" : "No"} on ${n}`, contributor: row.name, total: row.total, contributions: row.count, latest_filing: row.url }))));
    }
    if (kind === "legislator") {
      const legislator = await getLegislator(params.get("id") ?? "");
      if (!legislator) return Response.json({ error: "Legislator not found." }, { status: 404 });
      if (params.get("part") === "votes") {
        const votes = await getVotes(legislator, params.get("topic") ?? "");
        return file(`${legislator.name}-votes`, votes.map((vote) => ({ date: vote.date, bill: vote.measure.replace("-", " "), title: vote.title, location: vote.location, vote: vote.result === "aye" ? "Yes" : vote.result === "no" ? "No" : "No vote", url: billUrl(vote.session, vote.measure) })));
      }
      const funding = await getFunding(legislator);
      return file(`${legislator.name}-contributors`, (funding?.top ?? []).map((row) => ({ contributor: row.name, total: row.total, contributions: row.count, latest: row.last, latest_filing: row.url })));
    }
    return Response.json({ error: "Unknown export." }, { status: 400 });
  } catch {
    return Response.json({ error: "Export is unavailable right now." }, { status: 503 });
  }
}
