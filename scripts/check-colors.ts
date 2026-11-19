/**
 * Fails if apps/web/src contains raw hex colors or rgb()/rgba() calls.
 * Colors must come from theme tokens (CSS variables in globals.css, used via Tailwind classes).
 * The theme token file itself (globals.css) is allowed to define tokens, but in oklch only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "apps", "web", "src");
const EXTS = /\.(tsx?|jsx?|mjs|cjs|css|scss|mdx?)$/;
// Hex: 3, 4, 6 or 8 hex digits after '#', not part of a longer word or an HTML entity (&#123;).
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g;
const RGB = /\brgba?\s*\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return EXTS.test(name) ? [p] : [];
  });
}

export function findRawColors(text: string): { line: number; match: string }[] {
  const out: { line: number; match: string }[] = [];
  text.split("\n").forEach((line, i) => {
    for (const re of [HEX, RGB]) {
      for (const m of line.matchAll(re)) out.push({ line: i + 1, match: m[0] });
    }
  });
  return out;
}

if (import.meta.main) {
  const problems: string[] = [];
  for (const file of walk(ROOT)) {
    if (file.endsWith(".test.ts")) continue;
    for (const { line, match } of findRawColors(readFileSync(file, "utf8"))) {
      problems.push(`${relative(process.cwd(), file)}:${line}  ${match}`);
    }
  }
  if (problems.length) {
    console.error("Raw colors found. Use theme tokens instead:\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("No raw hex or rgb() colors in apps/web/src.");
}
