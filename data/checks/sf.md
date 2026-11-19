# Totals check: San Francisco

- Source tag: `datasf:sfo`
- Portal: https://data.sf.gov/d/pitq-e56w
- Ran at: 2026-11-16T00:26:10+00:00
- Result: **PASS** (every schedule: >= 98% of filings with money match to the cent, aggregate within 0.5%)

Per Form 460 filing, the sum of itemized non-memo Schedule A and Schedule E rows in Transactions (pitq-e56w) against line 1 of Schedule A and Schedule E in SF Ethics' Summary Totals (9ggq-m8hp).

| Schedule | Filings (with money) | Matched to the cent | Match rate | Our total | Portal total | Aggregate diff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 9,261 | 9,196 | 99.30% | $525,230,781.32 | $524,068,933.57 | +0.2217% |
| E | 11,856 | 11,770 | 99.27% | $592,256,617.76 | $592,742,877.63 | -0.0820% |

## Rows

- CAL rows parsed: 728,120
- filing: 13,323 · entity: 225,626 · entity_alias: 258,983 · money_edge: 717,991
- money_edge by kind: contribution 523,278, expenditure 179,981, ie_oppose 2,034, ie_support 11,692, loan 1,006
- Rows not loaded as edges: memo_row 1,086, no_amount 1, no_counterparty_name 2,159, zero_amount 6,883

## Largest mismatches

| filing_id | schedule | ours | portal | diff |
| --- | --- | ---: | ---: | ---: |
| `169071798` | A | 930,000.00 | 0.00 | +930,000.00 |
| `195435014` | E | 17,497.91 | 446,477.31 | -428,979.40 |
| `195435014` | A | 1,725.00 | 184,439.00 | -182,714.00 |
| `6721895` | A | 144,671.00 | 0.00 | +144,671.00 |
| `6722717` | A | 130,050.00 | 0.00 | +130,050.00 |
| `6707535` | E | 0.00 | 82,045.30 | -82,045.30 |
| `6720434` | A | 151,700.00 | 75,850.00 | +75,850.00 |
| `6707535` | A | 0.00 | 54,960.00 | -54,960.00 |
| `6724130` | E | 693,725.02 | 643,663.74 | +50,061.28 |
| `6765717` | E | 0.00 | 33,445.24 | -33,445.24 |
| `6722724` | A | 30,000.00 | 0.00 | +30,000.00 |
| `6723408` | E | 0.00 | 26,384.44 | -26,384.44 |
| `6720272` | A | 21,000.00 | 0.00 | +21,000.00 |
| `6706229` | A | 439,050.00 | 419,050.00 | +20,000.00 |
| `6723334` | A | 19,400.00 | 0.00 | +19,400.00 |

## Raw exports

| Name | Rows | sha256 | Fetched |
| --- | ---: | --- | --- |
| [filings](https://data.sf.gov/resource/qizs-bwft.csv) | 32,862 | `78ae5ad437d66d79` | 2026-11-16T00:18:56+00:00 |
| [transactions](https://data.sf.gov/resource/pitq-e56w.csv) | 728,120 | `7c9159ee2d7ac435` | 2026-11-16T00:21:17+00:00 |
| [summary_totals](https://data.sf.gov/resource/9ggq-m8hp.csv) | 15,776 | `04d9cfbc6ddb0785` | 2026-11-16T00:21:29+00:00 |
