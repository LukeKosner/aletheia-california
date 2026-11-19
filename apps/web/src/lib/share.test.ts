import { describe, expect, test } from "bun:test";
import { recordedInvestigation } from "@/components/investigations/recorded";
import { SHARE_PLATFORMS, SHARE_TAGS, shareIntent, shareText } from "./share";

// Source-backed text/URL: CAL-ACCESS filing 3214397, F497P1 line 1.
// This tests composition only; the recorded example is not verified/publishable.
const finding = recordedInvestigation.answer.sections[0].sentences[0].text;
const receipt = recordedInvestigation.sources[0].url!;
describe("reviewable social drafts", () => {
  test("keeps receipts/tags intact and output strictly under 280", () => {
    const text = shareText(finding, receipt);
    expect(text.length).toBeLessThan(280);
    expect(text).toContain(` Receipts: ${receipt} ${SHARE_TAGS}`);
    expect(text).toContain("… Receipts:");
    const short = recordedInvestigation.sources[0].title;
    expect(shareText(short, receipt)).toBe(`${short} Receipts: ${receipt} ${SHARE_TAGS}`);
  });
  test("rejects missing finding, non-HTTPS URL and oversized receipt URL", () => {
    expect(() => shareText("", receipt)).toThrow();
    expect(() => shareText(finding, "javascript:alert(1)")).toThrow();
    expect(() => shareText(finding, `https://example.com/${"x".repeat(280)}`)).toThrow();
  });
  test("all four destinations open compose pages; LinkedIn gets the receipt URL", () => {
    const text = shareText(finding, receipt);
    const hosts = ["twitter.com", "www.linkedin.com", "bsky.app", "www.threads.net"];
    SHARE_PLATFORMS.forEach((platform, index) => {
      const url = new URL(shareIntent(platform, text, receipt));
      expect(url.hostname).toBe(hosts[index]);
      expect(url.searchParams.get(platform === "linkedin" ? "url" : "text")).toBe(platform === "linkedin" ? receipt : text);
    });
  });
});
