"use server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createDb, authUser } from "@aletheia/db";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import { campusChoice, emailAuthConfig } from "@/lib/auth-policy";
import { safeNextPath } from "@/app/sign-in/session";

export async function saveCampus(form: FormData) {
  const identity = await currentVerifiedIdentity();
  const config = emailAuthConfig();
  if (!identity || !config) redirect("/sign-in");
  const raw = form.get("campus");
  const campus = raw === "" ? null : campusChoice(raw);
  if (raw !== "" && !campus) return;
  // auth_server can update only identity tables. No agent or browser DB client.
  await createDb(config.databaseURL).update(authUser).set({ campus, updatedAt: new Date() }).where(eq(authUser.id, identity.userId));
  redirect(safeNextPath(String(form.get("next") ?? "/")));
}
