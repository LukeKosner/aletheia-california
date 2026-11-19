"""Resolve raw CAL-ACCESS donors into one entity per real donor.

    uv run python -m aletheia_resolve run   [--source PATH_OR_URL] [--out DIR]
    uv run python -m aletheia_resolve train [--source PATH_OR_URL]
    uv run python -m aletheia_resolve draft-labels [--force]
    uv run python -m aletheia_resolve report [--apply]
    uv run python -m aletheia_resolve load [--database-url URL] [--dry-run]

`--source` is a CAL-ACCESS DuckDB file (`out_entity`), a parquet extract, or a postgres:// URL (read-only).
Default: $RESOLVE_SOURCE, else $DATABASE_URL, else data/work/calaccess.duckdb. Outputs go to
data/work/resolve/ (gitignored). Only `load` writes to a database (approved exception; see load.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import polars as pl

from . import cluster, labels, load, model, normalize, sources

PKG = Path(__file__).resolve().parents[2]  # py/resolve
REPO = PKG.parents[1]
THRESHOLDS = PKG / "thresholds.json"
REPORT = PKG / "REPORT.md"
DEFAULT_OUT = REPO / "data" / "work" / "resolve"
DEFAULT_DUCKDB = REPO / "data" / "work" / "calaccess.duckdb"
KINDS = ("person", "org")


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def default_source() -> str:
    if os.environ.get("RESOLVE_SOURCE"):
        return os.environ["RESOLVE_SOURCE"]
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    return str(DEFAULT_DUCKDB)


def load_thresholds() -> dict[str, dict[str, float]]:
    return json.loads(THRESHOLDS.read_text())["kinds"]


def _normalized(source: str, out: Path) -> pl.DataFrame:
    _log(f"reading raw entities from {source.split('@')[-1]}")
    raw = sources.load(source)
    _log(f"{raw.height:,} raw entities; normalizing")
    return normalize.normalize_frame(raw)


def cmd_train(args: argparse.Namespace) -> None:
    frame = _normalized(args.source, args.out)
    for kind in KINDS:
        path = model.train(frame, kind, tmp_dir=args.out / "tmp")
        _log(f"saved {path}")


def cmd_run(args: argparse.Namespace) -> None:
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    frame = _normalized(args.source, out)
    th = load_thresholds()
    all_pairs = []
    members, likely = [], []
    for kind in KINDS:
        _log(f"scoring {kind} pairs")
        pairs = model.predict(frame, kind, tmp_dir=out / "tmp")
        all_pairs.append(pairs)
        ents = frame.filter(pl.col("kind") == kind).select(
            "canonical_key", "kind", "first_name", "middle_name", "gen_suffix", "title_gender"
        )
        m, lk = cluster.cluster(ents, pairs, high=th[kind]["high"], likely=th[kind]["likely"])
        members.append(m)
        likely.append(lk)
        _log(f"{kind}: {pairs.height:,} pairs, {ents.height:,} records -> {m['entity_key'].n_unique():,} entities")

    # Committees, candidates, measures and lobbying firms named without an id: kept as they are.
    others = (
        frame.filter(~pl.col("kind").is_in(KINDS))
        .select("canonical_key", "kind")
        .with_columns(
            entity_key=pl.col("canonical_key"),
            cluster_size=pl.lit(1, pl.Int32),
            match_score=pl.lit(1.0),
            confidence=pl.lit("high"),
        )
    )
    members_df = pl.concat([*members, others]).sort("canonical_key")
    likely_df = pl.concat(likely).sort("entity_key_l", "entity_key_r")
    pairs_df = pl.concat(all_pairs).sort("kind", "key_l", "key_r")

    members_df.write_parquet(out / "members.parquet")
    likely_df.write_parquet(out / "likely_links.parquet")
    pairs_df.write_parquet(out / "pairs.parquet")
    frame.write_parquet(out / "normalized.parquet")

    summary = summarize(frame, members_df, likely_df, pairs_df, th)
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    _log(f"wrote {out}/members.parquet, likely_links.parquet, pairs.parquet, summary.json")
    print(json.dumps(summary, indent=2))


def members_digest(members: pl.DataFrame) -> str:
    """sha256 over sorted (canonical_key, entity_key). Equal digests = identical entities."""
    h = hashlib.sha256()
    for k, e in members.select("canonical_key", "entity_key").sort("canonical_key").iter_rows():
        h.update(f"{k}\t{e}\n".encode())
    return h.hexdigest()


def summarize(
    frame: pl.DataFrame, members: pl.DataFrame, likely: pl.DataFrame, pairs: pl.DataFrame, th: dict
) -> dict:
    s: dict = {"thresholds": th, "members_sha256": members_digest(members), "kinds": {}}
    for kind in KINDS:
        m = members.filter(pl.col("kind") == kind)
        sizes = m.group_by("entity_key").len()
        biggest = (
            sizes.sort(["len", "entity_key"], descending=[True, False])
            .head(10)
            .join(frame.select("canonical_key", "name"), left_on="entity_key", right_on="canonical_key")
            .sort(["len", "entity_key"], descending=[True, False])
        )
        s["kinds"][kind] = {
            "records": m.height,
            "resolvable_records": frame.filter((pl.col("kind") == kind) & pl.col("resolvable")).height,
            "entities": sizes.height,
            "records_merged": int(m.filter(pl.col("cluster_size") > 1).height),
            "multi_record_entities": int(sizes.filter(pl.col("len") > 1).height),
            "largest_entities": [{"entity_key": k, "name": n, "records": c} for k, c, n in biggest.iter_rows()],
            "likely_links": int(likely.filter(pl.col("kind") == kind).height),
            "scored_pairs": int(pairs.filter(pl.col("kind") == kind).height),
        }
    others = members.filter(~pl.col("kind").is_in(KINDS))
    s["kept_separate_unresolved_kinds"] = dict(sorted(others.group_by("kind").len().iter_rows()))
    return s


def _read_outputs(out: Path) -> tuple[pl.DataFrame, pl.DataFrame]:
    pairs = pl.read_parquet(out / "pairs.parquet")
    frame = pl.read_parquet(out / "normalized.parquet")
    return pairs, frame


def _strata_pairs(pairs: pl.DataFrame, th: dict) -> pl.DataFrame:
    parts = [
        labels.with_strata(pairs.filter(pl.col("kind") == k), th[k]["high"], th[k]["likely"]) for k in KINDS
    ]
    return pl.concat(parts)


def cmd_draft(args: argparse.Namespace) -> None:
    pairs, frame = _read_outputs(args.out)
    th = load_thresholds()
    rows = []
    for k in KINDS:
        rows += labels.draft(
            pairs.filter(pl.col("kind") == k), frame, high=th[k]["high"], likely=th[k]["likely"]
        )
    labels.write(rows, force=args.force)
    _log(f"wrote {len(rows)} pairs to {labels.LABELS_CSV}")


def cmd_report(args: argparse.Namespace) -> None:
    pairs, _ = _read_outputs(args.out)
    th = load_thresholds()
    rows = labels.read()
    summary = json.loads((args.out / "summary.json").read_text())
    evals = {
        k: labels.evaluate(rows, pairs.filter(pl.col("kind") == k), th[k]["high"], th[k]["likely"])["kinds"][k]
        for k in KINDS
    }
    used = sum(e["labels_used"] for e in evals.values())
    provisional = any(e["recommended_high"] is None for e in evals.values())
    REPORT.write_text(render_report(summary, evals, th, rows, used, provisional))
    _log(f"wrote {REPORT}")
    if args.apply:
        changed = False
        for k, e in evals.items():
            rec = e["recommended_high"]
            if rec is not None and rec != th[k]["high"]:
                th[k]["high"] = rec
                changed = True
        if changed:
            THRESHOLDS.write_text(json.dumps({"kinds": th}, indent=2) + "\n")
            _log(f"updated {THRESHOLDS}; rerun `run` to rebuild entities")
        else:
            _log("thresholds unchanged")


def cmd_load(args: argparse.Namespace) -> None:
    if not args.database_url:
        raise SystemExit("--database-url or $DATABASE_URL is required")
    stats = load.load(args.database_url, args.out, dry_run=args.dry_run)
    print(json.dumps(stats, indent=2))


def _fmt(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def render_report(
    summary: dict, evals: dict, th: dict, rows: list[dict[str, str]], used: int, provisional: bool
) -> str:
    n_rows = len(rows)
    lines = [
        "# Donor resolution report",
        "",
        "Generated by `uv run python -m aletheia_resolve report`. Do not edit by hand.",
        "",
    ]
    labelers: dict[str, int] = {}
    for r in rows:
        if r.get("label", "").strip():
            who = r.get("labeler", "").strip() or "(blank)"
            labelers[who] = labelers.get(who, 0) + 1
    agent_only = bool(labelers) and all(w.startswith("agent:") for w in labelers)
    if provisional or agent_only:
        why = []
        if agent_only:
            why.append("every label was made by an agent, not a human")
        if used == 0:
            why.append("no pair is labeled yet")
        elif provisional:
            why.append("people do not reach precision 0.98 at any threshold")
        lines += [
            f"**Provisional:** {'; '.join(why)}. Labeled: {used} of {n_rows} pairs `same`/`different`"
            + (f" (by {', '.join(f'{k} {v}' for k, v in sorted(labelers.items()))})" if labelers else "")
            + ". Have a human check `data/manual/labels.csv`, then rerun `report`.",
            "",
        ]
    lines += ["## Entities", "", "| | People | Organizations |", "| --- | ---: | ---: |"]
    p, o = summary["kinds"]["person"], summary["kinds"]["org"]
    for label, key in [
        ("Raw records", "records"),
        ("Resolvable (usable name)", "resolvable_records"),
        ("Entities after resolution", "entities"),
        ("Records merged into a multi-record entity", "records_merged"),
        ("Multi-record entities", "multi_record_entities"),
        ('"Likely the same donor" links', "likely_links"),
        ("Scored pairs (p >= 0.2)", "scored_pairs"),
    ]:
        lines.append(f"| {label} | {p[key]:,} | {o[key]:,} |")
    lines += [
        "",
        f"Thresholds: people high >= {th['person']['high']}, likely >= {th['person']['likely']}; "
        f"organizations high >= {th['org']['high']}, likely >= {th['org']['likely']}.",
        "",
        "Never merged (kept one entity per raw record): "
        + ", ".join(f"{k} {v:,}" for k, v in summary["kept_separate_unresolved_kinds"].items())
        + ". Filers (`calaccess:filer:*`) are not read at all.",
        "",
        f"Entity digest (sha256 of sorted canonical_key → entity_key): `{summary['members_sha256']}`",
        "",
        "## Precision and recall (pairwise, weighted by stratum size)",
        "",
    ]
    for kind, e in evals.items():
        lines += [
            f"### {'People' if kind == 'person' else 'Organizations'}",
            "",
            f"Labels used: {e['labels_used']}. Recommended high threshold (precision >= 0.98 with at least "
            f"{labels.MIN_LABELS_ABOVE} labels above it): "
            f"{e['recommended_high'] if e['recommended_high'] is not None else 'none of 0.95-0.999 qualifies'}.",
            "",
            "| Threshold | Labeled pairs above | Precision | Recall |",
            "| ---: | ---: | ---: | ---: |",
        ]
        for t in e["thresholds"]:
            lines.append(
                f"| {t['threshold']} | {t['labels_above']} | {_fmt(t['precision'])} | {_fmt(t['recall'])} |"
            )
        lines.append("")
    lines += [
        "Recall counts only pairs the blocking rules compared (people: same last name and ZIP3; organizations:",
        "same normalized name) and that scored at least 0.2. Donors whose last name or ZIP3 differ across",
        "filings are never compared, so true recall is lower than shown.",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="aletheia_resolve", description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "train"):
        p = sub.add_parser(name)
        p.add_argument("--source", default=default_source())
    p = sub.add_parser("draft-labels")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("report")
    p.add_argument("--apply", action="store_true", help="write the recommended thresholds to thresholds.json")
    p = sub.add_parser("load", help="write the last run into Postgres (attrs + splink aliases; one transaction)")
    p.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    p.add_argument("--dry-run", action="store_true", help="do everything, then roll back")
    args = ap.parse_args(argv)
    {"run": cmd_run, "train": cmd_train, "draft-labels": cmd_draft, "report": cmd_report, "load": cmd_load}[
        args.cmd
    ](args)


if __name__ == "__main__":
    main()
