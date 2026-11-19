import Link from "next/link";
import { connection } from "next/server";
import { percent, tally } from "@/lib/interview/insights";
import { completedSessions, listResearch } from "@/lib/interview/store";
import { NOT_ASKED } from "@/lib/interview/taxonomy";

type Session = Awaited<ReturnType<typeof completedSessions>>[number];

/** Top issues as horizontal bars: share of interviews that raised each one. One series, so one hue (the accent). */
function IssueBars({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <figure className="flex flex-col gap-6">
      <figcaption className="text-sm font-medium text-muted-foreground">Top issues, share of interviews</figcaption>
      <ol className="flex flex-col gap-5">
        {rows.map(([issue, n]) => (
          <li key={issue} className="flex flex-col gap-2" title={`${issue}: raised in ${n} of ${total} interviews`}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{issue}</span>
              <span className="text-sm tabular-nums text-muted-foreground">{percent(n, total)}%</span>
            </div>
            <div aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-stamp" style={{ width: `${Math.max(2, percent(n, total))}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** The summary from the latest public interview. Summaries are public; shown as written. */
function Featured({ session }: { session: Session }) {
  const who = [session.ageRange, session.county === NOT_ASKED ? "" : `${session.county} County`].filter((v) => v && v !== NOT_ASKED);
  return (
    <figure className="flex flex-col gap-4 rounded-2xl bg-muted p-6 sm:p-8">
      <blockquote className="line-clamp-6 text-pretty text-lg leading-relaxed">{session.summary}</blockquote>
      {who.length ? <figcaption className="text-sm text-muted-foreground">{who.join(", ")}</figcaption> : null}
    </figure>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

/** Highlights from public voter interviews (study interviews are private to their sponsor), plus recently answered research. */
export async function HomeStats() {
  await connection();
  let sessions: Session[];
  let research: Awaited<ReturnType<typeof listResearch>>;
  try {
    const [rows, voter, periodic] = await Promise.all([
      completedSessions(2000, { publicOnly: true }),
      listResearch({ origin: "voter" }, 1000),
      listResearch({ origin: "periodic" }, 1000),
    ]);
    sessions = rows;
    research = [...voter, ...periodic].filter((r) => r.status === "completed").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch {
    return null; // Interview storage not set up: show nothing rather than an error.
  }

  if (!sessions.length) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-6">
        <p className="font-medium">No interviews yet.</p>
        <Link href="/interview" className="text-sm font-medium text-stamp underline-offset-4 hover:underline">Be the first</Link>
      </div>
    );
  }

  const issues = tally(sessions.map((s) => s.issues.filter((i) => i !== "Other"))).slice(0, 5);
  const counties = new Set(sessions.map((s) => s.county).filter((c) => c !== NOT_ASKED)).size;
  const featured = sessions.find((s) => s.summary?.trim()) ?? null; // Newest first, so the latest summary.
  const recent = research.slice(0, 4);

  return (
    <div className="flex flex-col gap-16">
      <div className="grid gap-12 lg:grid-cols-5 lg:gap-16">
        {issues.length ? <div className="lg:col-span-3"><IssueBars rows={issues} total={sessions.length} /></div> : null}
        <div className={`flex flex-col gap-10 ${issues.length ? "lg:col-span-2" : "lg:col-span-5"}`}>
          {featured ? <Featured session={featured} /> : null}
          <div className="grid grid-cols-2 gap-6">
            <Stat value={sessions.length.toLocaleString("en-US")} label={sessions.length === 1 ? "Interview" : "Interviews"} />
            <Stat value={`${counties}/58`} label="Counties" />
          </div>
        </div>
      </div>
      {recent.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Recently researched</h3>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/interview/reports/${r.id}`} className="group flex items-center justify-between gap-4 py-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="text-pretty group-hover:underline group-hover:underline-offset-4">{r.question}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
