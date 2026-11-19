/**
 * Reads `buildlog/*.mdx` off disk for the /log page.
 *
 * The build log ships with the repository, so it only changes on deploy: the
 * read is cached rather than repeated on every request.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { type BuildlogEntry, ENTRY_FILENAME, parseEntry, sortEntries } from "./entries";

/**
 * `buildlog/` sits at the repository root and Next runs from `apps/web`.
 *
 * The path is built from literal segments on purpose: a computed directory
 * walk makes Turbopack trace the whole repository into the server bundle.
 */
export const BUILDLOG_DIR = join(process.cwd(), "..", "..", "buildlog");

export async function readEntries(): Promise<BuildlogEntry[]> {
  "use cache";
  cacheLife("hours");

  let names: string[];
  try {
    names = await readdir(BUILDLOG_DIR);
  } catch {
    // No build log on disk (an isolated deployment, say): render an empty page
    // rather than failing the route.
    return [];
  }

  const files = names.filter((file) => ENTRY_FILENAME.test(file));
  const entries = await Promise.all(
    files.map(async (file) => parseEntry(file, await readFile(join(BUILDLOG_DIR, file), "utf8"))),
  );

  return sortEntries(entries.filter((entry): entry is BuildlogEntry => entry !== null));
}
