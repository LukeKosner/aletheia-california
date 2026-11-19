import { flags } from "@/lib/flags";
import { ABOUT_LINKS, BROWSE_LINKS } from "./links";
import { NavLink } from "./nav-link";

/** Two groups: places to browse on the left, method and fine print on the right. */
export function SiteFooter({ signOut }: { signOut?: React.ReactNode }) {
  return (
    <footer className="mt-auto border-t border-border print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav aria-label="Browse" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {BROWSE_LINKS.map((link) => <NavLink key={link.href} href={link.href}>{link.label}</NavLink>)}
        </nav>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <nav aria-label="About" className="flex gap-4">
            {ABOUT_LINKS.map((link) => <NavLink key={link.href} href={link.href}>{link.label}</NavLink>)}
          </nav>
          {/* Hidden when the button renders nothing (sign-in page, local dev); left out on the open test site. */}
          {!flags.PUBLIC_SITE && !flags.OPEN_TESTING ? <div className="border-l border-border pl-4 empty:hidden">{signOut}</div> : null}
        </div>
      </div>
    </footer>
  );
}
