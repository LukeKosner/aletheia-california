import { readFlags } from "@/lib/flags";
import { HEADER_LINKS } from "./links";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

export function SiteHeader() {
  const links = readFlags().INTERVIEW_PREVIEW ? HEADER_LINKS : [];
  return (
    <header className="sticky top-0 z-40 print:hidden border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-center gap-6 px-4 sm:justify-start sm:px-6">
        <BrandMark />
        {/* Phones show only the centered wordmark; the home page links to interviews and studies. */}
        <nav aria-label="Main" className="ml-auto hidden sm:block">
          <ul className="flex items-center gap-6 text-sm">
            {links.map((link) => <li key={link.href}><NavLink href={link.href} exact={link.exact}>{link.label}</NavLink></li>)}
          </ul>
        </nav>
      </div>
    </header>
  );
}
