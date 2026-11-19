"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Loader2, MapPin } from "lucide-react";

type Legislator = { id: string; name: string; house: "Assembly" | "Senate"; district: number; party: string };
type Result = { assembly: number; senate: number; matchedAddress: string };

export function DistrictFinder({ legislators }: { legislators: Legislator[] }) {
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/district", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as (Result & { error?: string }) | null;
      if (!response.ok || !body || body.error) setError(body?.error ?? "Lookup failed. Try again.");
      else setResult(body);
    } catch {
      setError("Lookup failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  const rows = result
    ? ([["Assembly", result.assembly], ["Senate", result.senate]] as const).map(([house, district]) => ({
        house,
        district,
        member: legislators.find((l) => l.house === house && l.district === district),
      }))
    : [];

  return (
    <div className="w-full space-y-3">
      <form onSubmit={onSubmit} className="relative w-full">
        <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Your home address"
          aria-label="Your home address"
          autoComplete="street-address"
          minLength={5}
          maxLength={200}
          required
          className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-20 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
        />
        <button
          type="submit"
          disabled={pending}
          className="absolute right-1.5 top-1/2 inline-flex h-7 -translate-y-1/2 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          {pending ? <Loader2 aria-label="Looking up" className="size-3.5 animate-spin" /> : "Find"}
        </button>
      </form>
      {error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}
      {result && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map(({ house, district, member }) => {
            const label = <span className="font-medium">{house} District {district}</span>;
            return (
              <li key={house}>
                {member ? (
                  <Link href={`/legislators/${member.id}`} className="flex items-center gap-2 px-3 py-2.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent">
                    <span className="min-w-0 flex-1 truncate">
                      {label} — {member.name} <span className="text-muted-foreground">· {member.party}</span>
                    </span>
                  </Link>
                ) : (
                  <p className="px-3 py-2.5 text-sm">{label} <span className="text-muted-foreground">— no current member on file</span></p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
