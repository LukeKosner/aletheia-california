"""Compare staged votes with counts copied from the leginfo Bill Votes pages."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

import polars as pl


def _web_key(rc: dict) -> tuple[str, str, str]:
    d = datetime.strptime(rc["date"], "%m/%d/%y").date().isoformat()
    return d, rc["location"], rc["motion"]


def compare(votes: pl.DataFrame, web: dict) -> list[str]:
    """Return a list of differences (empty when every roll call matches exactly).

    For each bill: same number of roll calls; each website roll call (date,
    location, motion) pairs with one staged roll call with identical aye, no and
    NVR counts and identical member names in each group.
    """
    problems: list[str] = []
    for bill_id, page in web.items():
        if bill_id.startswith("_"):
            continue
        v = votes.filter(pl.col("source_bill_id") == bill_id)
        ours: dict[tuple[str, str, str], list[dict]] = {}
        for (_, _, _, _), g in v.group_by("location_code", "vote_date_time", "vote_date_seq", "motion_id"):
            r0 = g.row(0, named=True)
            key = (r0["vote_date"].isoformat(), r0["location"], r0["motion"])
            names = {res: sorted(g.filter(pl.col("result") == res)["raw_name"].to_list()) for res in ("aye", "no", "nvr")}
            ours.setdefault(key, []).append(names)
        n_ours = sum(len(x) for x in ours.values())
        if n_ours != len(page["rollcalls"]):
            problems.append(f"{bill_id}: {n_ours} roll calls staged, {len(page['rollcalls'])} on website")
        used: Counter = Counter()
        for rc in page["rollcalls"]:
            key = _web_key(rc)
            want = {"aye": sorted(rc["aye_names"]), "no": sorted(rc["no_names"]), "nvr": sorted(rc["nvr_names"])}
            if (rc["ayes"], rc["noes"], rc["nvr"]) != (len(want["aye"]), len(want["no"]), len(want["nvr"])):
                problems.append(f"{bill_id} {key}: website counts disagree with its own name lists")
            cands = ours.get(key, [])
            if want in cands and used[key] < cands.count(want):
                used[key] += 1
                continue
            got = [(len(c["aye"]), len(c["no"]), len(c["nvr"])) for c in cands]
            problems.append(f"{bill_id} {key}: website {rc['ayes']}-{rc['noes']}-{rc['nvr']}, staged {got or 'none'}")
    return problems


def load_web(path: Path) -> dict:
    return json.loads(path.read_text())
