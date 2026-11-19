/**
 * /log — the build log.
 *
 * Lists `buildlog/*.mdx` newest first, showing only entries a human has
 * reviewed (frontmatter `reviewer` filled in), above four running charts.
 * The charts are empty until the data behind them exists.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  type BuildlogEntry,
  headlineMetric,
  isHumanWritten,
  isReviewed,
  precisionSeries,
} from "./entries";
import { readEntries } from "./read-entries";
import { BarChart, ChartCard, ChartTable, EmptyPlot, LineChart, type Series } from "./charts";
import { formatCompact, formatDay, formatPercent, formatUsd } from "./chart-geometry";
import { type DayPoint, WINDOW_DAYS, readDbMetrics } from "./metrics";
import { Markdown } from "./markdown-view";
import { ShareButton } from "./share-button";
import { buildShareText } from "./share";

export const metadata: Metadata = {
  title: "Build log — Aletheia",
  description: "What shipped, what it cost and what broke, one entry per pull request.",
};

const WINDOW = `Last ${WINDOW_DAYS} days.`;

const percent = (n: number) => formatPercent(n, Number.isInteger(n * 100) ? 0 : 1);

function sum(points: DayPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

function latest(points: DayPoint[]): number | undefined {
  return points[points.length - 1]?.value;
}

// --- charts ----------------------------------------------------------------

function CostChart({ points, note }: { points: DayPoint[]; note?: string }) {
  const current = latest(points);
  return (
    <ChartCard
      title="Cost per verified investigation"
      subtitle={`A day's total spend divided by the investigations verified that day. ${WINDOW}`}
      stat={current === undefined ? undefined : formatUsd(current)}
      statLabel="latest day"
      table={
        <ChartTable
          caption="Cost per verified investigation by day"
          columns={["Day", "Cost"]}
          rows={points.map((p) => [formatDay(p.day), formatUsd(p.value)])}
        />
      }
    >
      {points.length === 0 ? (
        <EmptyPlot message={note ?? "No verified investigations yet."} />
      ) : (
        <LineChart
          label="Cost per verified investigation by day, in US dollars"
          format={formatUsd}
          series={[{ key: "cost", name: "Cost per verified investigation", tone: "primary", points }]}
        />
      )}
    </ChartCard>
  );
}

function CatchChart({ points, note }: { points: DayPoint[]; note?: string }) {
  const total = sum(points);
  return (
    <ChartCard
      title="Verifier catch count"
      subtitle={`Claims the verifier marked overstated or unsupported. ${WINDOW}`}
      stat={points.length === 0 ? undefined : formatCompact(total)}
      statLabel="caught in window"
      table={
        <ChartTable
          caption="Claims caught by the verifier, by day"
          columns={["Day", "Caught"]}
          rows={points.map((p) => [formatDay(p.day), formatCompact(p.value)])}
        />
      }
    >
      {points.length === 0 ? (
        <EmptyPlot message={note ?? "No verified claims yet."} />
      ) : (
        <BarChart
          label="Claims caught by the verifier, by day"
          name="Caught"
          format={formatCompact}
          points={points}
        />
      )}
    </ChartCard>
  );
}

function ReachChart({
  shares,
  cardViews,
  note,
}: {
  shares: DayPoint[];
  cardViews: DayPoint[];
  note?: string;
}) {
  const series: Series[] = [
    { key: "card_views", name: "Card views", tone: "primary", points: cardViews },
    { key: "shares", name: "Shares", tone: "secondary", points: shares },
  ];
  const empty = shares.length === 0 && cardViews.length === 0;

  return (
    <ChartCard
      title="Shares and card views"
      subtitle={`Share and card view events, per day. ${WINDOW}`}
      stat={empty ? undefined : formatCompact(sum(cardViews))}
      statLabel="card views in window"
      table={
        <ChartTable
          caption="Shares and card views by day"
          columns={["Day", "Card views", "Shares"]}
          rows={cardViews.map((p, i) => [
            formatDay(p.day),
            formatCompact(p.value),
            formatCompact(shares[i]?.value ?? 0),
          ])}
        />
      }
    >
      {empty ? (
        <EmptyPlot message={note ?? "No share or card view events yet."} />
      ) : (
        <LineChart label="Shares and card views by day" format={formatCompact} series={series} />
      )}
    </ChartCard>
  );
}

function PrecisionChart({ entries }: { entries: BuildlogEntry[] }) {
  const points = precisionSeries(entries);
  const current = points[points.length - 1]?.value;

  return (
    <ChartCard
      title="Entity-match precision"
      subtitle="Reported by entity resolution in each build log entry (metrics.entity_match_precision)."
      stat={current === undefined ? undefined : percent(current)}
      statLabel="latest run"
      table={
        <ChartTable
          caption="Entity-match precision by build log entry"
          columns={["Entry", "Precision"]}
          rows={points.map((p) => [p.slug, percent(p.value)])}
        />
      }
    >
      {points.length === 0 ? (
        <EmptyPlot message="No entry reports entity_match_precision yet." />
      ) : (
        <LineChart
          label="Entity-match precision by build log entry"
          format={percent}
          series={[
            {
              key: "precision",
              name: "Entity-match precision",
              tone: "primary",
              points: points.map((p) => ({ day: p.date, value: p.value })),
            },
          ]}
        />
      )}
    </ChartCard>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <ChartCard title={title} subtitle={WINDOW}>
      <EmptyPlot message="Loading…" />
    </ChartCard>
  );
}

/** The database-backed charts. Read at request time, never prerendered. */
async function DbCharts() {
  const metrics = await readDbMetrics();
  return (
    <>
      <CostChart points={metrics.costPerVerified} note={metrics.note} />
      <CatchChart points={metrics.verifierCatches} note={metrics.note} />
      <ReachChart shares={metrics.shares} cardViews={metrics.cardViews} note={metrics.note} />
    </>
  );
}

// --- entries ---------------------------------------------------------------

function Entry({ entry }: { entry: BuildlogEntry }) {
  const shareText = buildShareText({
    task: entry.task,
    date: entry.date,
    metric: headlineMetric(entry),
  });

  return (
    <li id={entry.slug} className="scroll-mt-8 border-t border-border pt-8 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
            <time dateTime={entry.date}>{entry.date}</time>
            <span aria-hidden> · </span>
            {entry.time}
            <span aria-hidden> · </span>
            {entry.author || "unattributed"}
            <span aria-hidden> · </span>
            reviewed by {entry.reviewer}
          </p>
          <h2 className="mt-1 font-heading text-lg font-semibold tracking-tight text-foreground">
            {entry.task || entry.slug}
          </h2>
        </div>
        {isHumanWritten(entry) ? <ShareButton text={shareText} entryTask={entry.task} /> : null}
      </div>
      <div className="mt-3">
        <Markdown source={entry.body} />
      </div>
    </li>
  );
}

// --- page ------------------------------------------------------------------

export default async function LogPage() {
  const entries = await readEntries();
  const reviewed = entries.filter(isReviewed);
  const awaiting = entries.length - reviewed.length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Build log</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          One entry per pull request: what shipped, what it measured, what broke. Entries appear
          here once a human has reviewed them.
        </p>
      </header>

      <section className="mt-10" aria-labelledby="charts-heading">
        <h2 id="charts-heading" className="sr-only">
          Running charts
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense
            fallback={
              <>
                <ChartSkeleton title="Cost per verified investigation" />
                <ChartSkeleton title="Verifier catch count" />
                <ChartSkeleton title="Shares and card views" />
              </>
            }
          >
            <DbCharts />
          </Suspense>
          <PrecisionChart entries={entries} />
        </div>
      </section>

      <section className="mt-12" aria-labelledby="entries-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="entries-heading" className="font-heading text-xl font-semibold tracking-tight">
            Entries
          </h2>
          <p className="text-xs text-muted-foreground">
            {reviewed.length} reviewed
            {awaiting > 0 ? ` · ${awaiting} awaiting review` : ""}
          </p>
        </div>

        {reviewed.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No reviewed entries yet.
            {awaiting > 0
              ? ` ${awaiting} ${awaiting === 1 ? "entry is" : "entries are"} waiting for a reviewer to sign off.`
              : ""}
          </p>
        ) : (
          <ol className="mt-6 space-y-8">
            {reviewed.map((entry) => (
              <Entry key={entry.slug} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
