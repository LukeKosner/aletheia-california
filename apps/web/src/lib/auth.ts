import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { Resend } from "resend";
import { createDb, authUser, authSession, authAccount, authVerification, authRateLimit } from "@aletheia/db";
import { campusChoice, emailAllowed, emailAuthConfig } from "./auth-policy";

function createAuth(config: NonNullable<ReturnType<typeof emailAuthConfig>>) {
  const resend = new Resend(config.apiKey);
  return betterAuth({
    appName: "Aletheia",
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(createDb(config.databaseURL), { provider: "pg", schema: {
      user: authUser, session: authSession, account: authAccount, verification: authVerification, rateLimit: authRateLimit,
    } }),
    advanced: { database: { generateId: "uuid" }, useSecureCookies: config.baseURL.startsWith("https:") },
    emailAndPassword: { enabled: false },
    user: { additionalFields: { campus: { type: "string", required: false, input: false } } },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/magic-link" && !emailAllowed(ctx.body?.email)) throw new APIError("FORBIDDEN", { message: "Sign-in is restricted to the configured team." });
      // Campus changes use the verified server action; arbitrary profile updates are closed.
      if (ctx.path === "/update-user" && ctx.body?.campus !== undefined && !campusChoice(ctx.body.campus)) throw new APIError("BAD_REQUEST", { message: "Choose a listed campus or leave it blank." });
    }) },
    databaseHooks: { user: { create: { before: async (user) => {
      if (!emailAllowed(user.email)) return false;
      return { data: { ...user, email: user.email.trim().toLowerCase() } };
    } } } },
    plugins: [magicLink({
      expiresIn: 300,
      storeToken: "hashed",
      // Private team members can create their account; hooks enforce the allowlist.
      disableSignUp: false,
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: async ({ email, url }) => {
        if (!emailAllowed(email)) throw new APIError("FORBIDDEN", { message: "Team sign-in required." });
        const { error } = await resend.emails.send({ from: config.from, to: email, subject: "Sign in to Aletheia", text: `Open this single-use link to sign in to Aletheia. It expires in five minutes.\n\n${url}\n\nIf you did not request it, you can ignore this email.` });
        if (error) throw new APIError("SERVICE_UNAVAILABLE", { message: "Email delivery is unavailable. Please try again later." });
      },
    }), nextCookies()],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
/** No client, network request, or secret fallback when configuration is incomplete. */
export function getAuth() {
  const config = emailAuthConfig();
  if (!config) return null;
  return instance ??= createAuth(config);
}
