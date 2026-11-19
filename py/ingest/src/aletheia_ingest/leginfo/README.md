# leginfo ingest

California Legislature bills, authors and recorded votes from PUBINFO
(`https://downloads.leginfo.legislature.ca.gov/pubinfo_YYYY.zip`; format in `pubinfo_Readme.pdf` and
the LOAD DATA scripts in `pubinfo_load.zip`).

```bash
cd py/ingest
uv run python -m aletheia_ingest.leginfo download     # ~1.3 GB, logged in data/raw/MANIFEST.csv
uv run python -m aletheia_ingest.leginfo stage        # -> data/processed/leginfo/2025-2026/*.parquet
uv run python -m aletheia_ingest.leginfo verify       # sample bills vs leginfo website
uv run python -m aletheia_ingest.leginfo committees   # draft data/manual/legislator_committees.csv (won't overwrite approvals)
DATABASE_URL=... uv run python -m aletheia_ingest.leginfo load   # humans only
```

| Table | Source | Notes |
| --- | --- | --- |
| `entity` (kind `legislator`) | LEGISLATOR_TBL | One per member, 121 for 2025–2026 (120 seats, plus 3 who left mid-session, minus 2 seats vacant at extract). `canonical_key` = `leginfo:legislator:{A\|S}:{district}:{last}-{first}`. |
| `entity.attrs` CAL-ACCESS IDs | `data/manual/legislator_committees.csv` | `calaccess_committee_filer_ids`, `calaccess_candidate_filer_ids` from rows marked `approved = yes` only. |
| `entity_alias` | LEGISLATOR_TBL + `RENAMED` | Every name the source uses for the member, e.g. `Avila Farias`, `Weber`. |
| `bill` | BILL_TBL + BILL_VERSION_TBL | `session` `2025-2026`; `measure` as leginfo shows it (`AB-1`, `SBX1-1`); `title` = latest version subject. |
| `bill_author` | BILL_VERSION_AUTHORS_TBL | Latest version only. LEAD_AUTHOR → `lead`; COAUTHOR and PRINCIPAL_COAUTHOR → `coauthor`. Committee authors are skipped (not legislators): 286 bills have only a committee author. |
| `vote` | BILL_DETAIL_VOTE_TBL | One row per recorded member vote. AYE → `aye`, NOE → `no`, ABS → `nvr`. No row is created for a member with no recorded vote. |

Why per-member rows and not BILL_SUMMARY_VOTE_TBL: the website's counts match the member rows. The
summary table's ABSTAIN differs on 2,096 of 21,541 roll calls, and on one of those its AYES differ too (SB 329, Assembly Floor,
2026-08-25: summary 77–0–2, website and member rows 76–0–3).

Known gap: `vote` has no roll-call id. In 31 cases one bill has two roll calls with the same date,
location and motion, and their rows can't be told apart in the database. The staged parquet keeps
`location_code`, `vote_date_time`, `vote_date_seq` and `motion_id` for that.
