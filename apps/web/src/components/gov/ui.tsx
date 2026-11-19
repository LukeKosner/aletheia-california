import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** A plain GET form: works without JavaScript and keeps results linkable. */
export function SearchBox({ action, name = "q", defaultValue, placeholder, size = "default", hidden }: {
  action: string; name?: string; defaultValue?: string; placeholder: string; size?: "default" | "lg"; hidden?: Record<string, string>;
}) {
  return (
    <form action={action} role="search" className="relative w-full print:hidden">
      {Object.entries(hidden ?? {}).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <Search aria-hidden className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground", size === "lg" ? "left-4 size-5" : "left-3 size-4")} />
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        maxLength={80}
        className={cn(
          "w-full rounded-xl border border-input bg-background outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
          size === "lg" ? "h-14 pl-12 pr-28 text-base shadow-sm" : "h-10 pl-9 pr-20 text-sm",
        )}
      />
      <button type="submit" className={cn("absolute top-1/2 -translate-y-1/2 rounded-lg bg-primary font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50", size === "lg" ? "right-2 h-10 px-4 text-sm" : "right-1.5 h-7 px-3 text-xs")}>
        Search
      </button>
    </form>
  );
}

/**
 * Every page uses this container so content lines up with the header:
 * same max width, gutters and vertical rhythm (gap-10 between blocks).
 * `narrow` caps the reading width but keeps the left edge aligned.
 */
export function Page({ children, narrow, className }: { children: React.ReactNode; narrow?: boolean; className?: string }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <div className={cn("flex flex-col gap-10", narrow && "max-w-2xl", className)}>{children}</div>
    </main>
  );
}

export function PageTitle({ title, children, back }: { title: React.ReactNode; children?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="flex flex-col gap-2">
      {back ? <Link href={back.href} className="w-fit text-sm print:hidden text-muted-foreground hover:text-foreground">{back.label}</Link> : null}
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </header>
  );
}

export function Section({ title, note, children, className }: { title: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Download({ href }: { href: string }) {
  return <a href={href} className="text-xs text-muted-foreground hover:text-foreground print:hidden" download>Download CSV</a>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ExternalLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={cn("text-stamp underline-offset-4 hover:underline", className)}>{children}</a>;
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />)}
    </div>
  );
}
