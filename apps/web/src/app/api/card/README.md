# Receipt card integration boundary

This implementation exposes only the committed P10 recorded filing as a team preview.
`recorded-calaccess-3214397` is a preview identifier, not a card row or claim id.
`/c/321439` is an explicit local preview alias, not a generated public short link.
No mutation endpoint, approval, persistence, public export, or completed verifier run is implied.
`CARDS_PUBLIC` defaults off and cannot make the recorded preview publishable.

All four card types use the same renderer and bounded evidence model. Only organization
footprint has a source-backed preview. Other types need their own real corresponding evidence.
The finding is at most 90 Unicode code points. One to five labeled numbers recompute from
unique edge receipts using integer cents. These are sums of the cited lines only, not complete
campaign totals. No individual donor detail is rendered in the recorded preview.

Before public cards are implemented, connect these server-owned boundaries:

1. Load immutable card/claim/receipt records through read-only tools, never caller-supplied
   JSON, arbitrary SQL, or a database client in a page. The current tools do not expose them.
2. Consume P12 `verifyInvestigation` output from the trusted server call:
   `result.verification_status` is `verified`, `partial`, or `failed`; filtered claims have
   supported verdicts; audit and removed claim ids are separate. Bind every displayed finding
   and number to its exact supported sentence and receipt set. A status string from a browser
   is insufficient. Partial investigations may export only their supported claims.
3. Record authenticated human approval with reviewer identity and narrow role enforcement,
   bound to the exact content/evidence/method version. A shared team cookie is sufficient
   for preview access, not approval authority. No reviewer role currently exists in this scope.
4. Require `CARDS_PUBLIC`, recorded approval, `card.published`, and P15
   `getPublicationState(reader, {cardId})` to be `published`. Missing or unavailable state
   must suppress every public image, receipt and alias. P15 also marks the parent
   investigation unpublished and unpublishes associated cards atomically. Its read gate
   also honors append-only `report_unpublished` / `correction_fixed` event tombstones
   for the investigation so an in-flight generation cannot restore publication. Never
   replace that lookup with `card.published` alone.
5. Use P15 `getCorrectionChangelog(reader, cardId)` for fixed/rejected public reasons,
   never requester text. Do not infer an empty history when the reader is unavailable.
6. Allocate collision-checked six-character aliases in persistent storage, resolve only
   those approved card ids, and invalidate public caches when publication is revoked.

The current schema has only a basic card row; approval identities, image-version binding,
alias allocation and a server-validated writer role need a separate authorized schema/tools
task. This branch makes no database access or writes. Public controls remain disabled.

QR encoding is local QR Model 2 version 5-L, byte mode with mask zero, capped at 106 bytes.
Long receipt URLs fail closed. The image renderer includes a four-module quiet zone.
The wide and tall PNGs were independently decoded with macOS Vision to their exact receipt URL.
Theme colors are read from `globals.css` tokens and converted for the OG renderer, which
cannot resolve CSS variables or oklch directly.
