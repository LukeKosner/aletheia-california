"""Shared plumbing: raw cache, staging output and the totals check."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable, Protocol

import polars as pl

from . import cal_format

REPO_ROOT = Path(__file__).resolve().parents[3]
TOLERANCE = 0.01  # dollars


def data_dir() -> Path:
    return Path(os.environ.get("ALETHEIA_DATA_DIR", REPO_ROOT / "data"))


def flag_on(env: dict[str, str] | None = None) -> bool:
    """Mirror of LOCAL_FILERS in apps/web/src/lib/flags.ts (default off)."""
    v = (env if env is not None else os.environ).get("LOCAL_FILERS", "").strip().lower()
    return v in {"1", "true", "on", "yes"}


@dataclass
class RawCache:
    slug: str
    refresh: bool = False

    @property
    def dir(self) -> Path:
        return data_dir() / "raw" / self.slug

    def get(self, name: str, url: str, fetch: Callable[[], pl.DataFrame]) -> pl.DataFrame:
        path = self.dir / f"{name}.parquet"
        manifest_path = self.dir / "manifest.json"
        if path.exists() and not self.refresh:
            return pl.read_parquet(path)
        df = fetch()
        self.dir.mkdir(parents=True, exist_ok=True)
        df.write_parquet(path)
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        manifest[name] = {
            "url": url,
            "rows": df.height,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        return df

    def manifest(self) -> dict:
        p = self.dir / "manifest.json"
        return json.loads(p.read_text()) if p.exists() else {}


class Jurisdiction(Protocol):
    SLUG: str
    NAME: str
    SOURCE: str
    PORTAL: str

    def cal(self, cache: RawCache) -> pl.DataFrame: ...
    def portal_totals(self, cache: RawCache) -> pl.DataFrame: ...
    CHECK_DESCRIPTION: str


def write_staging(slug: str, tables: cal_format.Tables) -> Path:
    out = data_dir() / "staging" / slug
    out.mkdir(parents=True, exist_ok=True)
    for name in ("filing", "entity", "entity_alias", "money_edge"):
        getattr(tables, name).write_parquet(out / f"{name}.parquet")
    return out


def compare_totals(ours: pl.DataFrame, portal: pl.DataFrame) -> pl.DataFrame:
    """Join our itemized sums to the portal's own totals per (filing_id, schedule).

    `ours`: filing_id, schedule, total, n. `portal`: filing_id, schedule, portal_total.
    Scope is every filing the portal reports a total for.
    """
    o = ours.group_by("filing_id", "schedule").agg(pl.col("total").sum(), pl.col("n").sum())
    # Where a portal lists one filing twice with different totals, compare against the larger, deterministically.
    p = portal.sort("filing_id", "schedule", "portal_total", descending=[False, False, True]).group_by(
        "filing_id", "schedule", maintain_order=True
    ).agg(pl.col("portal_total").first(), pl.len().alias("portal_rows"))
    j = p.join(o, on=["filing_id", "schedule"], how="left").with_columns(
        pl.col("total").fill_null(0).cast(pl.Float64), pl.col("n").fill_null(0), pl.col("portal_total").cast(pl.Float64)
    )
    return j.with_columns(diff=(pl.col("total") - pl.col("portal_total")).round(2)).with_columns(
        match=pl.col("diff").abs() <= TOLERANCE
    )


def summarize(cmp: pl.DataFrame) -> dict:
    by = []
    for sched, g in cmp.group_by("schedule", maintain_order=True):
        nonzero = g.filter((pl.col("portal_total") != 0) | (pl.col("total") != 0))
        by.append(
            {
                "schedule": sched[0],
                "filings": g.height,
                "filings_nonzero": nonzero.height,
                "matched": int(g["match"].sum()),
                "matched_nonzero": int(nonzero["match"].sum()),
                "ours_total": round(float(g["total"].sum()), 2),
                "portal_total": round(float(g["portal_total"].sum()), 2),
            }
        )
    for b in by:
        b["match_rate_nonzero"] = round(b["matched_nonzero"] / b["filings_nonzero"], 4) if b["filings_nonzero"] else 1.0
        b["aggregate_diff_pct"] = (
            round(100 * (b["ours_total"] - b["portal_total"]) / b["portal_total"], 4) if b["portal_total"] else 0.0
        )
    return {"by_schedule": sorted(by, key=lambda b: b["schedule"])}


# A check passes when, for every schedule compared, at least 98% of filings with
# money match to the cent and the aggregate differs from the portal by under 0.5%.
PASS_MATCH_RATE = 0.98
PASS_AGGREGATE_PCT = 0.5


def passed(summary: dict) -> bool:
    return all(
        b["match_rate_nonzero"] >= PASS_MATCH_RATE and abs(b["aggregate_diff_pct"]) < PASS_AGGREGATE_PCT
        for b in summary["by_schedule"]
    )
