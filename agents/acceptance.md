# P9 acceptance evidence

**Status: NOT RUN live.** The requested three real questions per type remain blocked on a deployed private MCP endpoint, reviewed hard tool enforcement, supported HarnessRouter-to-PaleBlueDot TokenRouter writer routing, and actual interests data. No completed answer recording or real claim ID is fabricated. The twelve offline tests use a real filing edge with generated transport-only UUIDs, and are not these investigations.

The existing views do not expose normalized measure committee positions, donor state, bill authorship/author-to-committee links, or local jurisdiction. Those requested parts may legitimately produce no finding; never substitute prior model knowledge. A row or graph endpoint does not prove an ultimate source.

## Bill: three real sourced questions, queued

Source: committed `py/ingest/tests/leginfo/fixtures/pubinfo_votes_sample.csv` and https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB329.

1. For SB 329 in the 2025–2026 session, how did every member vote on each recorded roll call?
2. For SB 329 in the 2025–2026 session, which employers reported lobbying on the bill, and which contributions to recorded authors' committees are supported by the available views?
3. For SB 329 in the 2025–2026 session, what is the every-member base rate for the Assembly Floor third-reading vote, including nonvoters?

Do not assume the money, lobbying or authorship requested in question 2 exists just because the vote fixture does.

## Footprint: three real sourced questions, queued

Source: committed `packages/tools/test/fixtures/calaccess_slice.json`; CAL-ACCESS bulk export https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip, source hash in fixture/MANIFEST. Entities are filer 1481256 (CA HOMES COMMITTEE), filer 782560 (CALIFORNIA ASSOCIATION OF REALTORS ISSUES MOBILIZATION PAC), and filer 495189 (NATIONAL ASSOCIATION OF REALTORS).

1. Which campaign-money recipients of CA HOMES COMMITTEE are supported by the selected filing period and schedule?
2. Which recipients received reported contributions from CALIFORNIA ASSOCIATION OF REALTORS ISSUES MOBILIZATION PAC, keeping repeated schedules separate?
3. What state and local recipient jurisdictions can actually be established for NATIONAL ASSOCIATION OF REALTORS from the available views?

## Measure: three real sourced questions, queued

Source: California's official 2020 Proposition 19 guide https://vigarchive.sos.ca.gov/2020/general/propositions/19/. The guide establishes the measure's identity, not committee funding. An actual `measure` entity UUID and filed position relationships must be loaded before sending these questions; do not substitute a committee UUID.

1. Which committees filed support or opposition activity for Proposition 19 in the 2020 election period?
2. For Proposition 19 in 2020, which earliest observed sources appear in upstream committee funding paths at depth at most five?
3. What California, out-of-state and unknown shares can be calculated for Proposition 19 in 2020 using disclosed geography and a consistent reporting schedule?

## Interests: blocked before selecting real questions

No Form 700 fixture or validated official-interest entity is available on this branch. Selecting three officials, filing years or businesses without imported public filings would violate the no-invented-fixture rule. Once P11 provides real cited filings, record three actual questions here: disclosed-interest inventory, matched business-to-lobbying overlap, and overlap with explicitly identified bills/periods. Keep `FORM700=off` in the meantime. Public retrieval source: https://www.fppc.ca.gov/search-filings/form-700-search/.

## Offline evidence only

The protocol tests use filing 3128904, amendment 0, F497P1 line 1 from the committed CAL-ACCESS fixture: https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=3128904&amendid=0. The source edge reports $1,175,000.00 dated 2026-03-13. Test investigation/claim/response IDs are explicitly generated test infrastructure, not a recording of a live investigation. No claim in this file is presented as independently verified.
