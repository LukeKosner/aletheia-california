"use server";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  authConfig,
  checkPassword,
  createSessionToken,
  safeNextPath,
} from "./session";

export type SignInState = { error?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const config = authConfig();
  if (!config) {
    return { error: "Team sign-in is not set up on this server yet." };
  }
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password, config))) {
    return { error: "That password is not correct." };
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(config, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(String(formData.get("next") ?? "/")));
}

export async function signOut(): Promise<void> {
  const auth = getAuth();
  if (auth) {
    try { await auth.api.signOut({ headers: await headers() }); } catch { /* Clear local access even when auth storage is unavailable. */ }
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete("better-auth.session_token");
  store.delete("__Secure-better-auth.session_token");
  redirect("/sign-in");
}
