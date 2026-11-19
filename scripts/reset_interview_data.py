"""Deletes every voter interview so insights start fresh (human step, AGENTS.md "Dev database").

Run from py/ingest so psycopg is available:

    cd py/ingest && uv run python ../../scripts/reset_interview_data.py          # shows counts only
    cd py/ingest && uv run python ../../scripts/reset_interview_data.py --yes    # deletes
    cd py/ingest && uv run python ../../scripts/reset_interview_data.py --yes --all  # also every study and payment record

Deletes, in one transaction, as the database owner from packages/db/.env:
  - every row in interview.research (voter and weekly research runs)
  - every row in interview.session (interviews, transcripts, answers)
  - the "Interview reward" rows in interview.payout that are still owed
  - studies whose title starts with "Sample:" (from seed_sample_interviews.py)
Keeps other studies, Stripe test payments and payouts that were actually sent, unless --all is given: then every
study (business and government), every payment record and every payout record is deleted too. Stripe's own test-mode
history is not touched. Touches nothing outside the
`interview` schema. This cannot be undone.
"""

import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
REWARDS = "note = 'Interview reward' and status = 'owed'"


def owner_url() -> str:
    for line in (ROOT / "packages/db/.env").read_text().splitlines():
        key, _, value = line.strip().removeprefix("export ").partition("=")
        if key == "DATABASE_URL_UNPOOLED":
            return value.strip().strip('"').strip("'")
    raise SystemExit("DATABASE_URL_UNPOOLED is missing from packages/db/.env")


def main() -> None:
    confirm = "--yes" in sys.argv[1:]
    everything = "--all" in sys.argv[1:]
    with psycopg.connect(owner_url()) as conn:
        cur = conn.cursor()
        counts = {}
        for label, query in [
            ("research runs", "select count(*) from interview.research"),
            ("interviews", "select count(*) from interview.session"),
            ("owed rewards", f"select count(*) from interview.payout where {REWARDS}"),
            ("sample studies", "select count(*) from interview.study where title like 'Sample:%'"),
            *([("all studies", "select count(*) from interview.study"),
               ("payment records", "select count(*) from interview.payment"),
               ("payout records", "select count(*) from interview.payout")] if everything else []),
        ]:
            cur.execute(query)
            counts[label] = cur.fetchone()[0]
        print(", ".join(f"{n} {label}" for label, n in counts.items()))
        if not confirm:
            print("Nothing deleted. Re-run with --yes to delete these rows.")
            return
        cur.execute("delete from interview.research")
        cur.execute("delete from interview.session")
        cur.execute(f"delete from interview.payout where {REWARDS}")
        cur.execute("delete from interview.study where title like 'Sample:%'")
        if everything:
            cur.execute("delete from interview.payment")
            cur.execute("delete from interview.payout")
            cur.execute("delete from interview.study")
        conn.commit()
        print("Deleted. Insights now start from zero.")


if __name__ == "__main__":
    main()
