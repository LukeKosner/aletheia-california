# Aletheia

> [!WARNING]
> **Private use only.** This is a research prototype shared for review. It is not a public service, not legal or voting advice, and not licensed for reuse or redistribution. Answers come from public records and can be incomplete, amended or late. Please do not deploy it publicly or present its output as authoritative.

Aletheia connects Californians with their government by researching public records, listening to voters, and running studies.

## What it does

**Researching public records.** Ask a question in plain English, like "Who is funding Prop 40, and what does it do?" An agent searches California public records and writes an answer in which every sentence cites the filing it comes from. A separate verifier agent checks each sentence against that filing. Background from the web, which prefers official sources, is labeled as a web source. Legislator and ballot measure pages show contributions, independent spending, roll-call votes and lobbying. Research is free.

**Listening to voters.** Any Californian can talk with an AI voice interviewer for about ten minutes about what matters to them. Interviews are summarized in neutral language and published as public insights by place and topic, without names, emails or addresses. Questions voters raise during an interview are looked up in public records for free.

**Running studies.** Businesses, campaigns, nonprofits and government offices can run their own studies, which are interviews with Californians on a topic they choose. They describe what they want to learn, Aletheia drafts the interview, and they get summarized results. Study results go to the sponsor and are not counted in the public insights. Studies are the paid product (monthly or single-study pricing), and they fund the free research and public interviews.

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
