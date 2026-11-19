# Local campaign finance ingest

Loads city and county campaign filings into the same tables as state data (`filing`, `entity`, `entity_alias`,
`money_edge`). Everything stays behind `LOCAL_FILERS`, and each filing's `source` field names the jurisdiction it came from. Sources are listed in
[`data/sources.md`](../../../data/sources.md).

```bash
cd py/ingest
LOCAL_FILERS=on uv run python -m local run            # sf oakland la; add --refresh to re-download
LOCAL_FILERS=on uv run python -m local run oakland    # one jurisdiction
uv run pytest local/tests
```

`run` writes:

- `data/raw/<slug>/*.parquet` with the raw exports, plus a `manifest.json` of URLs, row counts and sha256 hashes (gitignored)
- `data/staging/<slug>/{filing,entity,entity_alias,money_edge}.parquet`, rows shaped like the db tables (gitignored)
- `data/checks/<slug>.md` and `.json`, the totals check against the jurisdiction's own portal (committed)

`load-pg` copies staging into Postgres. **Humans only**: agents never write to the database.

```bash
LOCAL_FILERS=on uv run python -m local load-pg sf oakland la --database-url "$DATABASE_URL"
```

| File | What |
| --- | --- |
| `cal_format.py` | The one parser for Form 460 schedules: canonical CAL record → table rows |
| `sf.py`, `oakland.py`, `la.py` | Rename each portal's columns to the CAL record |
| `socrata.py` | Pages through a SODA dataset as CSV |
| `pipeline.py` | Raw cache, staging output, totals check |
| `load_pg.py` | Idempotent copy into Postgres |
