# Totals check: Oakland

- Source tag: `oaklandca:coak`
- Portal: https://data.oaklandca.gov/browse?q=campaign%20finance
- Ran at: 2026-11-16T00:26:12+00:00
- Result: **PASS** (every schedule: >= 98% of filings with money match to the cent, aggregate within 0.5%)

Per Form 460 filing, the sum of itemized non-memo rows in the Schedule A (3xq4-ermg) and Schedule E (bvfu-nq99) datasets against line 1 of Schedule A and Schedule E in the City's Form 460 Summary Totals (rsxe-vvuw).

| Schedule | Filings (with money) | Matched to the cent | Match rate | Our total | Portal total | Aggregate diff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 1,464 | 1,461 | 99.80% | $52,072,654.79 | $52,050,538.50 | +0.0425% |
| E | 1,770 | 1,766 | 99.77% | $58,026,879.10 | $58,019,620.35 | +0.0125% |

## Rows

- CAL rows parsed: 103,392
- filing: 2,014 · entity: 33,752 · entity_alias: 35,623 · money_edge: 101,921
- money_edge by kind: contribution 73,392, expenditure 26,585, ie_oppose 188, ie_support 1,451, loan 305
- Rows not loaded as edges: memo_row 89, no_counterparty_name 258, zero_amount 1,124

## Largest mismatches

| filing_id | schedule | ours | portal | diff |
| --- | --- | ---: | ---: | ---: |
| `1481569:2026-01-01:2026-06-30:2026-07-31:0` | A | 98,300.00 | 74,200.00 | +24,100.00 |
| `1387983:2016-10-23:2016-12-31:2016-12-30:0` | E | 207,937.86 | 203,197.60 | +4,740.26 |
| `1481569:2026-01-01:2026-06-30:2026-07-31:0` | E | 19,134.65 | 16,688.18 | +2,446.47 |
| `S10088:2015-07-01:2015-12-31:2016-01-22:0` | A | 0.00 | 1,753.71 | -1,753.71 |
| `892160:2015-07-01:2015-12-31:2016-01-26:0` | A | 43,784.64 | 44,014.64 | -230.00 |
| `1320283:2013-07-01:2013-12-31:2014-01-16:0` | E | 6,455.65 | 6,383.65 | +72.00 |
| `1464418:2024-07-01:2024-09-21:2024-09-22:0` | E | 15,411.17 | 15,411.15 | +0.02 |

## Raw exports

| Name | Rows | sha256 | Fetched |
| --- | ---: | --- | --- |
| [schedule_a](https://data.oaklandca.gov/resource/3xq4-ermg.csv) | 73,043 | `662e9f722ba32165` | 2026-11-16T00:17:17+00:00 |
| [schedule_b1](https://data.oaklandca.gov/resource/qaa7-q29f.csv) | 1,335 | `f8ed3373fe4fa2c6` | 2026-11-16T00:17:28+00:00 |
| [schedule_c](https://data.oaklandca.gov/resource/ba44-jqtm.csv) | 911 | `6f5598ae43c65903` | 2026-11-16T00:17:29+00:00 |
| [schedule_d](https://data.oaklandca.gov/resource/x5eg-xkea.csv) | 2,723 | `a831b2234aebf51f` | 2026-11-16T00:17:30+00:00 |
| [schedule_e](https://data.oaklandca.gov/resource/bvfu-nq99.csv) | 28,292 | `59b87e616da8ba83` | 2026-11-16T00:17:32+00:00 |
| [schedule_h](https://data.oaklandca.gov/resource/qunm-zyau.csv) | 11 | `74d68d4bbd2758a3` | 2026-11-16T00:17:33+00:00 |
| [summary_totals](https://data.oaklandca.gov/resource/rsxe-vvuw.csv) | 4,450 | `445ac1397e3aa5f1` | 2026-11-16T00:17:42+00:00 |
