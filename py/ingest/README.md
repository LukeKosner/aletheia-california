# aletheia-ingest

Download and load California public filings (Cal-Access, legislature, Form 700) into Postgres.

```bash
uv sync
uv run pytest
```

## Sources

- `aletheia_ingest.leginfo`: California Legislature bills, authors and votes. See
  [src/aletheia_ingest/leginfo/README.md](src/aletheia_ingest/leginfo/README.md).
- `ingest.calaccess`: CAL-ACCESS campaign finance and lobbying. See [CAL-ACCESS](#cal-access) below.

## CAL-ACCESS

```bash
uv run python -m ingest.calaccess                      # full history into $DATABASE_URL
uv run python -m ingest.calaccess --since 2025-01-01   # only filings whose period ends on/after a date
uv run python -m ingest.calaccess --no-db              # stop after building out_* tables in DuckDB
```

`DATABASE_URL` comes from the environment or `py/ingest/.env`. A full-history load is roughly 12–16 GB in
Postgres, more than the Neon free plan holds. Staging needs about 10 GB free disk (the export is 1.6 GB zipped,
10.6 GB unzipped; it is never unzipped to disk).

Steps (`src/ingest/calaccess/`):

1. **download.py**: fetches `https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip` unchanged into
   `data/raw/calaccess/<date>/` and appends URL, time, SHA-256, size, Last-Modified and ETag to
   `data/raw/MANIFEST.csv` (columns shared with leginfo; `path` relative to `data/raw/`). It skips the download if the state's ETag matches the last download.
2. **stage.py**: streams each table out of the zip into `data/work/calaccess.duckdb`, all columns as text.
   It rejoins rows split by embedded line breaks. Rows it cannot place go to `_rejects` with the raw text, and
   per-table counts go to `_load_log`. Every physical line is accounted for, or the run stops.
   Staged tables: filers (`FILERS_CD`, `FILERNAME_CD`, `FILER_XREF_CD`), the filing index (`FILER_FILINGS_CD`),
   campaign covers, receipts, expenditures, late contributions (497), late independent expenditures (496),
   loans, and lobbying (`CVR_LOBBY_DISCLOSURE_CD`, `CVR_REGISTRATION_CD`, `LPAY_CD`, `LEXP_CD`, `LCCM_CD`,
   `LEMP_CD`, `LOTH_CD`, `TEXT_MEMO_CD`). Table guide: <https://calaccess.californiacivicdata.org/documentation/raw-files/>.
3. **transform.py**: keeps only the latest amendment of each filing and builds `out_entity`,
   `out_entity_alias`, `out_filing`, `out_money_edge` and `out_lobby_activity`, plus `out_exclusions`, which
   counts every itemized row that did not become an edge and why.
4. **load.py**: one transaction against Postgres. Rows have deterministic ids, so a rerun inserts nothing new;
   a filing's older amendments and their edges are deleted when a newer amendment arrives.

### Mapping

| Source | money_edge.kind | from → to |
| --- | --- | --- |
| RCPT_CD A, C, F496P3, F401A, F900 | contribution | donor → filer |
| RCPT_CD A-1 | transfer | donor → filer |
| S497_CD F497P1 / F497P2 | contribution | donor → filer / filer → recipient |
| EXPN_CD, `EXPN_CODE=IND` or F465P3, support/oppose | ie_support / ie_oppose | filer → candidate or measure |
| EXPN_CD `CTB`, `IKD`, or Schedule D | contribution | filer → recipient |
| EXPN_CD `TSF` | transfer | filer → recipient |
| EXPN_CD other | expenditure | filer → payee |
| S496_CD | ie_support / ie_oppose | filer → candidate or measure on the 496 cover |
| LOAN_CD B1 / H, H1 | loan | lender → filer / filer → borrower |

Not edges, counted in `out_exclusions`: memo rows (`MEMO_CODE = X`, amounts repeated elsewhere on the same
filing), RCPT_CD I (miscellaneous increases to cash) and E530, LOAN_CD B2, B3, H2 and H3 (guarantors,
repayments, forgiveness).

`money_edge.schedule` is the form/schedule code (e.g. `A`, `F497P1`); `line_item` is the filing's line number.
Late contributions (497) are usually also itemized later on the 460 Schedule A, so sums across both schedules
count those contributions twice. Filter on `schedule` when totaling.

Entities: every CAL-ACCESS filer is one entity keyed `calaccess:filer:<FILER_ID>`. Legacy ids (for example
`L25430`) map to current ids through `FILER_XREF_CD`. Donors, payees, lenders, lobbying clients and IE targets
are matched to a filer only by an id on the record (`CMTE_ID`, `CAND_ID`, `BAL_ID`, `EMPLR_ID`), never by name.
Otherwise each distinct raw name + city/state/ZIP becomes a temporary entity `calaccess:raw:<md5>`
(`attrs.temporary = true`) with one `entity_alias` row (`method = 'raw'`), for entity resolution to merge later.

Lobbying: one `lobby_activity` row per Form 625 Part 2 / Form 635 Part 3B payment (employer, firm, period
amount), plus one row per Form 635/645 cover (employer's own activity description; amount empty). `bills` holds
every `(AB|SB|ACA|SCA|AJR|SJR|ACR|SCR)\s*-?\s*\d{1,4}` match in the activity text and its text memos,
normalized to `AB 1751` form.

Filing URLs: `https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=<id>&amendid=<n>`.
