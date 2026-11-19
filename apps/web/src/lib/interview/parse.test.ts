import { describe, expect, test } from "bun:test";
import { InvalidInput, neutral, parseCompletion, parseDemographics, parseStudy } from "./parse";
import { periodicQuestion, topIssues } from "./periodic";
import { form } from "./stripe";

const fd = (entries: Record<string, string>) => ({ get: (k: string) => entries[k] ?? null });

describe("parseDemographics", () => {
  const base = { consent: "on", county: "Fresno", ageRange: "25-34", party: "Green", voteLikelihood: "Unsure", email: "Voter@Example.com" };
  test("accepts listed values with consent and an email", () => {
    expect(parseDemographics(fd(base)))
      .toEqual({ county: "Fresno", ageRange: "25-34", party: "Green", voteLikelihood: "Unsure", rewardEmail: "voter@example.com", profile: {} });
  });
  test("requires consent, known values and an email", () => {
    expect(() => parseDemographics(fd({ ...base, consent: "" }))).toThrow(InvalidInput);
    expect(() => parseDemographics(fd({ ...base, county: "Atlantis" }))).toThrow(InvalidInput);
    expect(() => parseDemographics(fd({ ...base, email: "not-an-email" }))).toThrow(InvalidInput);
  });
  test("studies read only the fields they ask for", () => {
    const out = parseDemographics(fd({ consent: "on", county: "Fresno", ageRange: "25-34", email: "a@b.co" }), { standard: ["county", "ageRange"], custom: [] });
    expect(out.party).toBe("Not asked");
    expect(out.voteLikelihood).toBe("Not asked");
    expect(out.profile).toEqual({});
  });
  test("city and custom fields go into the profile; county can be off", () => {
    const fields = { standard: ["ageRange", "city"] as ("ageRange" | "city")[], custom: [{ label: "Do you rent or own?", options: ["Rent", "Own", "Other"] }] };
    const out = parseDemographics(fd({ consent: "on", ageRange: "65+", city: " Fresno ", custom_0: "Rent", email: "a@b.co" }), fields);
    expect(out.county).toBe("Not asked");
    expect(out.profile).toEqual({ "City or town": "Fresno", "Do you rent or own?": "Rent" });
    expect(() => parseDemographics(fd({ consent: "on", ageRange: "65+", city: "Fresno", custom_0: "Lease", email: "a@b.co" }), fields)).toThrow(InvalidInput);
    expect(() => parseDemographics(fd({ consent: "on", ageRange: "65+", custom_0: "Rent", email: "a@b.co" }), fields)).toThrow(InvalidInput);
  });
});

describe("parseCompletion", () => {
  test("keeps only known issues, trims lists and transcript", () => {
    const out = parseCompletion({
      transcript: [{ role: "voter", text: "  hi  " }, { role: "system", text: "x" }, { role: "interviewer", text: "" }],
      result: { issues: ["Housing and rent", "Made up", "Housing and rent"], questions: ["a", "b", "c", "d", "e", "f", "g"], candidate_views: [], summary: "S" },
    });
    expect(out.transcript).toEqual([{ role: "voter", text: "hi" }]);
    expect(out.issues).toEqual(["Housing and rent"]);
    expect(out.questions).toHaveLength(6);
  });
  test("keeps sources, quotes and a message to leaders, in neutral words", () => {
    const out = parseCompletion({ result: { sources: ["Local news", ""], quotes: ["1", "2", "3", "4"], to_leaders: "Nothing is rigged, just slow." } });
    expect(out.details).toEqual({ sources: ["Local news"], quotes: ["1", "2", "3"], toLeaders: "Nothing is [removed], just slow." });
  });
  test("tolerates garbage", () => {
    expect(parseCompletion(null)).toEqual({ transcript: [], issues: [], questions: [], candidateViews: [], summary: null, details: { sources: [], quotes: [], toLeaders: null }, answers: [] });
  });
  test("keeps complete study answers only", () => {
    const out = parseCompletion({ result: { answers: [{ question: "Q1", answer: "A1" }, { question: "Q2", answer: "" }, "x"] } });
    expect(out.answers).toEqual([{ question: "Q1", answer: "A1" }]);
  });
});

describe("parseStudy", () => {
  test("splits questions by line", () => {
    const study = parseStudy(fd({ sponsorKind: "government", sponsorName: "City", title: "T", goal: "G", questions: "One?\n\nTwo?\n3\n4\n5\n6" }));
    expect(study.questions).toEqual(["One?", "Two?", "3", "4", "5", "6"]);
    expect(study.sponsorKind).toBe("government");
  });
  test("rejects more than six questions instead of dropping them", () => {
    expect(() => parseStudy(fd({ sponsorKind: "business", sponsorName: "A", title: "T", goal: "G", questions: "1\n2\n3\n4\n5\n6\n7" }))).toThrow(InvalidInput);
  });
  test("defaults to the smallest size and reads chosen fields", () => {
    const study = parseStudy(fd({ sponsorKind: "business", sponsorName: "A", title: "T", goal: "G", questions: "Q", field_county: "on", field_ageRange: "on" }));
    expect(study).toMatchObject({ interviewTarget: 20, priceCents: 14900, fields: { standard: ["county", "ageRange"], custom: [] } });
    const big = parseStudy(fd({ sponsorKind: "government", sponsorName: "A", title: "T", goal: "G", questions: "Q", interviews: "100", field_party: "on", customLabel_1: "Do you rent or own?", customOptions_1: "Rent\nOwn\nRent" }));
    // Government studies never ask party or voting plan; a business study may.
    expect(big).toMatchObject({ interviewTarget: 100, priceCents: 64900, fields: { standard: [], custom: [{ label: "Do you rent or own?", options: ["Rent", "Own"] }] } });
    expect(parseStudy(fd({ sponsorKind: "business", sponsorName: "A", title: "T", goal: "G", questions: "Q", field_party: "on" })).fields.standard).toEqual(["party"]);
  });
  test("rejects banned or identifying wording instead of silently editing it", () => {
    const base = { sponsorKind: "business", sponsorName: "A", title: "T", goal: "G" };
    expect(() => parseStudy(fd({ ...base, questions: "Is the process rigged?" }))).toThrow(/neutral wording in the question 1/u);
    expect(() => parseStudy(fd({ ...base, questions: "What is your email address?" }))).toThrow(/names, addresses or contact details/u);
  });
  test("rejects unknown sizes and incomplete custom fields", () => {
    const base = { sponsorKind: "business", sponsorName: "A", title: "T", goal: "G", questions: "Q" };
    expect(() => parseStudy(fd({ ...base, interviews: "7" }))).toThrow(InvalidInput);
    expect(() => parseStudy(fd({ ...base, customLabel_0: "Rent or own?", customOptions_0: "Rent" }))).toThrow(InvalidInput);
    expect(() => parseStudy(fd({ ...base, customOptions_0: "Rent\nOwn" }))).toThrow(InvalidInput);
  });
  test("requires a known kind and a question", () => {
    expect(() => parseStudy(fd({ sponsorKind: "church", sponsorName: "A", title: "T", goal: "G", questions: "Q" }))).toThrow(InvalidInput);
    expect(() => parseStudy(fd({ sponsorKind: "business", sponsorName: "A", title: "T", goal: "G", questions: " " }))).toThrow(InvalidInput);
  });
});

test("neutral removes banned words", () => {
  expect(neutral("They were bought and the vote was rigged")).toBe("They were [removed] and the vote was [removed]");
});

test("topIssues ranks last week's issues and drops Other", () => {
  const now = Date.UTC(2026, 10, 17);
  const day = (d: number) => new Date(now - d * 86_400_000);
  const sessions = [
    { issues: ["Taxes", "Other"], completedAt: day(1) },
    { issues: ["Taxes", "Education"], completedAt: day(2) },
    { issues: ["Education"], completedAt: day(30) },
  ];
  expect(topIssues(sessions, now)).toEqual(["Taxes", "Education"]);
  expect(periodicQuestion("Taxes")).toContain("taxes in California");
});

test("stripe form encodes nested keys and skips undefined", () => {
  expect(form({ "line_items[0][quantity]": 1, mode: "payment", skip: undefined })).toBe("line_items%5B0%5D%5Bquantity%5D=1&mode=payment");
});
