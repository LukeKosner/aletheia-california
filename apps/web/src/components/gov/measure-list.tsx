import Link from "next/link";
import { money, type MeasureSummary } from "@/lib/gov";

/** Compact money: $34.8M, $950K. */
const short = (value: number) => value >= 1e6 ? `$${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M` : value >= 1e3 ? `$${Math.round(value / 1e3)}K` : money(value);

export function MeasureList({ measures, limit }: { measures: MeasureSummary[]; limit?: number }) {
  const shown = limit ? [...measures].sort((a, b) => (b.yes + b.no) - (a.yes + a.no)).slice(0, limit) : measures;
  const max = Math.max(1, ...shown.map((m) => Math.max(m.yes, m.no)));
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {shown.map((m) => (
        <li key={m.number}>
          <Link href={`/measures/${m.year}/${m.number}`} className="grid grid-cols-[4.5rem_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-accent sm:grid-cols-[4.5rem_1fr_16rem]">
            <span className="text-sm font-semibold">Prop {m.number}</span>
            <span className="min-w-0 truncate text-sm" title={m.title}>{m.title}</span>
            <span className="col-span-2 flex flex-col gap-1 sm:col-span-1" aria-label={`Yes side ${money(m.yes)}, No side ${money(m.no)}`}>
              {([["Yes", m.yes, "bg-stamp"], ["No", m.no, "bg-muted-foreground/50"]] as const).map(([label, value, color]) => (
                <span key={label} className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                  <span className="w-6">{label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${color}`} style={{ width: `${(value / max) * 100}%` }} /></span>
                  <span className="w-12 text-right">{short(value)}</span>
                </span>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
