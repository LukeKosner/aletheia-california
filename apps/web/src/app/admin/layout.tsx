import { Suspense, type ReactNode } from "react";
import { currentAdminIdentity, isAdmin } from "@/app/api/admin/auth";
async function Gate({ children }: {
    children: ReactNode;
}) {
    const identity = await currentAdminIdentity();
    if (!isAdmin(identity))
        return <main className="mx-auto max-w-3xl space-y-4 px-4 py-12"><h1 className="font-heading text-3xl">Administrator access required</h1><p>A verified session matching one of the two configured administrator email addresses is required. The private team password does not grant administrator access.</p><p className="text-sm text-muted-foreground">Use team email sign-in after the verified sender and administrator allowlist are configured.</p></main>;
    return children;
}
export default function Layout({ children }: {
    children: ReactNode;
}) { return <Suspense fallback={<p role="status">Checking administrator access…</p>}><Gate>{children}</Gate></Suspense>; }
