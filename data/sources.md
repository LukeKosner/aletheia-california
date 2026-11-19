# Local campaign finance sources

Local (city and county) campaign filings, loaded by `py/ingest/local` behind the `LOCAL_FILERS` flag.
Checked 2026-11-15. Totals checks: [`checks/`](checks/).

| Jurisdiction | Status | Source tag (`filing.source`) | Where the data comes from |
| --- | --- | --- | --- |
| San Francisco | Loaded | `datasf:sfo` | DataSF (SODA API), SF Ethics Commission datasets |
| Oakland | Loaded | `oaklandca:coak` | data.oaklandca.gov (SODA API), City copies of its NetFile filings |
| Los Angeles (city) | Loaded | `lacity:lac` | data.lacity.org (SODA API), City Ethics Commission datasets |
| San Jose | Skipped | none | No NetFile portal and no open data export found |
| Santa Clara County | Skipped | none | NetFile portal (agency `SCC`), no usable export |

## San Francisco

| Dataset | ID | URL |
| --- | --- | --- |
| Campaign Finance - Transactions | `pitq-e56w` | https://data.sf.gov/d/pitq-e56w |
| Campaign Finance - Summary Totals | `9ggq-m8hp` | https://data.sf.gov/d/9ggq-m8hp |
| Campaign Finance - Filings Received by SFEC | `qizs-bwft` | https://data.sf.gov/d/qizs-bwft |

- SODA endpoint: `https://data.sf.gov/resource/pitq-e56w.csv` (`data.sfgov.org` now redirects to `data.sf.gov`).
- Each amendment has its own `filing_id_number`; `filing_version` becomes `filing.amendment_no`.
- The Transactions dataset has no street-address columns.
- Local-only filers with no FPPC id are keyed by name with an `sfo-nid-<filer_nid>` local id.

## Oakland

Oakland files on NetFile (agency `COAK`). NetFile's public portal (`netfile.com/public/COAK/campaign`) sits behind a
Cloudflare Turnstile bot check, and the old Connect2 export endpoints
(`/Connect2/api/public/campaign/export/cal201/transaction/year`) now return 404 or reject every parameter. So we use
the City's open data copies, which keep NetFile's CAL column names:

| Schedule | ID |
| --- | --- |
| Form 460 Schedule A, monetary contributions | `3xq4-ermg` |
| Form 460 Schedule B1, loans received | `qaa7-q29f` |
| Form 460 Schedule C, non-monetary contributions | `ba44-jqtm` |
| Form 460 Schedule D, contributions and IEs made | `x5eg-xkea` |
| Form 460 Schedule E, payments made | `bvfu-nq99` |
| Form 460 Schedule H, loans made | `qunm-zyau` |
| Form 460 Summary Totals | `rsxe-vvuw` |

- URL pattern: `https://data.oaklandca.gov/d/<id>`.
- The exports have no filing number. A filing is identified as `filer_id:from_date:thru_date:rpt_date:report_num`;
  `report_num` (0 = original) becomes `filing.amendment_no`. There is no per-filing URL.
- Some transactions appear twice, identical in every column. A `tran_id` is unique within a filing, so exact repeats
  are dropped. Without this, those filings come out at exactly 2x their reported totals.
- The datasets include address columns (`tran_adr1`, `payee_adr1`, ...). They are redacted and never requested.

## Los Angeles (city)

| Dataset | ID | URL |
| --- | --- | --- |
| City Campaign Contributions (and Misc Increases to Cash) | `m6g2-gc6c` | https://data.lacity.org/d/m6g2-gc6c |
| City Campaign Expenditures | `5mrt-4zhe` | https://data.lacity.org/d/5mrt-4zhe |
| City Campaign Statements Filed | `br3a-db9a` | https://data.lacity.org/d/br3a-db9a |

- LA's exports are flattened Form 460 schedules, not CAL records: no transaction id, no entity code, no filing number.
- A filing is identified as `cmt_id:per_beg_date:per_end_date`. The statement PDF link comes from `br3a-db9a` when
  exactly one statement matches.
- Contributor type is inferred: a listed occupation or employer means an individual, otherwise an organization.
- Unitemized lines and Schedule I (misc. increases to cash) are not loaded as edges. Subvendor rows on Schedule E are
  treated as memo rows.
- The free-text `memo` column is never requested: some entries contain street addresses.
- Old committees have 4-digit City ids instead of FPPC ids; those are keyed by name.
- LA publishes no filed summary totals, so its totals check compares our sums with sums computed server-side by
  data.lacity.org. That proves the load is complete and exact, not that filers' summaries agree.

## San Jose (skipped)

- Not a NetFile agency (absent from NetFile's agency list, `https://netfile.com/Connect2/api/public/campaign/agencies`).
- The City Clerk's campaign reports page (`sanjoseca.gov/.../city-clerk/elections/campaign-reports`) returns 403 to
  automated requests. It describes a City "Electronic Filing System" with a public search tool. The previous system
  was due to be taken down by February 2026.
- No San Jose campaign finance dataset on the City's open data portal (`data.sanjoseca.gov`, CKAN search "campaign": 0).
- To revisit: ask the City Clerk whether the new system offers a bulk CSV export.

## Santa Clara County (skipped)

- A NetFile agency (`SCC`, id 51), but the NetFile public portal is behind a Cloudflare Turnstile check and its
  Connect2 export endpoints no longer work (see Oakland). We do not get around bot checks.
- No campaign finance dataset on `data.sccgov.org` (Socrata catalog search "campaign": 0).
- To revisit: ask NetFile or the Registrar of Voters for a public bulk export.

## Shared rules

- Parser: `py/ingest/local/cal_format.py`, one for every jurisdiction. Form 460 schedules A, B1, C, D, E and H become
  `money_edge` rows. F, G, I, B2, memo rows, unitemized lines and late or 461/465 reports are not loaded (they repeat or
  break down amounts that are already counted).
- Entity keys: committees with an FPPC id are `calaccess:filer:<id>`, so a local committee matches the same committee
  in state data. Everything else is `<kind>:<source>:<normalized name>` (people also get `|<zip5>`). Entity
  resolution happens later in `py/resolve`.
- Ids are uuid5 values, so reloading gives the same ids.
- Street addresses are redacted by law and never stored or restored. Only city, state and ZIP (5 digits) are kept.
- Raw downloads go to `data/raw/` and staging parquet to `data/staging/`. Both are gitignored.
