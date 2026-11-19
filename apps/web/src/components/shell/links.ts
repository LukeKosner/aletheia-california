/**
 * Header, shown when INTERVIEW_PREVIEW is on: the home page is where you ask, so the header leads to interviews,
 * studies and insights. `exact` keeps Interview from lighting up on its sub-pages (Insights, studies).
 */
export const HEADER_LINKS: readonly { href: string; label: string; exact?: boolean }[] = [
  { href: "/interview", label: "Interview", exact: true },
  { href: "/interview/studies/new?kind=business", label: "Business" },
  { href: "/interview/studies/new?kind=government", label: "Government" },
  { href: "/interview/insights", label: "Insights" },
];

/** Footer, left: places to browse. */
export const BROWSE_LINKS = [
  { href: "/legislators", label: "Legislators" },
  { href: "/measures", label: "Measures" },
  { href: "/search", label: "Search" },
] as const;

/** Footer, right: how it works and the fine print. */
export const ABOUT_LINKS = [
  { href: "/method", label: "Method" },
  { href: "/log", label: "Build log" },
  { href: "/corrections", label: "Corrections" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/** True when `href` is the current page or one of its sub-pages. */
export function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
