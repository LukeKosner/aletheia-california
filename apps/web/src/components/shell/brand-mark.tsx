"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * "Aletheiα". Once the page scrolls, "Alethei" folds away and the alpha grows into the logo (globals.css).
 * A two-state toggle with CSS transitions, not a scroll-linked animation: mobile Safari could leave a scroll-linked
 * scale at an odd size (short pages, overscroll bounce). The gap between the two thresholds stops flicker while the
 * page bounces near the top.
 */
export function BrandMark() {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const update = () => setFolded((was) => (was ? window.scrollY > 16 : window.scrollY > 56));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <Link href="/" aria-label="Aletheia" data-folded={folded || undefined} className="brand inline-flex items-baseline rounded-sm text-lg text-stamp font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <span className="brand-stem" aria-hidden>Alethei</span><span className="brand-alpha" aria-hidden>α</span>
    </Link>
  );
}
