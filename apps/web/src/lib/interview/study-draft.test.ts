import { describe, expect, test } from "bun:test";
import { decodeStudyDraft, parseStudyDraft, studyDraftHref } from "./study-draft";

// Text reuses the study builder's placeholder copy (apps/web/src/app/interview/forms.tsx), not interview or filing data.
const draft = parseStudyDraft({
  sponsor_kind: "government", title: "Housing ideas for downtown", goal: "Which housing ideas residents support, and why.",
  questions: ["What makes housing hard to find here?", "What do you think about taller buildings near transit?"],
  fields: { standard: ["county", "city"], custom: [{ label: "Do you rent or own your home?", options: ["Rent", "Own", "Other"] }] }, size: 100,
});

describe("study draft link", () => {
  test("round-trips through the builder URL", () => {
    const href = studyDraftHref(draft);
    expect(href.startsWith("/interview/studies/new?kind=government&draft=")).toBe(true);
    expect(decodeStudyDraft(new URL(href, "https://x").searchParams.get("draft"))).toEqual(draft);
  });
  test("ignores anything that is not a valid draft", () => {
    expect(decodeStudyDraft(undefined)).toBeNull();
    expect(decodeStudyDraft("not base64!")).toBeNull();
    expect(decodeStudyDraft("e30")).toBeNull(); // {}
    expect(decodeStudyDraft("A".repeat(9000))).toBeNull();
  });
  test("normalizes whitespace and keeps non-ASCII text", () => {
    const d = parseStudyDraft({ ...draft, title: "  Vivienda   en el centro ñ " });
    expect(d.title).toBe("Vivienda en el centro ñ");
    expect(decodeStudyDraft(new URL(studyDraftHref(d), "https://x").searchParams.get("draft"))?.title).toBe(d.title);
  });
});
