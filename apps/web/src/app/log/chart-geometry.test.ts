import { describe, expect, test } from "bun:test";
import {
  BAR_GAP,
  INNER_HEIGHT,
  INNER_WIDTH,
  MAX_BAR_WIDTH,
  PLOT,
  barPath,
  barWidth,
  formatCompact,
  formatDay,
  formatPercent,
  formatUsd,
  labelIndexes,
  linePath,
  niceScale,
  xOf,
  xOfBand,
  yOf,
} from "./chart-geometry";

describe("niceScale", () => {
  test("ends on a round number above the data", () => {
    expect(niceScale(37).max).toBe(40);
    expect(niceScale(0.97).max).toBe(1);
    expect(niceScale(1).max).toBe(1);
  });

  test("ticks run from zero to the max", () => {
    const { max, ticks } = niceScale(37);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(max);
  });

  test("ticks are free of floating point noise", () => {
    for (const tick of niceScale(1).ticks) {
      expect(String(tick).length).toBeLessThanOrEqual(5);
    }
  });

  test("an empty or invalid series still produces an axis", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { max, ticks } = niceScale(value);
      expect(max).toBeGreaterThan(0);
      expect(ticks.length).toBeGreaterThan(1);
    }
  });
});

describe("yOf", () => {
  test("zero sits on the baseline and the max at the top", () => {
    expect(yOf(0, 10)).toBe(PLOT.top + INNER_HEIGHT);
    expect(yOf(10, 10)).toBe(PLOT.top);
  });

  test("clamps out-of-range values into the plot", () => {
    expect(yOf(20, 10)).toBe(PLOT.top);
    expect(yOf(-5, 10)).toBe(PLOT.top + INNER_HEIGHT);
  });

  test("a zero max does not divide by zero", () => {
    expect(yOf(5, 0)).toBe(PLOT.top + INNER_HEIGHT);
  });
});

describe("xOf and xOfBand", () => {
  test("line points span the full plot width", () => {
    expect(xOf(0, 4)).toBe(PLOT.left);
    expect(xOf(3, 4)).toBe(PLOT.left + INNER_WIDTH);
  });

  test("a single point is centred", () => {
    expect(xOf(0, 1)).toBe(PLOT.left + INNER_WIDTH / 2);
  });

  test("bands are centred inside their slot and stay in the plot", () => {
    const count = 5;
    for (let i = 0; i < count; i++) {
      expect(xOfBand(i, count)).toBeGreaterThan(PLOT.left);
      expect(xOfBand(i, count)).toBeLessThan(PLOT.left + INNER_WIDTH);
    }
  });
});

describe("barWidth", () => {
  test("caps thickness so a sparse chart does not render slabs", () => {
    expect(barWidth(1)).toBe(MAX_BAR_WIDTH);
    expect(barWidth(2)).toBe(MAX_BAR_WIDTH);
  });

  test("leaves a surface gap between neighbours", () => {
    const count = 60;
    expect(barWidth(count)).toBeCloseTo(INNER_WIDTH / count - BAR_GAP, 10);
  });

  test("never goes below a visible hairline", () => {
    expect(barWidth(10_000)).toBe(1);
  });
});

describe("barPath", () => {
  test("rounds the data-end and squares the baseline", () => {
    const d = barPath(10, 50, 20, 150);
    expect(d.startsWith("M10 150")).toBe(true);
    expect(d).toContain("Q");
    expect(d.endsWith("Z")).toBe(true);
  });

  test("a zero-height bar draws nothing", () => {
    expect(barPath(10, 150, 20, 150)).toBe("");
  });

  test("the corner radius never exceeds the bar", () => {
    expect(() => barPath(0, 149, 1, 150)).not.toThrow();
    expect(barPath(0, 149, 1, 150)).toContain("Q");
  });
});

describe("linePath", () => {
  test("moves to the first point and lines to the rest", () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }])).toBe("M0 1 L2 3");
  });

  test("an empty series is an empty path", () => {
    expect(linePath([])).toBe("");
  });
});

describe("labelIndexes", () => {
  test("labels every point when there are few", () => {
    expect(labelIndexes(3)).toEqual([0, 1, 2]);
  });

  test("thins out long windows, always keeping the ends", () => {
    const indexes = labelIndexes(90);
    expect(indexes).toHaveLength(5);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(89);
  });

  test("no points, no labels", () => {
    expect(labelIndexes(0)).toEqual([]);
  });
});

describe("formatting", () => {
  test("compact numbers", () => {
    expect(formatCompact(1284)).toBe("1,284");
    expect(formatCompact(12_900)).toBe("12.9K");
    expect(formatCompact(4_200_000)).toBe("4.2M");
    expect(formatCompact(0)).toBe("0");
  });

  test("dollars", () => {
    expect(formatUsd(4.2)).toBe("$4.20");
    expect(formatUsd(12_900)).toBe("$12.9K");
  });

  test("percentages", () => {
    expect(formatPercent(0.962)).toBe("96.2%");
    expect(formatPercent(0.5, 0)).toBe("50%");
  });

  test("days", () => {
    expect(formatDay("2026-11-15")).toBe("Nov 15");
    expect(formatDay("not a date")).toBe("not a date");
  });
});
