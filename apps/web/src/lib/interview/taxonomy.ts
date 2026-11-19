/** Shared browser/server vocabulary for the voter-interview prototype. No secrets or server imports. */

/** California's 58 counties (California State Association of Counties, https://www.counties.org/county-websites-profile-information). */
export const COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa", "Del Norte", "El Dorado", "Fresno",
  "Glenn", "Humboldt", "Imperial", "Inyo", "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
  "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange", "Placer", "Plumas",
  "Riverside", "Sacramento", "San Benito", "San Bernardino", "San Diego", "San Francisco", "San Joaquin",
  "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra", "Siskiyou",
  "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
] as const;

export const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;

/** Party preferences on the California voter registration form (https://www.sos.ca.gov/elections/political-parties/qualified-political-parties). */
export const PARTIES = [
  "Democratic", "Republican", "No party preference", "American Independent", "Green", "Libertarian",
  "Peace and Freedom", "Other", "Prefer not to say",
] as const;

export const LIKELIHOOD = ["Definitely voting", "Probably voting", "Unsure", "Not planning to vote", "Not registered yet"] as const;

/** Fixed issue tags so interviews can be counted across the state. */
export const ISSUES = [
  "Housing and rent", "Cost of living", "Homelessness", "Public safety", "Criminal justice", "Education",
  "Health care", "Climate and environment", "Water and drought", "Wildfires", "Transportation", "Taxes",
  "Jobs and economy", "Immigration", "Elections and democracy", "Reproductive rights", "Gun policy",
  "Technology and AI", "Energy and utilities", "Labor and wages", "Other",
] as const;

export type County = (typeof COUNTIES)[number];
export type Issue = (typeof ISSUES)[number];

/** Offered to every voter who completes an interview. */
export const REWARD_CENTS = 500;

/** Research and reports are free for everyone. `study` is the starting price; each study charges its own size. */
export const PRICES = {
  study: { cents: 14900, name: "Aletheia study: 20 voice interviews" },
} as const;
export type Product = keyof typeof PRICES;

export function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export const SPONSOR_KINDS = { government: "Government", business: "Business" } as const;
export type SponsorKind = keyof typeof SPONSOR_KINDS;
/**
 * Sponsors whose open studies may be offered after a general voter interview. Government studies join once government
 * sponsors are verified: today anyone can name themselves an agency, and an agency inside Aletheia's civic interview
 * needs that check first.
 */
export const FOLLOW_ON_KINDS: readonly SponsorKind[] = ["business"];
export const MAX_STUDY_QUESTIONS = 6;
/** Interviews included in a study when it predates study sizes; $5 of each goes to the person interviewed. */
export const STUDY_INTERVIEWS = 20;

/** Study sizes a sponsor can buy. The smallest is the "Starting at" price. */
export const STUDY_SIZES = [
  { interviews: 20, cents: 14900 },
  { interviews: 50, cents: 34900 },
  { interviews: 100, cents: 64900 },
  { interviews: 250, cents: 149900 },
] as const;

export function studyProductName(interviews: number): string {
  return `Aletheia study: ${interviews} voice interviews`;
}

/** Standard profile fields a study can ask for. Never names, addresses or other identifying details. */
export const PROFILE_FIELDS = {
  county: "County",
  ageRange: "Age range",
  party: "Party",
  voteLikelihood: "Voting plan",
  city: "City or town",
} as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
export type CustomField = { label: string; options: string[] };
export type StudyFields = { standard: ProfileField[]; custom: CustomField[] };

export const MAX_CUSTOM_FIELDS = 3;
export const MAX_CUSTOM_OPTIONS = 8;

/** The general voter interview asks all four civic fields. */
export const VOTER_FIELDS: StudyFields = { standard: ["county", "ageRange", "party", "voteLikelihood"], custom: [] };

/** Study builder default for both kinds: county and age only. Party and voting plan can be turned on. */
export const DEFAULT_STUDY_FIELDS: StudyFields = { standard: ["county", "ageRange"], custom: [] };

/** Fields a study asks for. Studies made before field choice: government skipped party and voting plan. */
export function studyFields(study: { sponsorKind: string; fields?: { standard: string[]; custom: CustomField[] } | null } | null): StudyFields {
  if (!study) return VOTER_FIELDS;
  if (!study.fields) return study.sponsorKind === "government" ? { standard: ["county", "ageRange"], custom: [] } : VOTER_FIELDS;
  return {
    standard: study.fields.standard.filter((f): f is ProfileField => f in PROFILE_FIELDS),
    custom: study.fields.custom.slice(0, MAX_CUSTOM_FIELDS),
  };
}

/** Value stored in the NOT NULL county / age / party / voting-plan columns when a study doesn't ask. */
export const NOT_ASKED = "Not asked";

/** One line describing who was interviewed, skipping fields that weren't asked. */
export function describePerson(s: { county: string; ageRange: string; party: string; voteLikelihood?: string; profile?: Record<string, string> | null }): string {
  const parts = [
    s.county === NOT_ASKED ? "" : `${s.county} County`, s.ageRange, s.party, s.voteLikelihood ?? "",
    ...Object.entries(s.profile ?? {}).map(([k, v]) => (k === PROFILE_FIELDS.city ? v : `${k} ${v}`)),
  ];
  return parts.filter((x) => x && x !== NOT_ASKED).join(" · ");
}
