/**
 * Feature flags read from environment variables.
 * Every flag defaults to off except SHOW_INDIVIDUAL_DONORS.
 * Keep PUBLIC_SITE off: with it off, every page requires team sign-in.
 */

type Env = Record<string, string | undefined>;

const TRUE = new Set(["1", "true", "on", "yes"]);
const FALSE = new Set(["0", "false", "off", "no"]);

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return fallback;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = value?.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
}

export const PRICING_MODES = ["monthly", "single"] as const;
export const CAMPUS_LABEL_MODES = ["names", "nicknames"] as const;

export function readFlags(env: Env = process.env) {
  return {
    /** Off = every page needs team sign-in. */
    PUBLIC_SITE: bool(env.PUBLIC_SITE, false),
    PUBLIC_SIGNUP: bool(env.PUBLIC_SIGNUP, false),
    SHOW_INDIVIDUAL_DONORS: bool(env.SHOW_INDIVIDUAL_DONORS, true),
    CARDS_PUBLIC: bool(env.CARDS_PUBLIC, false),
    PAYMENTS_ENABLED: bool(env.PAYMENTS_ENABLED, false),
    PRICING_MODE: oneOf(env.PRICING_MODE, PRICING_MODES, "monthly"),
    BLOCK_COMMITTEE_DOMAINS: bool(env.BLOCK_COMMITTEE_DOMAINS, false),
    CAMPUS_LABELS: oneOf(env.CAMPUS_LABELS, CAMPUS_LABEL_MODES, "names"),
    CAMPUS_GAME: bool(env.CAMPUS_GAME, false),
    LOCAL_FILERS: bool(env.LOCAL_FILERS, false),
    FORM700: bool(env.FORM700, false),
    /** Voter-interview prototype. On = /interview and /api/interview open without team sign-in (local preview only). */
    INTERVIEW_PREVIEW: bool(env.INTERVIEW_PREVIEW, false),
    /** Open test site: no team sign-in anywhere. Admin-only actions still need a verified admin. PUBLIC_SITE stays off. */
    OPEN_TESTING: bool(env.OPEN_TESTING, false),
  } as const;
}

export type Flags = ReturnType<typeof readFlags>;

export const flags: Flags = readFlags();
