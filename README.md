# Aletheia

> [!WARNING]
> **Private use only.** This is a research prototype shared for review. It is not a public service, not legal or voting advice, and not licensed for reuse or redistribution. Answers come from public records and can be incomplete, amended or late. Please do not deploy it publicly or present its output as authoritative.

Ask who funds and influences the people and measures on your California ballot. Get a cited, verified answer and a shareable card.

## What it does

- **Ask a question** in plain English ("Who is funding Prop 40, and what does it do?"). An agent looks it up in California public records and writes an answer. Every sentence cites the filing it comes from.
- **Verify.** A separate verifier checks each cited sentence against its filing. Sentences from web sources are labeled as web sources.
- **Browse** legislator and ballot measure pages: contributions, independent spending, roll-call votes and lobbying.
- **Voter interviews.** Voters talk with an AI interviewer for about ten minutes. Answers are summarized in neutral language, without names or contact details.

## Data sources

CAL-ACCESS campaign and lobbying filings (California Secretary of State), bill and roll-call vote data from the California Legislature, and Form 700 statements of economic interests. See [`data/sources.md`](data/sources.md).

## How it is built

| Path | What |
| --- | --- |
| `apps/web` | Next.js App Router app (TypeScript, Tailwind, shadcn/ui) |
| `packages/db` | Drizzle schema and migrations (Postgres) |
| `packages/tools` | Read-only data tools the agents use |
| `packages/verify` | Claim verifier |
| `agents` | Agent harness definitions and instructions |
| `py/ingest`, `py/resolve` | Python ingest of public filings and entity resolution |

## Run locally

```bash
bun install
cp apps/web/.env.example apps/web/.env.local   # fill in your own values
bun run dev                                    # http://localhost:3001
```

Contributors: read [AGENTS.md](AGENTS.md) first.
