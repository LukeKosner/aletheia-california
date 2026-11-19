# P15 private correction workflow

This branch integrates the merged P9, P10 and P14 foundations. `PUBLIC_SITE` remains off. It does
not provision roles, apply schema, connect to a database during agent work, send
email, merge a PR, or deploy.

## Required setup before stored submissions

- `ADMIN_EMAILS` must contain exactly two distinct administrator email addresses.
  Missing, duplicate, malformed, or extra addresses close the gate.
- `currentAdminIdentity()` in `app/api/admin/auth.ts` now delegates directly to
  P14's `currentVerifiedIdentity()` from `@/lib/auth-session`. It checks a fresh
  Better Auth server session, verified email, current team allowlist and expiry.
  Incomplete verified sender/auth configuration still returns `null`.
  A shared team password, cookie, URL parameter, or email header is insufficient.
  The admin layout, queue read, and every admin command independently check access.
- A reviewed schema/role migration and human provisioning are required for the
  separately named `corrections_reader` and `corrections_writer` roles. No role,
  grant, migration, or database change is included or executed in this branch.
- `CORRECTIONS_READER_DATABASE_URL` must authenticate as `corrections_reader`.
  Reads live in `packages/tools/src/corrections.ts`, use READ ONLY transactions,
  and have a ten-second statement timeout. This surface is product-only and is
  never registered as an agent MCP tool. It needs SELECT for the narrow fields
  queried on `correction`, `card`, `investigation`, `event`, `filing`, `money_edge`.
- `CORRECTIONS_WRITER_DATABASE_URL` must authenticate as `corrections_writer`.
  Never reuse the database owner, `agent_ro`, `claim_writer`, or general
  `DATABASE_URL`. Grant only the columns needed by the explicit commands:
  INSERT/RETURNING on feedback and correction, SELECT on linked correction/card/
  investigation/claim identifiers, UPDATE correction status/resolution, UPDATE
  card published, UPDATE investigation status, UPDATE claim sentence/evidence/
  confidence/verdict/verifier model, and INSERT on event. Preserve row grants
  where possible. An operator must review the grants before enabling the role.
- The existing table schema is sufficient for command storage. Correction
  request JSON fits `correction.request`; public resolution JSON fits
  `correction.resolution`; both use only existing open/fixed/rejected statuses.
  No fake rows or invented stored receipts are used.

Without these dependencies, routes return 401/403/503 and retain form text.
A successful submission receipt is returned only after the insert completes.
Email is not connected. In this private preview only, a saved correction logs
its identifier and both configured admin recipients; it never logs request text.
The response explicitly says email was not sent. Resend setup is a separate task.

## Review and withdrawal semantics

A rejection requires a written reason and leaves claim/publication unchanged.
A fix requires a specific claim belonging to the correction card's investigation,
a revised sentence, and the complete supporting filing/edge UUID set. The read
adapter checks that all evidence exists, filing URLs exist, and every money edge
belongs to a supplied filing. These checks confirm evidence identity, not the
truth of the revised prose; P12 must verify that separately.

One transaction locks the open request, updates only the specified linked claim,
clears confidence/verdict/verifier model, marks the request fixed, unpublishes
EVERY card for the report, sets the report status to unpublished, and writes an
audit event. A second reviewer cannot resolve a closed request. Reject/fix do not
mark any report verified. No republish operation exists.

The kill switch withdraws all cards and the report in one transaction and records
a reason in an audit event. `report_unpublished` and `correction_fixed` events
contain `props.investigationId`. Read adapters treat them as durable withdrawal
tombstones so a finishing P9 run cannot revive content by overwriting status.
Republication needs a future reviewed policy for retiring these tombstones.

The saved investigation answer and map show a notice at their existing links
when withdrawn, missing, or the lookup is unavailable. They check on load,
returning to the tab, and every 30 seconds while visible. This client guard is
not an API authorization boundary and does not remove previously downloaded
content. The clearly named P10 recorded preview has no saved card/report and is
exempt from stored publication lookups.

## Integrated server boundary and remaining receipt work

- P9's merged server GET/output routes independently enforce the same unpublished
  status and `report_unpublished` / `correction_fixed` tombstones before runtime
  recovery and content release. GET returns a safe HTTP 410 notice after withdrawal;
  stream completion suppresses the result. Lifecycle UPDATE predicates prevent
  recovery/completion/error handling from overwriting withdrawal. Guard query
  failures fail closed. The runtime role needs column-level `SELECT (name, props)`
  on `event`; the human-only grant instructions are in `agents/README.md`.
  A fixed claim does not mutate P9's already-stored remote response. Revised
  answers must be rebuilt from saved claims and verified before future sharing.
- P13 currently provides only a recorded preview with approval disabled. Future
  persisted receipt, shortlink, image/export, and metadata routes must independently
  call `getPublicationState()` and suppress content unless it returns published.
  Missing or failed lookups must not be treated as publication approval.
- `getReportAvailability()` permits a private report with no receipt cards;
  it is NOT public sharing approval. `getPublicationState()` additionally
  checks card.published. Never substitute one for the other in public routes.
- Receipt correction links use `/corrections?card=<actual saved card UUID>`.
  Recorded previews link to `/corrections` without a fabricated card identifier.
- `getCorrectionChangelog()` returns only fixed/rejected public resolution fields.
  It excludes request text and requester/admin identity. The correction page and
  private API show this history; P13 should add it to saved receipt pages later.

## Verification limits

Unit tests cover private/admin authorization, same-origin mutation checks,
streamed body bounds, saved-record validation, fix/reject/unpublish requirements,
and malformed public resolutions. No database integration test or live successful
write was run: least-privilege roles and verified email auth are not provisioned.
