import polars as pl

from aletheia_resolve import labels


def test_filing_url() -> None:
    # RCPT_CD:1741305:0:A:23 is "Jacques Yeager Sr" in tests/fixtures/calaccess_raw_sample.csv
    assert (
        labels.filing_url("RCPT_CD:1741305:0:A:23")
        == "https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=1741305&amendid=0"
    )
    assert labels.filing_url(None) is None


def test_evaluate_weights_by_stratum() -> None:
    # 100 merged pairs at p=0.999 and 900 separate pairs; 2 labeled in each stratum.
    pairs = pl.DataFrame(
        {
            "kind": ["person"] * 1000,
            "key_l": [f"a{i:04d}" for i in range(1000)],
            "key_r": [f"b{i:04d}" for i in range(1000)],
            "match_probability": [0.999] * 100 + [0.5] * 900,
            "name_rule": ["ok"] * 1000,
        }
    )

    def row(i: int, label: str) -> dict[str, str]:
        # stratum / score in the CSV are ignored: the pair is re-scored from `pairs`
        return {"kind": "person", "left_key": f"a{i:04d}", "right_key": f"b{i:04d}", "label": label}

    rows = [
        row(0, "same"),  # merged (p = 0.999)
        row(1, "same"),  # merged
        row(500, "same"),  # separate (p = 0.5)
        row(501, "different"),  # separate
        row(502, ""),  # unlabeled rows are ignored
    ]
    e = labels.evaluate(rows, pairs, high=0.95, likely=0.8)["kinds"]["person"]
    t95 = next(t for t in e["thresholds"] if t["threshold"] == 0.95)
    assert t95["precision"] == 1.0
    # merged: 100 pairs all same; separate: 900 pairs, half same -> 450 missed
    assert abs(t95["recall"] - 100 / 550) < 1e-9
    assert e["recommended_high"] is None  # only 2 labels above: not enough to trust
