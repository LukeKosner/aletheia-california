import type { StudyDraft } from "@/lib/interview/study-draft";

export type QuestionType = "general" | "measure" | "bill" | "footprint" | "interests";
/** `title` is the server's raw label; the readable fields below arrive once evidence is hydrated. */
export type FilingSource = {
  id: string; title: string; url: string; detail?: string;
  kind?: string; filer?: string; period?: string | null; filed?: string | null; filedAt?: string | null; periodStart?: string | null; host?: string; partial?: boolean;
};
/**
 * A filing-backed sentence has claim_id and source_ids; a web-backed sentence has only `source` (a link, not a verified
 * record); an interview sentence has `insight: true` (a figure from Aletheia's own public voter interviews).
 */
export type Sentence = { text: string; claim_id?: string | null; source_ids?: string[]; source?: { url: string; title: string }; insight?: boolean };
export type Investigation = {
  investigation_id: string;
  question: string;
  recorded?: boolean;
  evidence_note?: string;
  answer: { summary: string; sections: { heading: string; sentences: Sentence[] }[]; card: unknown; study?: StudyDraft };
  sources: FilingSource[];
  verification?: { status: string; checked_at?: string };
  graph?: { nodes: { id: string; name: string; side: "donor" | "recipient" }[]; edges: { id: string; source: string; target: string; amount: string; source_id: string }[] };
};

/** Web source links must be HTTPS. API content is untrusted. */
export function webUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
export function webDomain(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./u, ""); } catch { return "web"; }
}

/** Only HTTP(S) filing links may leave the page. API content is untrusted. */
export function filingUrl(value: string): string | undefined {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
