"use client";

import { Printer } from "lucide-react";

/** Prints the page as a one-page brief (print styles hide navigation and controls). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground print:hidden">
      <Printer aria-hidden className="size-4" /> Save as PDF
    </button>
  );
}
