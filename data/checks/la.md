# Totals check: Los Angeles (city)

- Source tag: `lacity:lac`
- Portal: https://data.lacity.org/browse?q=campaign
- Ran at: 2026-11-16T00:26:20+00:00
- Result: **PASS** (every schedule: >= 98% of filings with money match to the cent, aggregate within 0.5%)

LA publishes no filed summary totals, so this check compares our loaded itemized Schedule A and Schedule E sums per committee and statement period against the same sums computed server-side by data.lacity.org (SoQL sum/group by on m6g2-gc6c and 5mrt-4zhe). It proves the load is complete and amounts parse exactly; it does not cross-check the filer's own summary page.

| Schedule | Filings (with money) | Matched to the cent | Match rate | Our total | Portal total | Aggregate diff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 4,381 | 4,381 | 100.00% | $454,847,329.44 | $454,847,329.44 | +0.0000% |
| E | 10,741 | 10,741 | 100.00% | $847,641,525.32 | $847,641,525.32 | +0.0000% |

## Rows

- CAL rows parsed: 742,870
- filing: 19,762 · entity: 239,441 · entity_alias: 255,278 · money_edge: 576,062
- money_edge by kind: contribution 400,867, expenditure 174,257, loan 938
- Rows not loaded as edges: memo_row 8,766, no_counterparty_name 74, no_filer 44, schedule_not_loaded 124,205, zero_amount 33,719

## Largest mismatches

None.

## Raw exports

| Name | Rows | sha256 | Fetched |
| --- | ---: | --- | --- |
| [contributions](https://data.lacity.org/resource/m6g2-gc6c.csv) | 429,883 | `d74f7953a6df9aa5` | 2026-11-16T00:22:21+00:00 |
| [expenditures](https://data.lacity.org/resource/5mrt-4zhe.csv) | 312,987 | `cf9f1858bdacab1d` | 2026-11-16T00:23:17+00:00 |
| [statements](https://data.lacity.org/resource/br3a-db9a.csv) | 12,659 | `aedf07394c378c1f` | 2026-11-16T00:23:19+00:00 |
| [portal_sum_a](https://data.lacity.org/resource/m6g2-gc6c.csv?$select=cmt_id,per_beg_date,per_end_date,sum(con_amount)&$where=schedule='A' AND con_type like '%(Itemized)%'&$group=cmt_id,per_beg_date,per_end_date) | 4,408 | `ece05ee5c27a1e3e` | 2026-11-16T00:23:34+00:00 |
| [portal_sum_e](https://data.lacity.org/resource/5mrt-4zhe.csv?$select=cmt_id,per_beg_date,per_end_date,sum(exp_amount)&$where=exp_type='Payment Made [Form 460, Schedule E]'&$group=cmt_id,per_beg_date,per_end_date) | 12,599 | `54ad5330c3bfaed0` | 2026-11-16T00:23:38+00:00 |
