import polars as pl
import pytest

from aletheia_resolve import normalize
from aletheia_resolve.cluster import LIKELY_LABEL, cluster


def _key(raw: pl.DataFrame, name: str) -> str:
    return raw.filter(pl.col("name") == name)["canonical_key"][0]


def _pairs(rows):
    return pl.DataFrame(rows, schema=["kind", "key_l", "key_r", "match_probability", "name_rule"], orient="row")


@pytest.fixture
def people(raw_sample):
    f = normalize.normalize_frame(raw_sample).filter(pl.col("kind") == "person")
    return f.select("canonical_key", "kind", "name", "first_name", "middle_name", "gen_suffix")


def test_no_chain_from_sr_to_jr(people) -> None:
    sr = _key(people, "Jacques S. Yeager Sr.")
    plain = _key(people, "JACQUES S YEAGER")
    jr = _key(people, "Jacques S. Yeager Jr.")
    pairs = _pairs(
        [
            ("person", *sorted([sr, plain]), 0.999, "ok"),
            ("person", *sorted([plain, jr]), 0.998, "ok"),  # plain - Jr also scores high...
        ]
    )
    members, likely = cluster(people, pairs, high=0.95, likely=0.80)
    ek = dict(members.select("canonical_key", "entity_key").iter_rows())
    assert ek[sr] == ek[plain]
    assert ek[jr] != ek[sr]  # ...but Jr never joins an entity that already holds a Sr
    assert likely["label"].to_list() == [LIKELY_LABEL]  # the refused merge is shown as likely


def test_thresholds_and_rules(people) -> None:
    a = _key(people, "John A. Sobrato")
    b = _key(people, "John Albert Sobrato")
    m1 = _key(people, "John M. Sobrato")
    pairs = _pairs(
        [
            ("person", *sorted([a, b]), 0.97, "ok"),  # high -> merged
            ("person", *sorted([a, m1]), 0.90, "ok"),  # likely -> linked, not merged
        ]
    )
    members, likely = cluster(people, pairs, high=0.95, likely=0.80)
    ek = dict(members.select("canonical_key", "entity_key").iter_rows())
    assert ek[a] == ek[b] == min(a, b)
    assert ek[m1] == m1
    assert likely.height == 1
    assert likely["match_probability"][0] == 0.90


def test_weak_and_conflict_names_never_merge(people) -> None:
    a = _key(people, "John A. Sobrato")
    m1 = _key(people, "John M. Sobrato")
    y = _key(people, "Mr. Jacques Yeager")
    pairs = _pairs([("person", *sorted([a, m1]), 0.99, "weak"), ("person", *sorted([a, y]), 0.99, "conflict")])
    members, likely = cluster(people, pairs, high=0.95, likely=0.80)
    assert members["cluster_size"].max() == 1
    assert likely.height == 1  # weak -> likely; conflict -> nothing


def test_refuses_cross_kind_merge(raw_sample) -> None:
    f = normalize.normalize_frame(raw_sample)
    person = _key(f, "John A. Sobrato")
    org = _key(f, "HAL ROBERTSON FARMS")
    with pytest.raises(ValueError, match="refusing to merge"):
        cluster(f.select("canonical_key", "kind"), _pairs([("person", *sorted([person, org]), 0.99, "ok")]), 0.95, 0.8)


def test_output_does_not_depend_on_row_order(people) -> None:
    keys = sorted(people["canonical_key"].to_list())
    rows = [("person", keys[i], keys[i + 1], 0.96 + i / 1000, "ok") for i in range(0, len(keys) - 1, 2)]
    pairs = _pairs(rows)
    m1, l1 = cluster(people, pairs, 0.95, 0.8)
    m2, l2 = cluster(people.reverse(), pairs.reverse(), 0.95, 0.8)
    assert m1.equals(m2)
    assert l1.equals(l2)
