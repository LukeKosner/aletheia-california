# Investigation runtime (P9)

This is a private, **not yet live-accepted** integration. No harness has been provisioned by this change. No remote task or database operation was run during implementation. Keep `PUBLIC_SITE=off`, `FORM700=off` and `INVESTIGATIONS_RUNTIME_READY=0` until the setup below is complete. Tests are offline adapter tests, not the requested twelve end-to-end investigations.

## Product contract

`POST /api/investigations` accepts the exported `InvestigationInput` in `apps/web/src/app/api/investigations/contract.ts`:

- `question`: at most 2,000 characters; request body at most 8 KiB.
- `type`: `measure`, `bill`, `footprint`, `interests`, or `general`.
- `target`: `{entity_id: <UUID from v_entities>}`, or `{bill_id: "SB 329"}` for a bill. Omitted for `general`: the question alone goes to the scope check and then to the general harness (`instructions/general.md`, `HR_GENERAL_HARNESS_ID`), which selects at most a few public entities itself and names them in cited sentences. A stray target on a general request is dropped. SB 329 is a real bill: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB329.

The server validates entity kinds via `packages/tools`, rejects private-person targets, requires same-origin POST and an authenticated private team session, then performs a cheap TokenRouter scope classification. `FORM700` additionally gates interests. Neither the browser nor user-supplied JSON selects a harness, model, credentials, SQL, or investigation ID.

The response is named SSE events `progress`, `result`, `error`. `progress` contains only a fixed activity label, status, and investigation ID; raw runtime events, tool arguments and output deltas are never forwarded. `result` contains the typed answer, recorded claims and optional filing title/URL metadata hydrated through `getFiling` in `packages/tools`. `verification_status` is always `pending`: P12 must independently verify the evidence before a result is presented as verified or a card is published. Errors before streaming use `{error:{code,message}}` and an appropriate HTTP status. Errors after streaming use the `error` event with a saved investigation ID.

`GET /api/investigations/[id]` returns metadata while running and recovers the completed answer from the saved HarnessRouter response ID. The existing investigation table cannot store the answer JSON or session ID; no migration is made outside P9's scope. Thus retrieval depends on HarnessRouter retention. Completed answers are checked against this investigation's actual claim rows: exact text, nonempty evidence IDs, correct ownership. Summary must reuse a cited sentence; section/card headings are restricted labels, and the card references existing answer claim IDs. Citation existence does not establish support or a verdict.

The current sign-in is one shared private-team session, so task ownership is explicitly the shared team. There is no claim of per-person isolation or public tenancy. The narrow server lifecycle adapter uses `INVESTIGATION_DATABASE_URL`; it is never supplied to a harness, agent, browser, page, or arbitrary SQL tool. Only static investigation insert/update/select, claim select, and withdrawal metadata checks use it. Agent reads remain exclusively through `packages/tools`; `cite` remains P7's existing narrow claim writer.

Report GET and stream completion check `investigation.status` and P15's append-only `report_unpublished` / `correction_fixed` events (`props.investigationId`) before releasing content. Withdrawn GET returns HTTP 410 with an unpublished notice. Every lifecycle UPDATE has the same availability predicate, so recovery, completion and error handling cannot reset a withdrawal. Guard query failures release no answer. No public content endpoint should bypass this boundary.

Token totals combine reported extraction and HarnessRouter totals once; unreported totals are null, never zero. Cost is saved as null because the reviewed task response contract has token counts but no documented combined billed cost for the extraction call and harness session. No token-price estimate is labeled actual spend. Failed/incomplete task accounting and a supported billed-cost reconciliation endpoint are still acceptance blockers.

## Standing instructions and models

Compose `instructions/shared.md` with one of the six job files (`measure`, `bill`, `footprint`, `interests`, `general`, `ask`). `bun agents/sync-harnesses.ts` creates or updates all seven harnesses (scope plus six writers) and records them in `harnessrouter.json`. Every job except `ask` uses only Aletheia's five MCP tools (see the next section for `ask`). For those jobs no web access, browser, shell, files, extra MCP, plugins or memory are permitted. Hard runtime enforcement is a release condition, not something a prompt can promise.

## Ask agent (web + verified records)

`/ask` sends a general question (type `general`) through the scope check and then to the **Aletheia ask** harness (`instructions/shared.md` + `instructions/ask.md`). Ask checks Aletheia's records through the MCP tools first for money, lobbying, votes and measures, then uses the web for context, definitions and explanations, preferring official sources (leginfo, sos.ca.gov, CAL-ACCESS, LAO, county and city `.gov` sites). It keeps the base's built-in web search / web fetch tools; every other built-in tool (bash, files, edit, subagents, skills, workflow and so on) stays disabled. The sync script fails if the base offers no web tool.

Each answer sentence carries either a `claim_id` from `cite()` (shown as a numbered **verified record** linking to the filing) or a `source: {url, title}` (shown as a **web source** chip with its domain, not verified by Aletheia). The server accepts only public HTTPS web links, still applies the banned-phrase check, checks only claim sentences against recorded evidence, and lets the card hold only recorded claim IDs (an answer from web sources alone has an empty card). The scope check (`instructions/scope.md`) accepts California government, politics, policy, election and public-affairs questions and still rejects private-person, contact and address requests.

Ask has three abilities (`instructions/ask.md`): **research** (records first, then the web), **interview metrics** and **study drafting**.

- Interview metrics: `/api/mcp` also serves `interview_insights`, a read-only tool (SELECT through `completedSessions(…, {publicOnly: true})`; sponsored study interviews excluded) returning total interviews, top issues with counts and percents, counts by county, age range and party (`Not asked` left out) and up to 20 common voter questions (wrapped as `untrusted_text`), with optional `county`, `issue`, `party` filters. No emails, transcripts or ids. It answers only while `INTERVIEW_PREVIEW` is on. Sentences stating these figures are `{text, insight: true}` and render with an **Aletheia interviews** chip linking to `/interview/insights`; they never enter the card and are never passed to `cite`.
- Study drafting: the answer may carry an optional `study` object (`sponsor_kind`, `title`, `goal`, 1–6 `questions`, optional `fields.standard` from `PROFILE_FIELDS` and up to 3 `fields.custom`, optional `size` 20/50/100/250), validated by `parseStudyDraft` in `apps/web/src/lib/interview/study-draft.ts`. The UI shows a **Study draft** card whose button opens `/interview/studies/new?kind=…&draft=<base64url JSON>`; the builder re-validates and prefills the form, and a person adds the organization, reviews and submits. The agent never writes to the interview database.

MCP tools are not allowlisted per harness; every MCP harness reaches the same server, and only `ask.md` mentions `interview_insights`. After changing instructions, re-run the sync below so the ask harness and the scope check pick them up.

Until `HR_ASK_HARNESS_ID` is set, general questions keep using `HR_GENERAL_HARNESS_ID` (records only). To go live, a human with HarnessRouter admin access runs, from the repository root (it calls the live HarnessRouter API and updates every harness from the current instruction files, including the broadened scope check):

```sh
HR_API_KEY=... MCP_BEARER_TOKEN=... ALETHEIA_MCP_URL=https://<private host>/api/mcp bun agents/sync-harnesses.ts
```

Then copy the `harness_id` of the `ask` entry in `agents/harnessrouter.json` into `HR_ASK_HARNESS_ID` in `apps/web/.env.local` and in the Vercel project's environment variables, and redeploy. Unsetting `HR_ASK_HARNESS_ID` rolls back to the records-only general harness.

`models.json` names PaleBlueDot's TokenRouter, not similarly named `.io` or `.me` services. Sponsor documentation links/canonical model pages identify `tokenrouter.com`; its official setup guide specifies `https://api.tokenrouter.com/v1` and Chat Completions. The cheap scope model and strong writer model come from the sponsor's public model catalog and must still be checked against the account's live catalog before use. The writer runs through a configured HarnessRouter harness; this PR does not invent an undocumented HarnessRouter provider override.

Sources reviewed:

- Sponsor guide: https://tokenrouter.palebluedot.top/docs/tokenrouter-feature-guide/
- Cheap model: https://tokenrouter.palebluedot.top/models/openai/gpt-5.4-nano/
- Strong model: https://tokenrouter.palebluedot.top/models/openai/gpt-5.6-sol/
- Verified API host/format: https://www.tokenrouter.com/docs/zcode-setup/ and https://tokenrouter-backend-api.tokenrouter.com/docs/faq
- Harness management, hard versus instruction enforcement: https://harnessrouter.ai/docs/harnesses-api
- Runtime adapter reference: https://raw.githubusercontent.com/HarnessRouter/plugins/main/plugins/harnessrouter/skills/harnessrouter/references/api-reference.md and https://raw.githubusercontent.com/HarnessRouter/plugins/main/plugins/harnessrouter/skills/harnessrouter/references/runtime-integration.md
- SSE events: https://harnessrouter.ai/docs/streaming-events

HarnessRouter's public quickstart and maintained integration reference use `/v1/responses` with `metadata.harness_id`; the public “Run a task” page instead shows `/{harness_id}/v1/responses`. The adapter follows the maintained exact API reference. The deployed `/v1/uhp` discovery contract must be checked before live configuration; contract drift is a blocker, not a reason to silently try other endpoints with a key.

## Exact setup and checks still needed

All secrets go in the deployment's secure environment UI, never in chat, output or committed files. Names are in `agents/.env.example`. Do not retrieve database credentials as an agent. P7's bearer variable is **MCP_BEARER_TOKEN**, not MCP_TOKEN.

1. Deploy the private app and `/api/mcp`, preserving its bearer authentication and team sign-in. Confirm a missing token is refused. Finish P7's human role/grants setup and data ingestion before task tests. Keep model requests away from the owner/admin database credential.
2. Give the server an existing dedicated runtime connection as `INVESTIGATION_DATABASE_URL`. It needs `SELECT, INSERT, UPDATE` on `investigation`, `SELECT` on `claim`, and only column-level `SELECT (name, props)` on `event` for withdrawal checks. It needs no event write privilege or identity-table access. Defining a new database role belongs to a separately owned generated DB migration; P9 does not create roles or run grants. The database owner can grant an already-defined role using its actual name:

   ```sh
   psql "$DATABASE_URL" -v runtime_role="$ALETHEIA_EXISTING_RUNTIME_ROLE" <<'SQL'
   GRANT SELECT, INSERT, UPDATE ON investigation TO :"runtime_role";
   GRANT SELECT ON claim TO :"runtime_role";
   GRANT SELECT (name, props) ON event TO :"runtime_role";
   SQL
   ```

3. Using the human's authenticated HarnessRouter admin surface, first inspect `/v1/uhp`, `/v1/bases`, `/v1/models` and existing `/v1/harnesses`. Reuse matching named harnesses rather than creating duplicates. Choose a base that HARD-disables every built-in tool and permits only the five tools from this MCP server. Reject `enforcement: instruction`. Confirm plugins/skills/memory cannot expand capabilities. Store the deployed MCP bearer token with `PUT /v1/mcp-secrets/{name}`; keep only its returned reference in configuration. Review a real configuration readback.
4. **Unresolved provider setup:** establish the supported HarnessRouter mechanism for routing the strong writer through PaleBlueDot TokenRouter with the account's chosen model. The reviewed HarnessRouter contract does not document an external provider/base-URL override and reserves common provider environment names. Do not guess a new field or substitute HarnessRouter's own provider. Until supported routing is proven in provider usage logs, the runtime gate stays off.
5. After that review, set these non-secret shell variables to the actual catalog/configuration values: `HR_REVIEWED_BASE`, `HR_MCP_SECRET_REF`, `ALETHEIA_MCP_URL`, `HR_HARD_DISABLED_TOOLS` (JSON array of every built-in tool name from that base), and `P9_CONFIG_OUTPUT` (a private temporary folder). Prepare local JSON for review:

   ```sh
   bun agents/prepare-harnesses.ts
   ```

   This command does not call any API. The four payloads use documented HarnessRouter configuration fields, no embedded credential, no plugins, the stored MCP secret reference, and per-request investigation-header forwarding. Apply them only after the provider-routing and hard-enforcement blockers are resolved; read existing config first and preserve it for rollback. Do not `PUT` partial harness objects: the maintained API reference says omitted fields reset. Save returned IDs as `HR_MEASURE_HARNESS_ID`, `HR_BILL_HARNESS_ID`, `HR_FOOTPRINT_HARNESS_ID`, `HR_INTERESTS_HARNESS_ID` in the private deployment environment. No IDs are invented here.
6. Check the TokenRouter key's allowed models and Chat Completions behavior (including the completion limit) using a bounded request. Confirm extraction reports tokens and the strong writer appears in the intended TokenRouter usage log. Confirm actual cost reporting before replacing null cost with any amount.
7. Enable `INVESTIGATIONS_RUNTIME_READY=1` only after all preceding items succeed. `PUBLIC_SITE` stays off. Enable `FORM700` only after actual Form 700 data is present and P11's verification integration is ready. Run the twelve live acceptance questions in `acceptance.md` through the product's POST, then recover each through its GET. Reconcile claim IDs, filings, totals, neutral wording, every-member vote counts, tokens and actual spend; record evidence rather than assuming adapter tests prove it.

Offline checks:

```sh
bun test apps/web/src/app/api/investigations
bun run typecheck
bun run lint
bun run check:colors
bun run build
```

A server function is bounded to 300 seconds. A harness task is bounded by `task_limits` in `models.json`: 240 seconds and 100 steps for record investigations, 180 seconds and 30 steps for Ask (type `general`), so the 60-second scope check plus the task fits the route. `after()` keeps consumption alive after a browser disconnect within the host duration; it is not a durable worker. Reload GET to recover a stored response after timeout/interruption; do not submit a duplicate task. A process crash before `response.created` is saved still requires operator reconciliation by the idempotency key (the investigation UUID).
