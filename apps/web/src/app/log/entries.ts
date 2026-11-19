/**
 * Build log entries: shape, parsing and ordering.
 *
 * Pure — `read-entries.ts` does the filesystem read. Keeping them apart lets
 * this module be tested without a Next runtime.
 */
import { mapping, numeric, parseFrontmatter, scalar } from "./frontmatter";
import { firstLineOfSection } from "./markdown";

/** `YYYY-MM-DD-HHMM-slug.mdx`, the name rule from AGENTS.md. */
export const ENTRY_FILENAME = /^(\d{4}-\d{2}-\d{2})-(\d{4})-([a-z0-9][a-z0-9-]*)\.mdx$/;

export type BuildlogEntry = {
  /** File name without extension; also the anchor id on the page. */
  slug: string;
  file: string;
  /** Frontmatter `date`, falling back to the date in the file name. */
  date: string;
  /** `HH:MM` from the file name. */
  time: string;
  author: string;
  /** Empty string when nobody has reviewed the entry yet. */
  reviewer: string;
  task: string;
  /** Optional `metrics:` map from frontmatter, values left as written. */
  metrics: Record<string, string>;
  body: string;
};

/** An entry is reviewed once a human has written their name into `reviewer`. */
export function isReviewed(entry: BuildlogEntry): boolean {
  return entry.reviewer.trim().length > 0;
}

/** Agent entries are authored `agent:<name>`; everything else is human-written. */
export function isHumanWritten(entry: BuildlogEntry): boolean {
  return !/^agent[:/-]/i.test(entry.author.trim());
}

/** Parses one entry. Returns null when the file name does not match the rule. */
export function parseEntry(file: string, source: string): BuildlogEntry | null {
  const match = file.match(ENTRY_FILENAME);
  if (!match) return null;

  const [, fileDate, hhmm] = match;
  const { data, body } = parseFrontmatter(source);

  return {
    slug: file.replace(/\.mdx$/, ""),
    file,
    date: scalar(data, "date") || fileDate!,
    time: `${hhmm!.slice(0, 2)}:${hhmm!.slice(2)}`,
    author: scalar(data, "author"),
    reviewer: scalar(data, "reviewer"),
    task: scalar(data, "task"),
    metrics: mapping(data, "metrics"),
    body,
  };
}

/** Newest first. File names start with `YYYY-MM-DD-HHMM`, so they sort for us. */
export function sortEntries(entries: BuildlogEntry[]): BuildlogEntry[] {
  return [...entries].sort((a, b) => b.file.localeCompare(a.file));
}

/**
 * A point for the entity-match precision chart, read from frontmatter rather
 * than the database: entity resolution reports precision per run in its build
 * log entry (`metrics.entity_match_precision`), on a 0–1 scale.
 */
export type PrecisionPoint = { date: string; slug: string; value: number; author: string };

export function precisionSeries(entries: BuildlogEntry[]): PrecisionPoint[] {
  return entries
    .map((entry) => {
      const value = numeric(entry.metrics.entity_match_precision);
      return value === null ? null : { date: entry.date, slug: entry.slug, value, author: entry.author };
    })
    .filter((point): point is PrecisionPoint => point !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** The entry's headline metric, used for the share text. */
export function headlineMetric(entry: BuildlogEntry): string {
  return firstLineOfSection(entry.body, "Metric");
}
