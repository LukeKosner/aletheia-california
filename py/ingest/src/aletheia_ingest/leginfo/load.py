"""Load staged leginfo parquet into Postgres (entity, entity_alias, bill, bill_author, vote).

Humans run this (AGENTS.md: agents never write to the database). It runs in one
transaction and is safe to re-run: legislator entities upsert on canonical_key,
bills upsert on (session, measure), and this session's bill_author and vote rows
are replaced.
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl
import psycopg

from .transform import SOURCE


def approved_links(csv_path: Path) -> dict[str, dict[str, list[str]]]:
    """Committee and candidate filer IDs per legislator, from rows a human marked approved = yes."""
    if not csv_path.exists():
        return {}
    d = pl.read_csv(csv_path, infer_schema=False).filter(pl.col("approved").str.to_lowercase() == "yes")
    out: dict[str, dict[str, list[str]]] = {}
    for key, g in d.group_by("legislator_key"):
        cands = {c for v in g["candidate_filer_ids_f501"].drop_nulls() for c in v.split(";") if c}
        out[key[0]] = {
            "calaccess_committee_filer_ids": sorted(set(g["committee_filer_id"].drop_nulls())),
            "calaccess_candidate_filer_ids": sorted(cands),
        }
    return out


def load(database_url: str, staged_dir: Path, committees_csv: Path | None = None) -> dict[str, int]:
    legs = pl.read_parquet(staged_dir / "legislators.parquet")
    bills = pl.read_parquet(staged_dir / "bills.parquet")
    authors = pl.read_parquet(staged_dir / "bill_authors.parquet")
    votes = pl.read_parquet(staged_dir / "votes.parquet")
    sessions = bills["session"].unique().to_list()
    if len(sessions) != 1:
        raise ValueError(f"expected one session, got {sessions}")
    session = sessions[0]
    links = approved_links(committees_csv) if committees_csv else {}

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        # Legislator entities.
        ent_id: dict[str, str] = {}
        for r in legs.iter_rows(named=True):
            attrs = {k: r[k] for k in ("house", "district", "party", "author_name", "legislator_name", "first_name", "last_name", "active")}
            attrs |= {"sessions": [r["session"]], "source": SOURCE}
            # Human-approved CAL-ACCESS links from data/manual/legislator_committees.csv.
            attrs |= links.get(r["canonical_key"], {"calaccess_committee_filer_ids": [], "calaccess_candidate_filer_ids": []})
            cur.execute(
                """
                insert into entity (kind, name, canonical_key, attrs)
                values ('legislator', %s, %s, %s::jsonb)
                on conflict (canonical_key) do update
                  set name = excluded.name,
                      attrs = entity.attrs || excluded.attrs
                          || jsonb_build_object('sessions',
                               (select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
                                from jsonb_array_elements(coalesce(entity.attrs->'sessions', '[]'::jsonb) || excluded.attrs->'sessions') s))
                returning id
                """,
                (r["name"], r["canonical_key"], json.dumps(attrs)),
            )
            ent_id[r["canonical_key"]] = str(cur.fetchone()[0])
            cur.execute("delete from entity_alias where entity_id = %s and source = %s", (ent_id[r["canonical_key"]], SOURCE))
            for a in r["aliases"]:
                cur.execute(
                    "insert into entity_alias (entity_id, raw_name, source, method) values (%s, %s, %s, 'leginfo_legislator_tbl')",
                    (ent_id[r["canonical_key"]], a, SOURCE),
                )

        # Bills.
        bill_id: dict[str, str] = {}
        for r in bills.iter_rows(named=True):
            cur.execute(
                """
                insert into bill (session, measure, title, status) values (%s, %s, %s, %s)
                on conflict (session, measure) do update set title = excluded.title, status = excluded.status
                returning id
                """,
                (r["session"], r["measure"], r["title"], r["status"]),
            )
            bill_id[r["source_bill_id"]] = str(cur.fetchone()[0])

        # Replace this session's authors and votes.
        cur.execute("delete from bill_author where bill_id in (select id from bill where session = %s)", (session,))
        cur.execute("delete from vote where bill_id in (select id from bill where session = %s)", (session,))
        with cur.copy("copy bill_author (bill_id, legislator_entity, role) from stdin") as cp:
            for r in authors.iter_rows(named=True):
                cp.write_row((bill_id[r["source_bill_id"]], ent_id[r["legislator_key"]], r["role"]))
        with cur.copy("copy vote (bill_id, legislator_entity, vote_date, motion, location, result) from stdin") as cp:
            for r in votes.iter_rows(named=True):
                cp.write_row(
                    (bill_id[r["source_bill_id"]], ent_id[r["legislator_key"]], r["vote_date"], r["motion"], r["location"], r["result"])
                )

        counts = {"legislators_with_committees": sum(1 for k in ent_id if k in links)}
        for table, sql in {
            "legislators": "select count(*) from entity where kind = 'legislator' and canonical_key like 'leginfo:legislator:%%'",
            "bills": "select count(*) from bill where session = %s",
            "bill_authors": "select count(*) from bill_author ba join bill b on b.id = ba.bill_id where b.session = %s",
            "votes": "select count(*) from vote v join bill b on b.id = v.bill_id where b.session = %s",
        }.items():
            cur.execute(sql, () if table == "legislators" else (session,))
            counts[table] = cur.fetchone()[0]
        expected = {"bills": bills.height, "bill_authors": authors.height, "votes": votes.height}
        for k, n in expected.items():
            if counts[k] != n:
                raise AssertionError(f"{k}: staged {n}, database {counts[k]}; rolling back")
        conn.commit()
    return counts
