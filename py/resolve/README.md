# aletheia-resolve

Entity resolution for raw CAL-ACCESS donors with Splink: each real donor becomes one entity across all filings,
with a confidence score.

```bash
uv sync
uv run pytest
```

## Commands

```bash
uv run python -m aletheia_resolve run --source <calaccess.duckdb | parquet | postgres URL>
uv run python -m aletheia_resolve draft-labels          # 200 pairs -> data/manual/labels.csv
uv run python -m aletheia_resolve report [--apply]      # precision/recall -> REPORT.md
uv run python -m aletheia_resolve train --source ...    # re-estimate models/*.json (seeded)
uv run python -m aletheia_resolve load [--dry-run]      # write the last run into Postgres ($DATABASE_URL)
```

`--source` defaults to `$RESOLVE_SOURCE`, then `$DATABASE_URL`, then `data/work/calaccess.duckdb`. DuckDB is
opened `read_only`; Postgres in a read-only session. Only `load` writes to a database. Outputs go to
`data/work/resolve/` (gitignored). A full run over 3.0M raw entities takes about one minute.

## Input

Raw parties from the CAL-ACCESS ingest: `entity` rows with `canonical_key LIKE 'calaccess:raw:%'` and
`attrs.temporary = true`, with `attrs` `entity_cd`, `city`, `state`, `zip`, `employer`, `occupation`
(`py/ingest/README.md`, CAL-ACCESS > Mapping). Only `kind` `person` and `org` are resolved. Raw committees,
candidates, measures and lobbying firms stay one entity per record. Filers (`calaccess:filer:*`) are never read.

## Method

1. **Normalize** (`normalize.py`): uppercase, drop punctuation, strip titles (MR, DR, HON...), suffixes
   (JR, SR, III, MD, ESQ...) and legal forms (INC, LLC, CORP, CO, LTD...). People split into first, middle and
   last name (the ingest builds names as "TITLE FIRST LAST SUFFIX"); the generational suffix is kept
   separately. Placeholders (N/A, NONE, INFORMATION REQUESTED, NO NAME GIVEN) become empty. Joint names
   ("MICHAEL AND ELISA LEVY") are not resolved.
2. **Block**: people on last name + ZIP3; organizations on normalized name. People and organizations are
   scored by separate models on separate tables, so a person is never compared with an organization.
3. **Score** (`model.py`, Splink 5, DuckDB): people on first name (exact / Jaro-Winkler 0.92 / 0.80 /
   initial), middle initial, last name, employer, occupation, city (Jaro-Winkler) and ZIP5; organizations
   on name, city and ZIP5. Term-frequency adjustments on names, employer, occupation and city. Name m
   probabilities are fixed priors: unconstrained EM learned "same household / same office" instead of
   "same person". u probabilities come from seeded random sampling; the rest from EM on
   first name + last name + ZIP3 (people) or name (organizations).
4. **Name rule** (people): first names that clearly differ, JR vs SR, or MR vs MRS/MS are `conflict` (never merged,
   never likely). Loosely similar first names (Jaro-Winkler 0.80–0.92: LISA/LOIS, TOM/THOMAS) are
   `weak` (at most likely).
5. **Cluster** (`cluster.py`) with `thresholds.json`:
   - p ≥ 0.95: same entity (`confidence = high`). Constrained connected components: a merge is refused if
     the entity would then hold different full first names, middle initials, generational suffixes or
     MR/MRS titles
     (stops SR – no suffix – JR chains).
   - 0.80 ≤ p < 0.95, or a refused merge: a link labeled **"likely the same donor"**. Not merged; must be
     shown with that label wherever it appears.
   - p < 0.80: separate.

## Outputs (`data/work/resolve/`)

| File | Rows |
| --- | --- |
| `members.parquet` | one per raw entity: `canonical_key`, `kind`, `entity_key` (smallest member key), `cluster_size`, `match_score`, `confidence` |
| `likely_links.parquet` | `kind`, `entity_key_l`, `entity_key_r`, `match_probability`, `label` = "likely the same donor" |
| `pairs.parquet` | every scored pair with p ≥ 0.2 and its `name_rule` |
| `summary.json` | counts, largest entities, `members_sha256` |

Reruns on the same input give byte-identical entities (`members_sha256`): `run` reads the committed
`models/*.json`, ties are broken by key, and the entity key is the smallest member key. `train` is seeded and
writes canonical JSON (floats rounded to 10 significant digits), so a retrain reproduces the same models.
Scores do change when the input changes, because term frequencies are computed from the input.

## Labels

`data/manual/labels.csv` holds 200 candidate pairs drawn from fixed strata (merged ≥ 0.99, merged 0.95–0.99,
likely, weak name, name conflict, separate; 140 people, 60 organizations), each with both records' fields and
the state's filing PDF. The current labels were made by `agent:resolve` and must be checked by a human
before this goes live (see the open issue). Fill `label` with `same`, `different` or `unsure` (and `labeler`), then run `report`.
Precision and recall are weighted by stratum size. `report --apply` raises the high threshold per kind to the
lowest of 0.95–0.999 that reaches precision ≥ 0.98 with at least 20 labeled pairs above it; rerun `run`
afterwards. `draft-labels` refuses to overwrite a file that already has labels (`--force` to do it anyway).

## Loading into Postgres

`load` (approved by the project owner on 2026-11-15 as an exception to the agents-never-write rule) writes the
last `run` into `$DATABASE_URL` in one transaction, additively, without a schema change:

- `entity.attrs` of each merged raw person/org gets `resolved_entity_key`, `resolved_entity_id`,
  `resolved_member_count`, `match_score` and `confidence`.
- Each merged member gets an `entity_alias` row on its resolved entity (`method = 'splink'`, `match_score`).
- Entities with "likely the same donor" links get `attrs.likely_same_donor` (`entity_key`, `match_probability`,
  `label`).
- Money edges are untouched; total by `coalesce(attrs->>'resolved_entity_key', canonical_key)`.

Each run first clears the previous resolution, so reruns replace it. The loader refuses to write if the
database doesn't hold the raw entities the run was built from. The CAL-ACCESS ingest replaces `attrs` on
upsert, so rerun `run --source "$DATABASE_URL"` and then `load` after every ingest reload. To test against a
throwaway Postgres built from `packages/db/drizzle/0000_init.sql`, set `TEST_DATABASE_URL` (the test
truncates `entity`).
