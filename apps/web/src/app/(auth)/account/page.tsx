import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import { campusLabels } from "@/lib/auth-policy";
import { readFlags } from "@/lib/flags";
import { safeNextPath } from "@/app/sign-in/session";
import { saveCampus } from "./actions";

async function Account({ searchParams }: PageProps<"/account">) {
  const [identity, search] = await Promise.all([currentVerifiedIdentity(), searchParams]);
  if (!identity) redirect("/sign-in");
  const labels = campusLabels(readFlags().CAMPUS_LABELS);
  return <main className="mx-auto w-full max-w-lg p-6 py-16">
    <h1 className="font-heading text-3xl">You’re signed in</h1>
    <p className="mt-3 text-muted-foreground">Campus is optional and self-selected. It is used only to group activity on the campus game.</p>
    <form action={saveCampus} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={safeNextPath(typeof search.next === "string" ? search.next : undefined)} />
      <label htmlFor="campus">Campus (optional)</label>
      <select id="campus" name="campus" defaultValue="" className="rounded-md border border-border bg-background p-3">
        <option value="">Prefer not to say / clear selection</option>
        {Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <button className="rounded-md bg-primary p-3 text-primary-foreground" type="submit">Continue</button>
    </form>
  </main>;
}
export default function Page(props: PageProps<"/account">) {
  return <Suspense fallback={<p className="p-8" role="status">Loading account…</p>}><Account {...props} /></Suspense>;
}
