"use client";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { dollars, REWARD_CENTS } from "@/lib/interview/taxonomy";

const DISMISSED = "aletheia_interview_offer_dismissed";
const FIRST_SEEN = "aletheia_first_seen";
/** Wait until the visitor has been on the site this long (across pages) before offering. */
const DELAY_MS = 60_000;

/** Pages that already offer the interview, or where an offer would interrupt. */
function hiddenOn(pathname: string) {
  return pathname === "/" || pathname.startsWith("/interview") || pathname.startsWith("/sign-in");
}

/** A small bottom-right link offering the voice interview. Shown once, after a minute on the site. */
export function InterviewOffer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let firstSeen = Date.now();
    try {
      if (localStorage.getItem(DISMISSED) === "1") return;
      const saved = Number(sessionStorage.getItem(FIRST_SEEN));
      if (saved > 0) firstSeen = saved;
      else sessionStorage.setItem(FIRST_SEEN, String(firstSeen));
    } catch { /* storage unavailable: fall back to time on this page */ }
    const t = setTimeout(() => setOpen(true), Math.max(0, firstSeen + DELAY_MS - Date.now()));
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(DISMISSED, "1"); } catch { /* storage unavailable */ }
  }

  if (!open || hiddenOn(pathname)) return null;
  return (
    <div className="fixed right-4 bottom-20 z-50 flex items-center gap-1 rounded-full border border-border bg-background py-1 pr-1 pl-3.5 text-sm shadow-sm animate-in fade-in slide-in-from-bottom-2 print:hidden">
      <Link href="/interview" onClick={dismiss} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        Share your views, get {dollars(REWARD_CENTS)}
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss interview offer" className="rounded-full p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
