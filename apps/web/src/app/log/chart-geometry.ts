/**
 * Geometry and number formatting for the /log charts.
 *
 * The charts are plain SVG rendered on the server: no charting dependency, no
 * client JavaScript, and colors come from theme tokens through Tailwind classes
 * (rule 5). Everything here is pure so it can be tested directly.
 */

/** The plot box every chart shares, in viewBox units. */
export const PLOT = {
  width: 520,
  height: 200,
  left: 54,
  right: 20,
  top: 14,
  bottom: 32,
} as const;

export const INNER_WIDTH = PLOT.width - PLOT.left - PLOT.right;
export const INNER_HEIGHT = PLOT.height - PLOT.top - PLOT.bottom;

/** Bars are capped so a sparse chart does not render slabs. */
export const MAX_BAR_WIDTH = 24;
/** The surface gap that separates touching marks. */
export const BAR_GAP = 2;
export const BAR_RADIUS = 4;

const STEPS = [1, 2, 2.5, 5, 10];

/**
 * A zero-based axis ending on a round number.
 * `niceScale(0.97)` → max 1 with ticks every 0.25; `niceScale(37)` → max 40.
 */
export function niceScale(maxValue: number, tickCount = 4): { max: number; ticks: number[] } {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const rough = safeMax / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = (STEPS.find((s) => s * magnitude >= rough) ?? 10) * magnitude;
  const max = Math.ceil(safeMax / step) * step;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) {
    // Floating point: 0.1 + 0.2 must not become a 0.30000000000000004 tick label.
    ticks.push(Number(value.toFixed(10)));
  }
  return { max, ticks };
}

/** Maps a value to a y coordinate, with 0 on the baseline. */
export function yOf(value: number, max: number): number {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return PLOT.top + INNER_HEIGHT * (1 - ratio);
}

/** Maps index `i` of `count` points to the centre of its slot. */
export function xOf(i: number, count: number): number {
  if (count <= 1) return PLOT.left + INNER_WIDTH / 2;
  return PLOT.left + (INNER_WIDTH * i) / (count - 1);
}

/** Maps index `i` of `count` bands to the centre of band `i`. */
export function xOfBand(i: number, count: number): number {
  if (count <= 0) return PLOT.left + INNER_WIDTH / 2;
  const band = INNER_WIDTH / count;
  return PLOT.left + band * (i + 0.5);
}

/** Bar width: the band minus the surface gap, capped so bars stay thin. */
export function barWidth(count: number): number {
  if (count <= 0) return MAX_BAR_WIDTH;
  return Math.max(1, Math.min(MAX_BAR_WIDTH, INNER_WIDTH / count - BAR_GAP));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** `M x y L x y …` through the given points. */
export function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");
}

/** A bar with a rounded data-end and square corners on the baseline. */
export function barPath(x: number, y: number, width: number, baseline: number): string {
  const height = Math.max(0, baseline - y);
  const r = Math.min(BAR_RADIUS, width / 2, height);
  const [l, t, right, b] = [round(x), round(y), round(x + width), round(baseline)];
  if (height === 0) return "";
  return [
    `M${l} ${b}`,
    `L${l} ${round(t + r)}`,
    `Q${l} ${t} ${round(x + r)} ${t}`,
    `L${round(x + width - r)} ${t}`,
    `Q${right} ${t} ${right} ${round(t + r)}`,
    `L${right} ${b}`,
    "Z",
  ].join(" ");
}

/**
 * Which x labels to draw: first, last and a few evenly spaced between, so
 * labels never collide no matter how many days are in the window.
 */
export function labelIndexes(count: number, maxLabels = 5): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxLabels - 1);
  return Array.from({ length: maxLabels }, (_, i) => Math.round(i * step));
}

// --- formatting ------------------------------------------------------------

/** 1284 → "1,284"; 12900 → "12.9K"; 4200000 → "4.2M". */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 10_000) return `${Number((value / 1_000).toFixed(1))}K`;
  if (!Number.isInteger(value)) return Number(value.toFixed(2)).toLocaleString("en-US");
  return value.toLocaleString("en-US");
}

export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1000) return `$${formatCompact(value)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** "2026-11-15" → "Nov 15". Falls back to the raw string if it is not a date. */
export function formatDay(day: string): string {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}` : day;
}
