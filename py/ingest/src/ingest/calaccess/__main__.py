"""Load CAL-ACCESS from scratch: download -> stage in DuckDB -> transform -> write to Postgres.

    uv run python -m ingest.calaccess                     # full history into $DATABASE_URL
    uv run python -m ingest.calaccess --since 2025-01-01  # only filings whose period ends on/after a date
    uv run python -m ingest.calaccess --no-db         # stop after building out_* tables in DuckDB

Reruns are safe: the export is re-downloaded only when the state's copy changed, staging is skipped when the
same zip (by SHA-256) is already staged, and the Postgres write upserts on deterministic ids.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from . import download, stage, transform

# Full history by default. It is roughly 12-16 GB in Postgres: more than the Neon free plan (0.5 GB) holds, so the
# dev database needs a paid plan (Neon Launch) before a full load. Use --since for a smaller window.
DEFAULT_SINCE = "all"


def database_url(cli: str | None) -> str | None:
    if cli:
        return cli
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = Path(__file__).resolve().parents[3] / ".env"  # py/ingest/.env
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "DATABASE_URL" and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m ingest.calaccess", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--since", default=DEFAULT_SINCE,
                   help="only filings whose period ends on or after this date (YYYY-MM-DD); "
                        "default 'all' loads full history")
    p.add_argument("--no-db", action="store_true", help="build out_* tables in DuckDB but do not write to Postgres")
    p.add_argument("--database-url", help="Postgres URL (default: $DATABASE_URL, then py/ingest/.env)")
    p.add_argument("--duckdb", default=str(download.data_dir() / "work" / "calaccess.duckdb"))
    p.add_argument("--force-download", action="store_true")
    args = p.parse_args(argv)
    since = None if args.since == "all" else args.since

    t0 = time.time()
    zip_path, sha = download.download(force=args.force_download)
    con = stage.stage(zip_path, sha, Path(args.duckdb))

    print("[stage] row counts (loaded / rejected):")
    for name, loaded, rejected, reasons in con.execute(
        "SELECT table_name, rows_loaded, rows_rejected, reasons FROM _load_log WHERE zip_sha256 = ? ORDER BY table_name",
        [sha],
    ).fetchall():
        print(f"  {name:<28} {loaded:>12,} / {rejected:,} {reasons if rejected else ''}")

    t = time.time()
    counts = transform.run(con, sha, since=since)
    print(f"[transform] {counts} ({time.time() - t:.0f}s)")
    print("[transform] rows not turned into money_edge / lobby_activity:")
    for row in con.execute("SELECT * FROM out_exclusions ORDER BY src_table, schedule, reason").fetchall():
        print(f"  {row[0]:<16} {str(row[1]):<10} {row[2]:<28} {row[3]:>10,}  total {row[4]}")

    summary: dict[str, object] = {"zip_sha256": sha, "since": since, "counts": counts}
    if not args.no_db:
        url = database_url(args.database_url)
        if not url:
            print("No DATABASE_URL; stopping after transform. Use --no-db to silence this.", file=sys.stderr)
            return 2
        from . import load  # psycopg only needed here

        summary["load"] = load.load(con, url, full=since is None)
    out = download.data_dir() / "work" / "calaccess-last-run.json"
    out.write_text(json.dumps(summary, indent=2, default=str))
    print(f"[done] {time.time() - t0:.0f}s; summary in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
