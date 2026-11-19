import { describe, expect, test } from "bun:test";
import { campusChoice, campusLabels, emailAllowed, emailAuthConfig, identityFromSession, isTeamEmail, roleUrl } from "./auth-policy";

// Reserved example.com addresses and random UUIDs are security test inputs,
// never public filing data, real accounts, or a persisted activity fixture.
const env = { AUTH_TEAM_EMAILS: "team@example.com,second@example.com", PUBLIC_SIGNUP: "false" };
const id = crypto.randomUUID();
function session() { return { user: { id, email: "TEAM@example.com", emailVerified: true }, session: { userId: id, expiresAt: new Date(Date.now() + 60_000) } }; }
describe("private email policy", () => {
  test("exact normalized allowlist; empty configuration fails closed", () => {
    expect(isTeamEmail(" Team@Example.com ", env)).toBe(true);
    for (const email of ["team+alias@example.com", "team@example.com.attacker.invalid", "attacker@example.com", "team@example.com\nattacker@example.com"]) expect(emailAllowed(email, env)).toBe(false);
    expect(emailAllowed("team@example.com", {})).toBe(false);
    expect(emailAllowed("team@example.com", { PUBLIC_SIGNUP: "true" })).toBe(true);
    expect(emailAllowed("invalid", { PUBLIC_SIGNUP: "true" })).toBe(false);
  });
  test("only the dedicated role URL is accepted", () => {
    expect(roleUrl("postgres://auth_server:unit-test@localhost/test", "auth_server")).not.toBeNull();
    expect(roleUrl("postgres://owner:unit-test@localhost/test", "auth_server")).toBeNull();
    expect(roleUrl("https://auth_server@example.com", "auth_server")).toBeNull();
    expect(roleUrl(undefined, "auth_server")).toBeNull();
  });
  test("sender, role, origin, enablement and credentials must all be ready", () => {
    const ready = { AUTH_TEAM_EMAILS: "team@example.com", AUTH_EMAIL_ENABLED: "true", AUTH_SENDER_VERIFIED: "true", AUTH_DATABASE_URL: "postgres://auth_server:unit-test@localhost/test", BETTER_AUTH_SECRET: "s".repeat(32), AUTH_EMAIL_FROM: "signin@example.com", RESEND_API_KEY: "unit-test-only", BETTER_AUTH_URL: "https://example.com" };
    expect(emailAuthConfig(ready)?.baseURL).toBe("https://example.com");
    for (const key of Object.keys(ready)) expect(emailAuthConfig({ ...ready, [key]: "" })).toBeNull();
    for (const base of ["http://example.com", "https://example.com/path", "https://user:password@example.com", "https://example.com?next=attacker"]) expect(emailAuthConfig({ ...ready, BETTER_AUTH_URL: base })).toBeNull();
    expect(emailAuthConfig({ ...ready, AUTH_DATABASE_URL: "postgres://owner:unit-test@localhost/test" })).toBeNull();
    expect(emailAuthConfig({ ...ready, BETTER_AUTH_SECRET: "short" })).toBeNull();
    expect(emailAuthConfig({ ...ready, BETTER_AUTH_URL: "http://localhost:3001" })).not.toBeNull();
  });
  test("campus selection stays optional and bounded; labels follow the flag", () => {
    expect(campusChoice("stanford")).toBe("stanford");
    expect(campusChoice("berkeley")).toBe("berkeley");
    expect(campusChoice("neither")).toBe("neither");
    expect(campusChoice("arbitrary")).toBeNull();
    expect(campusChoice(null)).toBeNull();
    expect(campusLabels("names").stanford).toBe("Stanford");
    expect(campusLabels("nicknames").berkeley).toBe("Bears");
  });
});
describe("verified server session identity", () => {
  test("requires verified email, matching UUID identity, future expiry and current allowlist", () => {
    expect(identityFromSession(session(), env)).toEqual({ userId: id, email: "team@example.com", emailVerified: true });
    const expired = session(); expired.session.expiresAt = new Date(0);
    expect(identityFromSession(expired, env)).toBeNull();
    const unverified = session(); unverified.user.emailVerified = false;
    expect(identityFromSession(unverified, env)).toBeNull();
    const mismatched = session(); mismatched.session.userId = crypto.randomUUID();
    expect(identityFromSession(mismatched, env)).toBeNull();
    expect(identityFromSession(session(), { AUTH_TEAM_EMAILS: "" })).toBeNull();
    expect(identityFromSession({ aletheia_team: "signed-team-cookie" }, env)).toBeNull();
    expect(identityFromSession(null, env)).toBeNull();
  });
});
