"""Local (city and county) campaign finance ingest.

Everything here stays behind the LOCAL_FILERS flag: the CLI refuses to run unless
LOCAL_FILERS is on, and every row is tagged with a local `filing.source`
(for example `datasf:sfo`) so the app can hide local data while the flag is off.

Street addresses are redacted by law in local filings. No adapter requests,
stores or tries to restore them; the canonical CAL record has no address column.
"""
