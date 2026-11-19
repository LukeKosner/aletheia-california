# Form 700: opt-in staging, awaiting live intake and human review

`FORM700` is **off by default**. Every work entry point checks it before reads,
writes, subprocesses or network calls. Nothing here opens a database connection or
loads records. No dependency was added. `PUBLIC_SITE` is untouched.

## Current evidence and limits

- [FPPC public portal](https://form700search.fppc.ca.gov/) supports agency, name,
  year and statement-type searches. Its own search code uses a browser search ticket
  for search and PDF requests. This package does **not** implement that ticket or
  challenge. Use normal public downloads; do not copy browser cookies or tickets.
- On 2026-11-15 a normal browser search for State Assembly, currently held positions,
  Annual returned 498 entries. Ten actual entries and filed dates are preserved in
  `tests/fixtures/portal-observation.json` and [REVIEW_TEN.md](REVIEW_TEN.md).
  The PDF button did not produce a file in this browser (including a download-event
  attempt). Thus **zero legislator PDFs acquired, zero live model extractions, and
  zero human spot-checks completed**. Search metadata is not verified filing content.
- The real test PDF comes from the [Los Angeles City Clerk](https://cityclerk.lacity.org/onlinedocs/2026/26-1200-s13_misc_3-24-26.pdf),
  Council File 26-1200-S13, SAN 011300006-STH-0006 (John Perez, filed 2026-03-24).
  Its SHA-256 and purpose are in `tests/fixtures/perez-source.json`. It tests PDF text
  extraction and evidence validation; it is **not** a current-legislator coverage sample.
- No TokenRouter key is set in the task environment. The intended provider is the
  [PaleBlueDot TokenRouter sponsor](https://tokenrouter.palebluedot.top/docs/tokenrouter-feature-guide/),
  whose [models page](https://tokenrouter.palebluedot.top/models/) lists OpenAI-format
  models. Its [official setup guide](https://www.tokenrouter.com/docs/zcode-setup/)
  specifies base URL `https://api.tokenrouter.com/v1` and `/chat/completions`.
  Other unrelated services also call themselves TokenRouter; this adapter uses only
  the sponsor's documented `.com` endpoint and the OpenAI Chat Completions JSON/Bearer
  contract. It still needs a live sponsor compatibility check. Supply
  `TOKENROUTER_KEY` (repo convention) or `TOKENROUTER_API_KEY` securely, and an explicit
  account-enabled model ID. Requests saved as evidence contain no key.

## Human intake

1. Obtain a current legislator roster from an official legislature source. Assign
   explicit `official_key` values; keep the official roster URL. No database access
   or automatic name/entity matching is used.
2. In the portal search both State Assembly and State Senate, then each roster
   member, across statement types/years. Confirm the most recently **filed**
   statement, not just the largest reporting year. Candidates are not a roster.
3. Save the PDF and its displayed metadata into a local index. An amendment can be
   partial: include the original and every amendment for its statement type/year.
   The package preserves all of those as separate evidence; it does not merge their
   contents or treat amendments as complete replacements.
4. Keep this local index and outputs outside tracked source (for example `/private/tmp`).
   Index structure (field definitions, not fabricated filing data):

   - `roster_source_url`: official HTTPS roster URL.
   - `roster`: array of `{official_key, official_name}` for all current legislators.
   - `filings`: array of `{official_key, official_name, year, filed_at, statement_type,
     amendment, filing_id, source_url, pdf_path}`. `filed_at` is ISO date/time;
     use a consistent timezone format. `filing_id` is the real portal identifier or
     null when unavailable. `pdf_path` is relative to the index file or absolute.
     `source_url` is the official public provenance URL (the portal root is allowed
     when no stable individual URL is provided).
   - Alternatively replace `pdf_path` with a direct public `pdf_url` copied from the
     official source. Only official California government hosts are accepted;
     redirects, ticket endpoints and HTML challenge responses stop acquisition.
     Signed portal export URLs should be downloaded normally and imported as files.

```bash
cd py/ingest
FORM700=true uv run python -m form700 plan --index /private/tmp/form700-index.json
FORM700=true uv run python -m form700 acquire --index /private/tmp/form700-index.json --out /private/tmp/form700-stage
# Set TOKENROUTER_KEY securely; set FORM700_MODEL to an account-enabled OpenAI-format model:
FORM700=true uv run python -m form700 extract --out /private/tmp/form700-stage --model "$FORM700_MODEL"
```

The plan reports roster entries with no indexed filings. “Indexed” means every
supplied roster member has metadata; it is not independent proof of portal
completeness. Missing officials and same-date latest ties require a human decision.

## Extraction and review

PDF text uses macOS's installed PDFKit through Swift, or an already installed
`pdftotext` on other systems. No package installation occurs. Scanned PDFs without
readable text stop for human OCR; PDFs over 20 MiB or text over 180,000 characters
stop for manual handling. Plain text cannot reliably represent checked boxes;
uncertain value ranges must be null and checked against the visual PDF by a human.

`manifest.json` preserves the original index hash, source URLs, file sizes and PDF
hashes. `pdf/` contains unchanged PDFs. `extractions/<evidence_id>/` contains pages,
the exact prompt/request, and raw model JSON. Completion must finish normally and
parse as JSON. Every business name must be inside an exact quote on the cited PDF
page; position/range text must also occur there. This checks textual support, not
semantic correctness, checkbox selections, ownership, completeness or identity.

`staged.json` contains `interest`-shaped fields (`official_entity`, `year`,
`business_entity`, `kind`, `value_range`, `filing_id`) plus public source provenance,
business label, position, schedule/page and evidence quote. All entity/filing UUIDs
remain null, every row is `unverified`, and `database_load_allowed` is false. Income
sources are A-2/C only; gifts, travel, loans and real property are excluded. Each
statement is staged separately; **do not sum originals and amendments**.

After a successful extraction, `review-ten.json` selects up to ten distinct latest
officials deterministically and leaves all human checks blank/false. It binds the
checklist to the staged file hash. Review the PDF with every target schedule and
model row side by side, including omissions and originals/amendments. Fill the
reviewer, date, checks and notes manually. Fewer than ten distinct officials sets
`enough_filings=false`. Regenerating review resets checkboxes; preserve completed
review artifacts separately. There is deliberately no load or automatic approval
command; ten human checks plus a separately authorized loader are future steps.

Run the focused tests explicitly (the parent project's default testpaths do not
include this scoped folder):

```bash
cd py/ingest
uv run python -m pytest form700/tests -q
```

Tests use a real cited PDF for text/page validation and a mocked HTTP response
containing only facts from that PDF. Mocked model output is never presented as a
live extraction or accuracy metric.
