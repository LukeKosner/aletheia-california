"""Download the CAL-ACCESS raw data export unchanged and record it in data/raw/MANIFEST.csv."""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
from pathlib import Path

import httpx

EXPORT_URL = "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip"
# Shared with aletheia_ingest.leginfo.manifest. `path` is relative to data/raw/.
MANIFEST_FIELDS = [
    "path", "url", "sha256", "bytes", "source_last_modified", "etag", "downloaded_at", "source", "agent", "notes",
]  # fmt: skip


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for p in here.parents:
        if (p / "AGENTS.md").exists():
            return p
    raise RuntimeError("could not find repo root (AGENTS.md)")


def data_dir() -> Path:
    return repo_root() / "data"


def manifest_path() -> Path:
    return data_dir() / "raw" / "MANIFEST.csv"


def read_manifest() -> list[dict[str, str]]:
    p = manifest_path()
    if not p.exists():
        return []
    with p.open(newline="") as f:
        return list(csv.DictReader(f))


def append_manifest(row: dict[str, str]) -> None:
    p = manifest_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    new = not p.exists()
    with p.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, restval="")
        if new:
            w.writeheader()
        w.writerow(row)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def latest_local() -> tuple[Path, dict[str, str]] | None:
    """Most recent manifest entry for CAL-ACCESS whose file still exists and matches its hash size."""
    raw = manifest_path().parent
    for row in reversed(read_manifest()):
        if row.get("source") != "calaccess" or not row.get("etag"):
            continue
        p = raw / row["path"]
        if p.exists() and p.stat().st_size == int(row["bytes"]):
            return p, row
    return None


def download(url: str = EXPORT_URL, *, force: bool = False) -> tuple[Path, str]:
    """Return (path, sha256) of the export. Reuses the local copy when the server's copy is unchanged."""
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=300.0)) as client:
        head = client.head(url)
        head.raise_for_status()
        last_modified = head.headers.get("last-modified", "")
        etag = head.headers.get("etag", "").strip('"')
        size = int(head.headers.get("content-length", "0"))

        local = latest_local()
        if local and not force:
            path, row = local
            if row["etag"] == etag and int(row["bytes"]) == size:
                print(f"[download] export unchanged (etag {etag}); using {path}")
                return path, row["sha256"]

        now = dt.datetime.now(dt.UTC)
        day = now.astimezone().date().isoformat()
        out_dir = data_dir() / "raw" / "calaccess" / day
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / "dbwebexport.zip"
        tmp = out.with_suffix(".zip.part")
        h = hashlib.sha256()
        got = 0
        print(f"[download] {url} -> {out} ({size / 1e9:.2f} GB)")
        with client.stream("GET", url) as r, tmp.open("wb") as f:
            r.raise_for_status()
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
                h.update(chunk)
                got += len(chunk)
                if got % (100 << 20) < (1 << 20):
                    print(f"[download] {got / 1e9:.2f} GB", flush=True)
        if size and got != size:
            raise RuntimeError(f"short download: {got} of {size} bytes")
        tmp.rename(out)
        digest = h.hexdigest()
        append_manifest(
            {
                "source": "calaccess",
                "url": url,
                "path": out.relative_to(manifest_path().parent).as_posix(),
                "downloaded_at": now.isoformat(timespec="seconds"),
                "sha256": digest,
                "bytes": str(got),
                "source_last_modified": last_modified,
                "etag": etag,
                "agent": "agent:ingest",
                "notes": "CAL-ACCESS raw data export",
            }
        )
        print(f"[download] done sha256={digest}")
        return out, digest


if __name__ == "__main__":
    download()
