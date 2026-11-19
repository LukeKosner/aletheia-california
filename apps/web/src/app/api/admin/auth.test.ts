import { describe, expect, mock, test } from "bun:test";
// Next replaces this marker during server compilation. Offline Bun tests load
// the same server modules directly; no network or identity provider is mocked.
mock.module("server-only", () => ({}));
const { adminEmails, body, currentAdminIdentity, isAdmin, requireTeam, sameOrigin } = await import("./auth");
const { currentVerifiedIdentity } = await import("@/lib/auth-session");
import { createSessionToken, SESSION_COOKIE } from "@/app/sign-in/session";
// Protocol-only auth inputs, not identities or public-filing fixtures.
const env = { TEAM_PASSWORD: "unit-test-password", TEAM_SESSION_SECRET: "unit-test-secret".padEnd(40, "x"), PUBLIC_SITE: "off" };
describe("administrator and mutation boundaries", () => {
    test("requires exactly two configured, distinct administrator addresses", () => {
        expect(adminEmails({})).toBeNull();
        expect(adminEmails({ ADMIN_EMAILS: "" })).toBeNull();
        expect(adminEmails({ ADMIN_EMAILS: "invalid,invalid" })).toBeNull();
        expect(isAdmin(null, {})).toBe(false);
    });
    test("allowlist requires verified identity, not an email-shaped input", () => {
        // Reserved invalid-domain syntax values test the protocol, not real people.
        const configured = { ADMIN_EMAILS: "a@example.invalid,b@example.invalid" };
        const identity = { userId: "unit-test-subject", email: "A@example.invalid", emailVerified: true as const };
        expect(isAdmin(identity, configured)).toBe(true);
        expect(isAdmin(identity, { ADMIN_EMAILS: "a@example.invalid,a@example.invalid" })).toBe(false);
        expect(isAdmin({ ...identity, email: "c@example.invalid" }, configured)).toBe(false);
        expect(isAdmin({ ...identity, emailVerified: false } as unknown as typeof identity, configured)).toBe(false);
    });
    test("admin identity uses the verified server resolver and incomplete configuration stays closed", async () => {
        expect(currentAdminIdentity).toBe(currentVerifiedIdentity);
        expect(await currentAdminIdentity()).toBeNull();
    });
    test("team cookie grants private access but is never an admin identity", async () => {
        const token = await createSessionToken({ password: env.TEAM_PASSWORD, secret: env.TEAM_SESSION_SECRET }, Date.now());
        const request = new Request("https://localhost/api/feedback", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
        expect(await requireTeam(request, env)).toBe(true);
        expect(await currentAdminIdentity()).toBeNull();
        expect(await requireTeam(request, { ...env, PUBLIC_SITE: "on" })).toBe(false);
        expect(await requireTeam(new Request(request.url), env)).toBe(false);
    });
    test("mutation origin cannot be missing or cross-site", () => {
        expect(sameOrigin(new Request("https://localhost/api/feedback"))).toBe(false);
        expect(sameOrigin(new Request("https://localhost/api/feedback", { headers: { origin: "https://localhost" } }))).toBe(true);
        expect(sameOrigin(new Request("https://localhost/api/feedback", { headers: { origin: "null" } }))).toBe(false);
    });
    test("caps streamed request bytes and rejects malformed JSON", async () => {
        await expect(body(new Request("https://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "x" }))).rejects.toThrow();
        await expect(body(new Request("https://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(32769) }))).rejects.toThrow();
    });
});
