# AGENTS.md

Aletheia lets any Californian ask who funds and influences the people and measures on their ballot, and get a cited, verified answer plus a shareable card.

Many agents work on this repo in parallel. These rules apply to every agent and every human.

## Rules

1. **One task, one branch, one PR.** Work only on your assigned task, on your own branch. One task per branch. When done, open a PR.
2. **Stay in your folders.** Touch only the folders your task names. Schema changes only through `drizzle-kit generate` (`bun run db:generate`): edit `packages/db/src/schema.ts`, generate, commit the migration. Never hand-edit migrations or alter the database directly.
3. **Never invent data.** Every number, name and example in code, tests and mocks comes from a real public filing. Cite the source (filing id, URL) next to fixture data.
4. **Read-only data access for agents and pages.** Agents read data only through `packages/tools` (built later). Never give an agent or a page write access to the database.
5. **Colors only from theme tokens** (`apps/web/src/app/globals.css`, used through Tailwind classes such as `bg-background`, `text-muted-foreground`). No raw hex or `rgb(` in `apps/web/src`; CI checks this.
6. **No new dependency without asking.**
7. **Nothing public.** Keep `PUBLIC_SITE` off.
8. **Every PR adds one build log entry**: `buildlog/YYYY-MM-DD-HHMM-slug.mdx` with frontmatter `date`, `author`, `reviewer` (leave blank), `task`, and sections **Shipped**, **Metric**, **Broke or learned**, **Evidence**. See `buildlog/` for examples.
9. **If unsure, or a step needs a human, stop and ask.**
10. **Neutral language.** Describe facts, never motive. Banned words and phrases: bought, paid off, corrupt, in the pocket of, bribe, kickback, rigged, puppet.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js App Router app (TypeScript strict, Tailwind 4, shadcn/ui, AI Elements) |
| `packages/db` | Drizzle schema, migrations and client (Postgres) |
| `packages/tools` | Read-only data tools for agents and pages (not built yet) |
| `py/ingest` | Python 3.12 ingest of public filings (polars, duckdb, httpx, psycopg) |
| `py/resolve` | Python 3.12 entity resolution (splink, polars, psycopg) |
| `buildlog` | One `.mdx` entry per PR |
| `scripts` | Repo checks (e.g. raw color check) |

## Commands

```bash
bun install                 # JS deps for all workspaces
bun run dev                 # web app on http://localhost:3001 (PORT overrides)
bun run lint                # eslint
bun run typecheck           # tsc in every workspace
bun test                    # bun tests
bun run check:colors        # fail on raw hex / rgb( in apps/web/src
bun run db:generate         # drizzle-kit generate (after schema edits)
bun run db:push             # drizzle-kit push (dev database only; needs DATABASE_URL)
(cd py/ingest && uv run pytest)
(cd py/resolve && uv run pytest)
```

Feature flags live in `apps/web/src/lib/flags.ts` and read env vars. All default off except `SHOW_INDIVIDUAL_DONORS`.

## Dev database

Postgres is a free Neon database (`aletheia-dev`) provisioned through the Vercel Marketplace and connected to the Vercel project `aletheia-investigations` (no Git connection, no deploys). To get credentials (humans only):

```bash
cd apps/web && vercel link --yes --project aletheia-investigations --scope luke-kosners-projects
vercel env pull ../../packages/db/.env --environment development --yes
```

`drizzle-kit push` prompts for confirmation; run it in a real terminal. Agents never push schema or write to the database.

Secrets never go in the repo. Only `.env.example` files are committed.
