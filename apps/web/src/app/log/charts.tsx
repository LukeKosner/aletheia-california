/**
 * Server-rendered SVG charts for /log.
 *
 * No charting dependency and no client JavaScript. Colors come from theme
 * tokens through Tailwind classes (rule 5), written as literal class strings so
 * Tailwind's scanner sees them.
 *
 * Two series at most per chart, and both are separated by lightness as well as
 * hue (`primary` flips with the theme, `chart-2` sits mid-scale), so they stay
 * distinguishable in light mode, dark mode and under colour vision deficiency.
 * Every chart also ships a legend and a table view, so nothing is encoded by
 * colour alone.
 */
import type { ReactNode } from "react";
import {
  INNER_HEIGHT,
  INNER_WIDTH,
  PLOT,
  barPath,
  barWidth,
  formatDay,
  labelIndexes,
  linePath,
  niceScale,
  xOf,
  xOfBand,
  yOf,
} from "./chart-geometry";

export type Series = {
  key: string;
  name: string;
  tone: "primary" | "secondary";
  points: { day: string; value: number }[];
};

const TONE = {
  primary: { stroke: "stroke-primary", fill: "fill-primary" },
  secondary: { stroke: "stroke-chart-2", fill: "fill-chart-2" },
} as const;

const AXIS_TEXT = "fill-muted-foreground text-[13px] [font-variant-numeric:tabular-nums]";

// --- card ------------------------------------------------------------------

export function ChartCard({
  title,
  subtitle,
  stat,
  statLabel,
  children,
  table,
}: {
  title: string;
  subtitle: string;
  stat?: string;
  statLabel?: string;
  children: ReactNode;
  table?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-card-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {stat ? (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold text-card-foreground">{stat}</div>
            {statLabel ? <div className="text-xs text-muted-foreground">{statLabel}</div> : null}
          </div>
        ) : null}
      </header>
      {children}
      {table}
    </section>
  );
}

/** Shown in place of a plot until the first row of data exists. */
export function EmptyPlot({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-muted-foreground"
      style={{ aspectRatio: `${PLOT.width} / ${PLOT.height}` }}
    >
      {message}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg viewBox="0 0 8 8" aria-hidden className="size-2">
            <circle cx="4" cy="4" r="4" className={TONE[s.tone].fill} />
          </svg>
          {s.name}
        </li>
      ))}
    </ul>
  );
}

// --- plot chrome -----------------------------------------------------------

function Grid({ ticks, max, format }: { ticks: number[]; max: number; format: (n: number) => string }) {
  return (
    <g aria-hidden>
      {ticks.map((tick) => {
        const y = yOf(tick, max);
        return (
          <g key={tick}>
            <line
              x1={PLOT.left}
              x2={PLOT.left + INNER_WIDTH}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
            />
            <text x={PLOT.left - 8} y={y + 4} textAnchor="end" className={AXIS_TEXT}>
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ days, position }: { days: string[]; position: (i: number) => number }) {
  const y = PLOT.top + INNER_HEIGHT + 20;
  return (
    <g aria-hidden>
      {labelIndexes(days.length).map((i) => (
        <text key={days[i] ?? i} x={position(i)} y={y} textAnchor="middle" className={AXIS_TEXT}>
          {formatDay(days[i] ?? "")}
        </text>
      ))}
    </g>
  );
}

// --- charts ----------------------------------------------------------------

/**
 * One or two series over time. The last point of each series is direct-labelled
 * and carries an end dot with a surface ring; every other value lives in the
 * axis, the hover title and the table view.
 */
export function LineChart({
  series,
  format,
  label,
}: {
  series: Series[];
  format: (n: number) => string;
  label: string;
}) {
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const { max, ticks } = niceScale(Math.max(...values, 0));
  const count = days.length;

  // Direct-label the series ends, but only while they stay apart. Converging
  // lines get the legend and the table instead of two labels on top of
  // each other.
  const endY = series.map((s) => yOf(s.points[s.points.length - 1]?.value ?? 0, max));
  const crowded = endY.some((y, i) => endY.some((other, j) => i !== j && Math.abs(y - other) < 18));
  const labelled = new Set(crowded ? series.slice(0, 1).map((s) => s.key) : series.map((s) => s.key));

  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 ? <Legend series={series} /> : null}
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        className="w-full"
        role="img"
        aria-label={label}
      >
        <Grid ticks={ticks} max={max} format={format} />
        {series.map((s) => {
          const coords = s.points.map((p, i) => ({ x: xOf(i, count), y: yOf(p.value, max) }));
          const last = coords[coords.length - 1];
          const lastPoint = s.points[s.points.length - 1];
          return (
            <g key={s.key}>
              {coords.length > 1 ? (
                <path
                  d={linePath(coords)}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={TONE[s.tone].stroke}
                />
              ) : null}
              {s.points.map((p, i) => (
                <circle
                  key={p.day}
                  cx={xOf(i, count)}
                  cy={yOf(p.value, max)}
                  r={coords.length > 1 ? 2.5 : 4}
                  className={TONE[s.tone].fill}
                >
                  <title>{`${s.name} · ${formatDay(p.day)}: ${format(p.value)}`}</title>
                </circle>
              ))}
              {last && lastPoint ? (
                <>
                  <circle
                    cx={last.x}
                    cy={last.y}
                    r={4}
                    strokeWidth={2}
                    className={`${TONE[s.tone].fill} stroke-card`}
                  />
                  {labelled.has(s.key) ? (
                    <text
                      x={PLOT.width - 2}
                      y={Math.min(Math.max(last.y - 10, 12), PLOT.top + INNER_HEIGHT)}
                      textAnchor="end"
                      className="fill-foreground text-[13px] font-medium"
                    >
                      {format(lastPoint.value)}
                    </text>
                  ) : null}
                </>
              ) : null}
            </g>
          );
        })}
        <XLabels days={days} position={(i) => xOf(i, count)} />
      </svg>
    </div>
  );
}

/** Counts per day. Thin bars, 4px rounded cap, square on the baseline. */
export function BarChart({
  points,
  format,
  label,
  name,
}: {
  points: { day: string; value: number }[];
  format: (n: number) => string;
  label: string;
  name: string;
}) {
  const { max, ticks } = niceScale(Math.max(...points.map((p) => p.value), 0));
  const width = barWidth(points.length);
  const baseline = yOf(0, max);

  return (
    <svg viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} className="w-full" role="img" aria-label={label}>
      <Grid ticks={ticks} max={max} format={format} />
      {points.map((point, i) => {
        const x = xOfBand(i, points.length) - width / 2;
        const d = barPath(x, yOf(point.value, max), width, baseline);
        return d ? (
          <path key={point.day} d={d} className="fill-primary">
            <title>{`${name} · ${formatDay(point.day)}: ${format(point.value)}`}</title>
          </path>
        ) : null;
      })}
      <XLabels days={points.map((p) => p.day)} position={(i) => xOfBand(i, points.length)} />
    </svg>
  );
}

// --- table view ------------------------------------------------------------

/** The WCAG-clean twin of every chart: nothing is only reachable by hovering. */
export function ChartTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: (string | number)[][];
  caption: string;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Table ({rows.length} {rows.length === 1 ? "row" : "rows"})
      </summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-card">
            <tr>
              {columns.map((column, i) => (
                <th
                  key={column}
                  scope="col"
                  className={`border-b border-border px-3 py-1.5 font-medium text-muted-foreground ${i === 0 ? "" : "text-right"}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[font-variant-numeric:tabular-nums]">
            {rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, i) => (
                  <td
                    key={columns[i] ?? i}
                    className={`border-b border-border px-3 py-1.5 ${i === 0 ? "text-muted-foreground" : "text-right text-foreground"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
