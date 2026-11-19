"""Append downloaded raw files to data/raw/MANIFEST.csv."""

from __future__ import annotations

import csv
import hashlib
from datetime import UTC, datetime
from pathlib import Path

# Shared with ingest.calaccess.download. `path` is relative to data/raw/.
FIELDS = ["path", "url", "sha256", "bytes", "source_last_modified", "etag", "downloaded_at", "source", "agent", "notes"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def record(
    manifest: Path,
    file: Path,
    url: str,
    *,
    source_last_modified: str = "",
    agent: str = "agent:ingest-leg",
    notes: str = "",
) -> dict[str, str]:
    """Add or replace the manifest row for ``file`` (keyed by its path relative to data/)."""
    rel = file.resolve().relative_to(manifest.resolve().parent).as_posix()
    row = {
        "path": rel,
        "url": url,
        "sha256": sha256_file(file),
        "bytes": str(file.stat().st_size),
        "source_last_modified": source_last_modified,
        "source": rel.split("/", 1)[0],
        "downloaded_at": datetime.fromtimestamp(file.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "agent": agent,
        "notes": notes,
    }
    rows: list[dict[str, str]] = []
    if manifest.exists():
        with manifest.open(newline="") as f:
            rows = [r for r in csv.DictReader(f) if r["path"] != rel]
    rows.append(row)
    rows.sort(key=lambda r: r["path"])
    with manifest.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, restval="")
        w.writeheader()
        w.writerows(rows)
    return row
