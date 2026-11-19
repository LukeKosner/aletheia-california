"""leginfo ingest CLI.

    uv run python -m aletheia_ingest.leginfo download            # fetch pubinfo_2025.zip, log in MANIFEST.csv
    uv run python -m aletheia_ingest.leginfo stage               # parse + transform -> data/processed/leginfo/2025-2026/*.parquet
    uv run python -m aletheia_ingest.leginfo committees          # draft data/manual/legislator_committees.csv (needs data/raw/calaccess/dbwebexport.zip)
    uv run python -m aletheia_ingest.leginfo verify              # compare staged votes with tests/leginfo/fixtures/leginfo_web_votes.json
    DATABASE_URL=... uv run python -m aletheia_ingest.leginfo load   # humans only: write staged rows (+ approved committee IDs) to Postgres
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx
import polars as pl

from . import committees, manifest, transform, verify

ROOT = Path(__file__).resolve().parents[5]
DATA = ROOT / "data"
BASE_URL = "https://downloads.leginfo.legislature.ca.gov/"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="aletheia_ingest.leginfo")
    p.add_argument("command", choices=["download", "stage", "verify", "committees", "load"])
    p.add_argument("--force", action="store_true", help="committees: overwrite a CSV that already has approvals")
    p.add_argument("--year", default="2025", help="first year of the session (default 2025)")
    a = p.parse_args(argv)
    session = f"{a.year}-{int(a.year) + 1}"
    zip_path = DATA / "raw/leginfo" / f"pubinfo_{a.year}.zip"
    staged = DATA / "processed/leginfo" / session

    if a.command == "download":
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        url = BASE_URL + zip_path.name
        with httpx.stream("GET", url, follow_redirects=True, timeout=None) as r:
            r.raise_for_status()
            with zip_path.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
            last_mod = r.headers.get("last-modified", "")
        print(manifest.record(DATA / "raw/MANIFEST.csv", zip_path, url, source_last_modified=last_mod, notes=f"{session} session PUBINFO full extract"))
    elif a.command == "stage":
        s = transform.stage(transform.Tables.from_zip(zip_path))
        transform.write_parquet(s, staged)
        for name in transform.Staged.__dataclass_fields__:
            print(f"{name}: {getattr(s, name).height}")
    elif a.command == "verify":
        votes = pl.read_parquet(staged / "votes.parquet")
        web = verify.load_web(ROOT / "py/ingest/tests/leginfo/fixtures/leginfo_web_votes.json")
        problems = verify.compare(votes, web)
        print("\n".join(problems) or "all sample bills match leginfo")
        return 1 if problems else 0
    elif a.command == "committees":
        out = DATA / "manual/legislator_committees.csv"
        if out.exists() and not a.force and pl.read_csv(out, infer_schema=False)["approved"].drop_nulls().len():
            print(f"{out} already has human approvals; not overwriting (use --force)", file=sys.stderr)
            return 1
        d = committees.draft(DATA / "raw/calaccess/dbwebexport.zip", pl.read_parquet(staged / "legislators.parquet"))
        out.parent.mkdir(parents=True, exist_ok=True)
        d.write_csv(out)
        print(f"wrote {d.height} rows to {out} (DRAFT: needs human approval)")
    elif a.command == "load":
        from .load import load

        url = os.environ.get("DATABASE_URL")
        if not url:
            print("DATABASE_URL is not set", file=sys.stderr)
            return 2
        print(load(url, staged, DATA / "manual/legislator_committees.csv"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
