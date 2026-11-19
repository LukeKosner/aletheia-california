import { Suspense } from "react";
import type { Metadata } from "next";
import { EmailForm } from "./email-form";
import { emailAuthConfig } from "@/lib/auth-policy";
import { SignInForm } from "./sign-in-form";
import { redirect } from "next/navigation";
import { safeNextPath, teamSignInSkipped } from "./session";

export const metadata: Metadata = { title: "Team sign-in — Aletheia" };

async function Form({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const { next, email_error } = await searchParams;
  const path = safeNextPath(typeof next === "string" ? next : undefined);
  // Nothing to sign in to on the open test site or in local dev.
  if (teamSignInSkipped()) redirect(path);
  return <>{email_error ? <p role="alert" className="mb-4 text-sm text-destructive">That sign-in link could not be used. It may have expired, already been used, or no longer be permitted. Request a new link or use the team password.</p> : null}{emailAuthConfig() ? <EmailForm next={path} /> : null}<SignInForm next={path} /></>;
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-border p-6">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">Aletheia is in private preview.</p>
        <Suspense fallback={<SignInForm next="/" />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
