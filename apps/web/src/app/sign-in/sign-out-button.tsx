"use client";

import { usePathname } from "next/navigation";
import { signOut } from "./actions";

export function SignOutButton() {
  // Nothing to sign out of on the sign-in page, or in local dev (no sign-in).
  const pathname = usePathname();
  if (pathname === "/sign-in" || process.env.NODE_ENV === "development") return null;
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Sign out
      </button>
    </form>
  );
}
