#!/usr/bin/env bash
# One-time demo setup (human step: AGENTS.md says agents never write to the database or the live
# HarnessRouter workspace). Run from the repo root with the dev server running on :3001:
#
#   bash scripts/demo_setup.sh
#
# 1. Adds the new interview columns (migration 0007). No role or password change.
# 2. Deletes every existing interview and its research (cannot be undone).
# 3. Adds SAMPLE interviews and one SAMPLE study, labeled "Sample:" (step 2 removes them later).
# 4. Creates or updates the HarnessRouter harnesses, including "Aletheia ask", and saves the ask
#    harness id as HR_ASK_HARNESS_ID in apps/web/.env.local.
# 5. Sends one real question through the app's own /api/investigations route and prints the result.
#
# Keys are read from apps/web/.env.local and never printed. Skip steps with SKIP_DB=1 or SKIP_HR=1.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=apps/web/.env.local
MCP_URL="${ALETHEIA_MCP_URL:-https://aletheia.lukekosner.com/api/mcp}"
BASE="${APP_URL:-http://localhost:3001}"

if [ "${SKIP_DB:-0}" != 1 ]; then
  echo "== 1/5 Interview columns"
  (cd py/ingest && uv run python ../../scripts/provision_interview_db.py --migrate-only)
  echo "== 2/5 Clear old interviews"
  (cd py/ingest && uv run python ../../scripts/reset_interview_data.py --yes)
  echo "== 3/5 Sample interviews"
  (cd py/ingest && uv run python ../../scripts/seed_sample_interviews.py)
fi

if [ "${SKIP_HR:-0}" != 1 ]; then
  echo "== 4/5 HarnessRouter harnesses (MCP server: $MCP_URL)"
  # Read only the two keys the sync needs, without echoing them.
  HR_API_KEY="$(grep -E '^HR_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '"'"'")"
  MCP_BEARER_TOKEN="$(grep -E '^MCP_BEARER_TOKEN=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '"'"'")"
  [ -n "$HR_API_KEY" ] || { echo "HR_API_KEY is missing from $ENV"; exit 1; }
  [ -n "$MCP_BEARER_TOKEN" ] || { echo "MCP_BEARER_TOKEN is missing from $ENV"; exit 1; }
  HR_API_KEY="$HR_API_KEY" MCP_BEARER_TOKEN="$MCP_BEARER_TOKEN" ALETHEIA_MCP_URL="$MCP_URL" bun agents/sync-harnesses.ts
  ASK_ID="$(bun -e 'const h=(await Bun.file("agents/harnessrouter.json").json()).harnesses.find((x)=>x.feature==="ask"); console.log(h?.harness_id ?? "")')"
  [ -n "$ASK_ID" ] || { echo "No ask harness in agents/harnessrouter.json"; exit 1; }
  grep -v '^HR_ASK_HARNESS_ID=' "$ENV" > "$ENV.tmp" && mv "$ENV.tmp" "$ENV"
  echo "HR_ASK_HARNESS_ID=$ASK_ID" >> "$ENV"
  echo "Ask harness id: $ASK_ID (saved to $ENV; also add it to the Vercel env)"

  echo "== 5/5 One real question through the app (up to 4 minutes)"
  sleep 3 # let next dev reload .env.local
  # Prints the final event (result or error), or the JSON error if the request was refused.
  curl -sN --max-time 300 -w '\nHTTP %{http_code} in %{time_total}s\n' -X POST "$BASE/api/investigations" \
    -H "origin: $BASE" -H 'content-type: application/json' \
    -d '{"type":"general","question":"Who is funding Prop 40, and what does it do?"}' \
    | grep -v '^$' | tail -3 | cut -c1-600
fi
echo "Done."
