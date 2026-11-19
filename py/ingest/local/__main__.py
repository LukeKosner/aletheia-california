"""CLI: `uv run python -m local run [sf oakland la] [--refresh]` (needs LOCAL_FILERS=on).

`run` downloads (or reuses) the raw exports under data/raw/, parses them with the
shared CAL parser, writes table-shaped staging parquet under data/staging/, and
writes a totals check report to data/checks/<slug>.md.

`load-pg` copies staging into Postgres. Humans only: agents never write to the database.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

import polars as pl

from . import cal_format, la, oakland, pipeline, sf

JURISDICTIONS = {m.SLUG: m for m in (sf, oakland, la)}


def run_one(mod, refresh: bool) -> dict:
    cache = pipeline.RawCache(mod.SLUG, refresh=refresh)
    print(f"[{mod.SLUG}] parsing")
    cal = mod.cal(cache)
    tables = cal_format.to_tables(cal, mod.SOURCE)
    out = pipeline.write_staging(mod.SLUG, tables)
    print(f"[{mod.SLUG}] staging -> {out}")

    print(f"[{mod.SLUG}] totals check")
    ours = cal_format.itemized_totals(cal, ("A", "E"))
    cmp = pipeline.compare_totals(ours, mod.portal_totals(cache))
    summary = pipeline.summarize(cmp)
    ok = pipeline.passed(summary)
    result = {
        "jurisdiction": mod.NAME,
        "source": mod.SOURCE,
        "portal": mod.PORTAL,
        "check": mod.CHECK_DESCRIPTION,
        "passed": ok,
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "rows": {
            "cal_rows": cal.height,
            "filing": tables.filing.height,
            "entity": tables.entity.height,
            "entity_alias": tables.entity_alias.height,
            "money_edge": tables.money_edge.height,
            "skipped": dict(sorted(tables.skipped.items())),
            "edges_by_kind": dict(tables.money_edge.group_by("kind").len().sort("kind").iter_rows()),
        },
        "totals": summary,
        "raw": cache.manifest(),
    }
    worst = cmp.filter(~pl.col("match")).sort(pl.col("diff").abs(), descending=True).head(15)
    write_report(mod.SLUG, result, worst)
    print(f"[{mod.SLUG}] {'PASS' if ok else 'FAIL'} {json.dumps(summary)}")
    return result


def write_report(slug: str, result: dict, worst: pl.DataFrame) -> None:
    d = pipeline.data_dir() / "checks"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{slug}.json").write_text(json.dumps(result, indent=2, default=str) + "\n")
    lines = [
        f"# Totals check: {result['jurisdiction']}",
        "",
        f"- Source tag: `{result['source']}`",
        f"- Portal: {result['portal']}",
        f"- Ran at: {result['ran_at']}",
        f"- Result: **{'PASS' if result['passed'] else 'FAIL'}** "
        f"(every schedule: >= {pipeline.PASS_MATCH_RATE:.0%} of filings with money match to the cent, "
        f"aggregate within {pipeline.PASS_AGGREGATE_PCT}%)",
        "",
        result["check"],
        "",
        "| Schedule | Filings (with money) | Matched to the cent | Match rate | Our total | Portal total | Aggregate diff |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for b in result["totals"]["by_schedule"]:
        lines.append(
            f"| {b['schedule']} | {b['filings_nonzero']:,} | {b['matched_nonzero']:,} | {b['match_rate_nonzero']:.2%} "
            f"| ${b['ours_total']:,.2f} | ${b['portal_total']:,.2f} | {b['aggregate_diff_pct']:+.4f}% |"
        )
    r = result["rows"]
    lines += [
        "",
        "## Rows",
        "",
        f"- CAL rows parsed: {r['cal_rows']:,}",
        f"- filing: {r['filing']:,} · entity: {r['entity']:,} · entity_alias: {r['entity_alias']:,} · money_edge: {r['money_edge']:,}",
        f"- money_edge by kind: {', '.join(f'{k} {v:,}' for k, v in r['edges_by_kind'].items())}",
        f"- Rows not loaded as edges: {', '.join(f'{k} {v:,}' for k, v in r['skipped'].items()) or 'none'}",
        "",
        "## Largest mismatches",
        "",
    ]
    if worst.height:
        lines += ["| filing_id | schedule | ours | portal | diff |", "| --- | --- | ---: | ---: | ---: |"]
        for row in worst.iter_rows(named=True):
            lines.append(
                f"| `{row['filing_id']}` | {row['schedule']} | {row['total']:,.2f} | {row['portal_total']:,.2f} | {row['diff']:+,.2f} |"
            )
    else:
        lines.append("None.")
    lines += ["", "## Raw exports", "", "| Name | Rows | sha256 | Fetched |", "| --- | ---: | --- | --- |"]
    for name, m in result["raw"].items():
        lines.append(f"| [{name}]({m['url']}) | {m['rows']:,} | `{m['sha256'][:16]}` | {m['fetched_at']} |")
    (d / f"{slug}.md").write_text("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m local")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="download, parse, stage and totals-check")
    r.add_argument("jurisdictions", nargs="*", default=list(JURISDICTIONS), help=" ".join(JURISDICTIONS))
    r.add_argument("--refresh", action="store_true", help="re-download raw exports")
    lp = sub.add_parser("load-pg", help="copy staging into Postgres (humans only)")
    lp.add_argument("jurisdictions", nargs="*", default=list(JURISDICTIONS))
    lp.add_argument("--database-url", required=True)
    args = p.parse_args(argv)
    unknown = [s for s in args.jurisdictions if s not in JURISDICTIONS]
    if unknown:
        p.error(f"unknown jurisdiction(s) {unknown}; choose from {list(JURISDICTIONS)}")

    if not pipeline.flag_on():
        print("LOCAL_FILERS is off. Set LOCAL_FILERS=on to ingest local filings.", file=sys.stderr)
        return 2

    if args.cmd == "run":
        results = [run_one(JURISDICTIONS[s], args.refresh) for s in args.jurisdictions]
        return 0 if all(r["passed"] for r in results) else 1
    from . import load_pg

    for s in args.jurisdictions:
        load_pg.load(pipeline.data_dir() / "staging" / s, args.database_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
