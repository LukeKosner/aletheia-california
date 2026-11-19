# Names below are copied from CAL-ACCESS filings; see tests/fixtures/README.md for filing ids.
from aletheia_resolve import normalize as n


def test_person_name_strips_titles_and_suffixes() -> None:
    # RCPT_CD:1462900 line 123
    p = n.person_name("Mr. Jacques S. Yeager, Sr.")
    assert (p.first, p.middle, p.last, p.suffix) == ("JACQUES", "S", "YEAGER", "SR")
    # RCPT_CD:1146697 line 138
    assert n.person_name("Mr. Jacques S. Yeager, Jr.").suffix == "JR"


def test_suffix_typed_in_the_middle() -> None:
    p = n.person_name("Charles T. Jr. Munger")
    assert (p.first, p.middle, p.last, p.suffix) == ("CHARLES", "T", "MUNGER", "JR")


def test_joint_names_are_not_resolvable() -> None:
    assert n.person_name("MICHAEL AND ELISA LEVY").last is None  # RCPT_CD:2015818 line 2064
    assert n.person_name("John & Abby Sobrato").last is None  # RCPT_CD:1028018 line 259


def test_placeholders() -> None:
    assert n.person_name("(no name given)").last is None
    assert n.employer("N/A") is None
    assert n.occupation("Information Requested") is None


def test_org_name_strips_legal_forms() -> None:
    assert n.org_name("Hal Robertson Farms LLC") == n.org_name("HAL ROBERTSON FARMS") == "HAL ROBERTSON FARMS"
    assert n.org_name("The Wine Group Inc.") == "WINE GROUP"
    assert n.org_name("A. Teichert & Son, Incorporated") == "A TEICHERT AND SON"
    assert n.org_name("Hal Robertson Farms L.L.C.") == "HAL ROBERTSON FARMS"


def test_zip() -> None:
    assert n.zip5("92507-6807") == "92507"
    assert n.zip3("92507-6807") == "925"
    assert n.zip5("925") is None


def test_normalize_frame_marks_unresolvable(raw_sample) -> None:
    f = n.normalize_frame(raw_sample)
    unresolvable = set(f.filter(~f["resolvable"])["name"].to_list())
    assert "MICHAEL AND ELISA LEVY" in unresolvable
    assert "John & Abby Sobrato" in unresolvable
    assert any(name.startswith("San Leandro Chamber") for name in unresolvable)  # committee


def test_title_gender() -> None:
    assert n.person_name("Mr. Jacques S. Yeager").title_gender == "M"  # RCPT_CD:1305918 line 66
    assert n.person_name("Mrs. Mary Adams O'Connell").title_gender == "F"
    assert n.person_name("Dr. Toai Nguyen").title_gender is None
