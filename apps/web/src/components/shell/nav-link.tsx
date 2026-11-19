"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "./links";

/** A plain text link; the current page is shown in the foreground color. */
export function NavLink({ href, children, className, exact }: { href: string; children: React.ReactNode; className?: string; exact?: boolean }) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", active ? "text-foreground" : "text-muted-foreground", className)}
    >
      {children}
    </Link>
  );
}
