# Private email sign-in and campus activity (P14)

Email sign-in stays closed by default. The team-password preview still works.
No live email, database connection, migration application, or deployment was used
while building this change. Public flags remain off.

## Setup for a human operator

1. Review `packages/db/drizzle/0002_mysterious_sir_ram.sql`, generated through
   `bun run db:generate` with a nonconnecting localhost placeholder URL. Apply it
   using the repository's human database process only after the current ingest
   finishes. Never run Better Auth's migration tool against this database.
2. Provision a non-owner `auth_server` login with only SELECT/INSERT/UPDATE/DELETE
   on `auth_user`, `auth_session`, `auth_account`, `auth_verification`, and
   `auth_rate_limit`. It needs no filing, investigation, claim, event, or schema
   privileges. Set `AUTH_DATABASE_URL` to this login, never `DATABASE_URL`.
3. Verify the sender domain in Resend. Set the verified plain email address in
   `AUTH_EMAIL_FROM`, `RESEND_API_KEY`, an explicit `BETTER_AUTH_URL` (HTTPS outside
   localhost), and a private random `BETTER_AUTH_SECRET` of at least 32 characters.
   Set `AUTH_TEAM_EMAILS` to the exact comma-separated allowed team addresses.
   No team addresses have been assumed. Do not use `ADMIN_EMAILS` as the signup
   allowlist; P15 requires a separate exact two-address admin allowlist.
4. Keep `PUBLIC_SITE=false`, `PUBLIC_SIGNUP=false`, `CAMPUS_GAME=false`, and
   `CARDS_PUBLIC=false`. Keep the existing `TEAM_PASSWORD` and
   `TEAM_SESSION_SECRET` configured. Once the schema/roles and verified sender
   are ready, set `AUTH_SENDER_VERIFIED=true` and `AUTH_EMAIL_ENABLED=true`.
5. A human can then test a permitted email through one-use, five-minute links,
   confirm second redemption fails, and confirm unlisted emails fail. No live
   send is authorized by this implementation task; sender verification and actual
   email/session smoke tests remain operator work.

Better Auth uses UUID IDs, hashed magic-link tokens, database rate limits,
httpOnly cookies, no password/social/public profile endpoints, and fresh server
session checks. The signup plugin permits first-time allowlisted team members;
the request and user-creation hooks enforce the same exact email policy. Email
session identity is rechecked against the current allowlist. The verified callback
can issue the existing private-preview cookie only to configured team emails.
That cookie remains preview access only; it never proves email or admin identity.
Changing/removing the team allowlist blocks identity actions immediately; preview
password cookies retain their existing shared-password lifetime.

`currentVerifiedIdentity()` in `src/lib/auth-session.ts` is the P15 integration:
`Promise<{ userId: string; email: string; emailVerified: true } | null>`. P15's
`currentAdminIdentity()` must delegate here when these dependent branches are
combined. Keep its separate exact `ADMIN_EMAILS` and private-preview gate.
No email addresses or admin assignments have been supplied by this task.

Campus is optional (`stanford`, `berkeley`, `neither`, or unset); it is selected on
`/account` after verified sign-in. `CAMPUS_LABELS` switches between campus names
and Cardinal/Bears labels. It never asserts school membership or email affiliation.

## Activity host integration

The plain server-only hooks in `src/lib/server-events.ts` are intentionally not
browser-callable or agent tools. Provision an `event_writer` login with INSERT
on `event` only and no read/update/delete grants. Provision a non-owner
`game_reader` login with SELECT only on `event`, `investigation`, `claim`, `card`,
and `correction`, with a read-only default and 10-second statement timeout.
Set the two dedicated URLs from `.env.example`; there is no owner/agent fallback.
All tool reads run in READ ONLY transactions with local statement timeouts.

- After the trusted P9 host persists a real investigation, call
  `recordInvestigationStarted(id)` in its authenticated request context.
- After P12 returns a final `verification_status: verified`, persist the exact
  supported claims and completed investigation, then call
  `recordInvestigationVerified(result)` from that same server request context.
  The hook compares every claim ID, sentence, supported verdict, confidence, evidence IDs and verifier model
  against the stored rows; pending/partial/failed/empty/mismatched output fails.
  P12 currently has no persisted host handoff. No recorded preview emits this event.
- After serving an actual approved receipt view (never prefetch/preview/error),
  the receipt host may call `recordCardViewed(cardId)`.
- `openShare` records only an actual compose-button click. It never claims a post
  was sent, never calls a social posting API, and awards no points.

The aggregate query counts distinct verified investigations from the trusted
verified event plus current supported claim rows, assigns each to its first
recorded campus, and counts actual card-view events. Unpublished reports and P15
append-only withdrawal/correction tombstones are excluded. No user roster or
email is returned. Missing credentials/query failure shows unavailable, not zero.
Successful empty reads produce zero counts. With `CAMPUS_GAME` on, `/game` refreshes
once a minute while visible; with it off, it does not query activity.

## Receipt sharing dependency

`src/lib/share.ts` prepares the exact Receipts/hashtag draft below 280 UTF-16
units and builds compose links for X, LinkedIn, Bluesky and Threads. LinkedIn's
share-offsite accepts only the URL, so its page explicitly instructs the user to
copy the displayed draft text into the composer. No posting credentials are used.

`src/lib/published-receipt.ts` deliberately resolves nothing yet. P13 currently
has only a recorded preview; it has no approved content/alias store. When that
store exists, connect this resolver to a read-only tools function that binds the
finding to supported claims, recorded human approval, and a real collision-checked
receipt alias, and invokes P15 `getPublicationState` including its append-only
tombstones. Missing state must stay closed. Do not replace the resolver with
`card.published` alone or synthesize a receipt alias. Until connected, `/share/[id]`
shows unavailable and card-view/share events cannot be written. This is an
explicit integration blocker, not a claim that public sharing is functional.
