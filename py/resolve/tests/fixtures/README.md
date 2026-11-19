# Test fixtures

`calaccess_raw_sample.csv`: 25 raw CAL-ACCESS parties copied unchanged from `out_entity` built by
`python -m ingest.calaccess` (export sha256 `6b14bf50067fddd45ea5b1bf43ce6fbc62297d8ce4df1b1eaca6c82cfacc9476`,
downloaded 2026-11-15). `row_ref` is `<table>:<FILING_ID>:<AMEND_ID>:<form>:<line>` and `filing_url` is the
Secretary of State's PDF of that filing. Chosen because they test the hard cases:

- Jacques S. Yeager Sr. and Jacques S. Yeager Jr. of Riverside (both civil engineering / construction): must
  stay two people, including through records with no suffix.
- John A. Sobrato (Atherton) and John M. Sobrato (Los Gatos / Monte Sereno), both of The Sobrato Organization:
  must stay two people.
- "MICHAEL AND ELISA LEVY" and "John & Abby Sobrato": joint gifts, never merged.
- "Hal Robertson Farms LLC" / "HAL ROBERTSON FARMS": one organization.
- One raw committee (San Leandro Chamber of Commerce PAC): never merged.
