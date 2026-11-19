/** Compose only: opening a draft never means a post was published or earned points. */
export const SHARE_TAGS = ["UHP", "TokenRouter", "BigHackGame", "BeatCal"].map((tag) => `#${tag}`).join(" ");
export const SHARE_PLATFORMS = ["x", "linkedin", "bluesky", "threads"] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];
export function shareText(finding: string, shortlink: string): string {
  const url = new URL(shortlink);
  if (url.protocol !== "https:" || url.username || url.password || /[\s\u0000-\u001f]/u.test(shortlink)) throw new Error("Use a valid HTTPS receipt link.");
  const suffix = ` Receipts: ${url.href} ${SHARE_TAGS}`;
  // Count UTF-16 units (conservative for emoji); the output stays below 280.
  const budget = 279 - suffix.length;
  if (budget < 2) throw new Error("Receipt link is too long to share.");
  const text = finding.replace(/\s+/gu, " ").trim();
  if (!text) throw new Error("A verified finding is required.");
  let excerpt = text;
  if (excerpt.length > budget) {
    excerpt = excerpt.slice(0, budget - 1);
    if (/[\uD800-\uDBFF]$/.test(excerpt)) excerpt = excerpt.slice(0, -1);
    excerpt = `${excerpt.trimEnd()}…`;
  }
  return `${excerpt}${suffix}`;
}
export function shareIntent(platform: SharePlatform, text: string, receipt: string): string {
  // A platform-specific compose URL, never a posting API or account permission.
  if (platform === "x") return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  if (platform === "bluesky") return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
  if (platform === "threads") return `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
  // LinkedIn's share-offsite supports a URL, not prefilled commentary. The UI
  // presents/copies the prepared text separately instead of dropping it silently.
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(receipt)}`;
}
