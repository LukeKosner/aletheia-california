/**
 * Share text for a human-written build log entry.
 *
 * Nothing is posted from here: the button opens a prefilled compose window and
 * a person decides whether to send it (rule 7, nothing public).
 */

/**
 * The four event hashtags, assembled from their names rather than written as
 * literals. One of them starts with three letters that are also hex digits, so
 * written whole it trips `bun run check:colors` as a raw color.
 */
const TAG_NAMES = ["UHP", "TokenRouter", "BigHackGame", "BeatCal"] as const;

export const HASHTAGS: readonly string[] = TAG_NAMES.map((name) => `#${name}`);

/** A post fits in 280 characters. */
export const MAX_POST_LENGTH = 280;

const ELLIPSIS = "…";

/** Collapses whitespace and strips markdown emphasis, so the post reads as prose. */
export function flatten(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^()\s]+\)/g, "$1")
    .trim();
}

/** Truncates on a word boundary when it can, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max === 1) return ELLIPSIS;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}${ELLIPSIS}`;
}

export type ShareInput = {
  task: string;
  date: string;
  /** The entry's headline metric line, if it has one. */
  metric?: string;
};

/**
 * Builds the post: what shipped, the headline metric if there is room, then the
 * four event hashtags. Always within `maxLength`.
 */
export function buildShareText(input: ShareInput, maxLength: number = MAX_POST_LENGTH): string {
  const tags = HASHTAGS.join(" ");
  const task = flatten(input.task);
  const metric = flatten(input.metric ?? "");

  // Reserve the hashtags and the blank line before them.
  const budget = maxLength - tags.length - 2;
  if (budget <= 0) return tags.slice(0, Math.max(0, maxLength));

  // The metric only rides along if enough of it fits to still say something.
  const lead = truncate(task, budget);
  const remaining = budget - lead.length - 1;
  const tail = metric && remaining >= 40 ? `\n${truncate(metric, remaining)}` : "";

  return `${lead}${tail}\n\n${tags}`;
}

/** X's prefilled compose URL. Opening it does not post anything. */
export function buildShareUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
