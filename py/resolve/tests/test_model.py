"""Scores real records with the committed models (no training, runs in seconds)."""

import polars as pl

from aletheia_resolve import model, normalize
from aletheia_resolve.cluster import cluster


def test_committed_models_on_real_records(raw_sample) -> None:
    f = normalize.normalize_frame(raw_sample)
    people = model.predict(f, "person", floor=0.0)
    orgs = model.predict(f, "org", floor=0.0)

    def rule(a: str, b: str) -> str:
        ka = f.filter(pl.col("name") == a)["canonical_key"][0]
        kb = f.filter(pl.col("name") == b)["canonical_key"][0]
        l, r = sorted([ka, kb])
        return people.filter((pl.col("key_l") == l) & (pl.col("key_r") == r))["name_rule"][0]

    assert rule("Jacques S. Yeager Sr.", "Jacques S. Yeager Jr.") == "conflict"
    assert rule("Jacques S. Yeager Sr.", "Mr. Jacques S. Yeager") == "ok"
    # John A. (Atherton, ZIP3 940) and John M. (Los Gatos, ZIP3 950): different blocks, never compared.
    a = f.filter(pl.col("name") == "John A. Sobrato")["canonical_key"][0]
    m = f.filter(pl.col("name") == "John Michael Sobrato")["canonical_key"][0]
    l, r = sorted([a, m])
    assert people.filter((pl.col("key_l") == l) & (pl.col("key_r") == r)).height == 0

    ents = f.filter(pl.col("kind") == "person").select("canonical_key", "kind", "first_name", "middle_name", "gen_suffix")
    members, _ = cluster(ents, people, high=0.95, likely=0.80)
    by_name = members.join(f.select("canonical_key", "name"), on="canonical_key")
    ek = dict(by_name.select("name", "entity_key").iter_rows())
    assert ek["Jacques S. Yeager Sr."] != ek["Jacques S. Yeager Jr."]
    assert ek["John A. Sobrato"] != ek["John M. Sobrato"]

    # Hal Robertson Farms LLC / HAL ROBERTSON FARMS: same normalized name, so the pair is compared. Its score is
    # not checked here: term-frequency weights come from the input, and in a 25-row sample that name is the
    # most common one. On the full export the pair scores 0.9865 (data/manual/labels.csv).
    assert orgs.height == 1
