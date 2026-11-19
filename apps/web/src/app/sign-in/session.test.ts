import { describe, expect, test } from "bun:test";
import {
  SESSION_MAX_AGE_SECONDS,
  authConfig,
  checkPassword,
  createSessionToken,
  isOpenPath,
  localDevSignInSkipped,
  safeNextPath,
  teamSignInSkipped,
  verifySessionToken,
} from "./session";

// Test-only values, not real credentials.
const config = { password: "test-password", secret: "test-secret-".padEnd(40, "x") };
const NOW = Date.UTC(2026, 10, 15);

describe("authConfig", () => {
  test("null when unset or the secret is short", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ TEAM_PASSWORD: "a", TEAM_SESSION_SECRET: "short" })).toBeNull();
    expect(authConfig({ TEAM_SESSION_SECRET: config.secret })).toBeNull();
  });
  test("reads both values", () => {
    expect(
      authConfig({ TEAM_PASSWORD: config.password, TEAM_SESSION_SECRET: config.secret }),
    ).toEqual(config);
  });
});

describe("checkPassword", () => {
  test("accepts only the exact password", async () => {
    expect(await checkPassword("test-password", config)).toBe(true);
    expect(await checkPassword("test-passwor", config)).toBe(false);
    expect(await checkPassword("", config)).toBe(false);
  });
});

describe("session tokens", () => {
  test("round trip", async () => {
    const token = await createSessionToken(config, NOW);
    expect(await verifySessionToken(token, config, NOW)).toBe(true);
  });
  test("expire", async () => {
    const token = await createSessionToken(config, NOW);
    const later = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    expect(await verifySessionToken(token, config, later)).toBe(false);
  });
  test("reject a changed expiry", async () => {
    const token = await createSessionToken(config, NOW);
    const [, exp, sig] = token.split(".");
    const forged = `v1.${Number(exp) + 999999}.${sig}`;
    expect(await verifySessionToken(forged, config, NOW)).toBe(false);
  });
  test("reject a different secret or password", async () => {
    const token = await createSessionToken(config, NOW);
    expect(await verifySessionToken(token, { ...config, password: "other" }, NOW)).toBe(false);
    expect(
      await verifySessionToken(token, { ...config, secret: "y".repeat(40) }, NOW),
    ).toBe(false);
  });
  test("reject garbage", async () => {
    expect(await verifySessionToken("", config, NOW)).toBe(false);
    expect(await verifySessionToken("v1.1.abc", config, NOW)).toBe(false);
  });
});

describe("safeNextPath", () => {
  test("keeps relative paths", () => {
    expect(safeNextPath("/log?x=1")).toBe("/log?x=1");
  });
  test("drops anything off-site or looping", () => {
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath("/\\example.com")).toBe("/");
    expect(safeNextPath("/sign-in")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("/\n//example.com")).toBe("/");
    expect(safeNextPath("/\t/example.com")).toBe("/");
  });
});

describe("isOpenPath", () => {
  test("open", () => {
    for (const p of ["/sign-in", "/api/auth/get-session", "/api/auth/magic-link/verify", "/api/mcp", "/api/mcp/x", "/_next/static/a.js", "/favicon.ico"]) {
      expect(isOpenPath(p)).toBe(true);
    }
  });
  test("gated", () => {
    for (const p of ["/", "/log", "/ask", "/api/other", "/api/mcpx", "/api/authx", "/sign-in-x"]) {
      expect(isOpenPath(p)).toBe(false);
    }
  });
});

describe("localDevSignInSkipped", () => {
  test("only next dev skips sign-in", () => {
    expect(localDevSignInSkipped({ NODE_ENV: "development" })).toBe(true);
    expect(localDevSignInSkipped({ NODE_ENV: "production" })).toBe(false);
    expect(localDevSignInSkipped({ NODE_ENV: "test" })).toBe(false);
    expect(localDevSignInSkipped({})).toBe(false);
  });
});

describe("teamSignInSkipped", () => {
  test("local dev or OPEN_TESTING skips team sign-in; nothing else does", () => {
    expect(teamSignInSkipped({ NODE_ENV: "development" })).toBe(true);
    expect(teamSignInSkipped({ NODE_ENV: "production", OPEN_TESTING: "true" })).toBe(true);
    expect(teamSignInSkipped({ NODE_ENV: "production" })).toBe(false);
    expect(teamSignInSkipped({ NODE_ENV: "production", OPEN_TESTING: "false" })).toBe(false);
    expect(teamSignInSkipped({ NODE_ENV: "production", PUBLIC_SITE: "true" })).toBe(false);
  });
});
