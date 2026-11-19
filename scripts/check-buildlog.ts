/**
 * Fails a pull request that does not add a build log entry (AGENTS.md rule 8).
 *
 * Checks the files the branch adds under `buildlog/`:
 *   - at least one new `buildlog/YYYY-MM-DD-HHMM-slug.mdx`
 *   - frontmatter has `date`, `author`, `reviewer` and `task`
 *     (`reviewer` is left blank by the author, so it only has to be present)
 *   - `date` matches the date in the file name
 *   - the four required sections are present
 *
 * Base branch: `BUILDLOG_BASE_REF`, else `GITHUB_BASE_REF`, else `main`.
 * It reads commits, not the working tree, so commit the entry before running it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, scalar } from "../apps/web/src/app/log/frontmatter.ts";

export const ENTRY_PATH = /^buildlog\/(\d{4}-\d{2}-\d{2})-\d{4}-[a-z0-9][a-z0-9-]*\.mdx$/;

export const REQUIRED_KEYS = ["date", "author", "reviewer", "task"] as const;
export const REQUIRED_SECTIONS = ["Shipped", "Metric", "Broke or learned", "Evidence"] as const;

/** Problems with one added entry. Empty means it is fine. */
export function validateEntry(path: string, source: string): string[] {
  const problems: string[] = [];
  const match = path.match(ENTRY_PATH);
  if (!match) {
    return [`${path}: name must be buildlog/YYYY-MM-DD-HHMM-slug.mdx (lowercase slug)`];
  }

  const { data, body } = parseFrontmatter(source);
  if (Object.keys(data).length === 0) {
    return [`${path}: no frontmatter block (--- … ---) at the top of the file`];
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) problems.push(`${path}: frontmatter is missing \`${key}\``);
  }
  for (const key of ["date", "author", "task"] as const) {
    if (key in data && scalar(data, key).trim() === "") {
      problems.push(`${path}: frontmatter \`${key}\` is empty`);
    }
  }

  const date = scalar(data, "date").trim();
  if (date && date !== match[1]) {
    problems.push(`${path}: frontmatter date ${date} does not match the file name date ${match[1]}`);
  }

  for (const section of REQUIRED_SECTIONS) {
    const heading = new RegExp(`^##\\s+${section}\\s*$`, "im");
    if (!heading.test(body)) problems.push(`${path}: missing section \`## ${section}\``);
  }

  return problems;
}

// --- git -------------------------------------------------------------------

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBase(): string {
  const name = process.env.BUILDLOG_BASE_REF || process.env.GITHUB_BASE_REF || "main";
  for (const ref of [`origin/${name}`, name]) {
    try {
      git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
      return ref;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `cannot resolve the base branch "${name}". Fetch it first (actions/checkout needs fetch-depth: 0).`,
  );
}

/** Files the branch adds under buildlog/, relative to the repo root. */
export function addedEntries(base: string): string[] {
  const output = git("diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", "buildlog");
  return output ? output.split("\n").filter((line) => line.endsWith(".mdx")) : [];
}

if (import.meta.main) {
  const root = git("rev-parse", "--show-toplevel");
  const base = resolveBase();
  const added = addedEntries(base);

  if (added.length === 0) {
    console.error(
      [
        `No new build log entry against ${base}.`,
        "",
        "Every pull request adds one entry (AGENTS.md rule 8):",
        "  buildlog/YYYY-MM-DD-HHMM-slug.mdx",
        "with frontmatter `date`, `author`, `reviewer` (leave blank) and `task`,",
        "and the sections Shipped, Metric, Broke or learned, Evidence.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const problems = added.flatMap((path) => validateEntry(path, readFileSync(join(root, path), "utf8")));
  if (problems.length > 0) {
    console.error(`Build log entry problems:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }

  console.log(`Build log entry added: ${added.join(", ")}`);
}
