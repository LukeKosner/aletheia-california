import copy
import hashlib
import json
from pathlib import Path

import httpx
import pytest

from form700 import pipeline as p

FIXTURES = Path(__file__).parent / "fixtures"
SOURCE = json.loads((FIXTURES / "perez-source.json").read_text())


@pytest.fixture(autouse=True)
def opt_in(monkeypatch):
    monkeypatch.setenv("FORM700", "true")


@pytest.fixture
def index():
    # Actual filed statement: City Council file 26-1200-S13, SAN
    # 011300006-STH-0006, https://cityclerk.lacity.org/onlinedocs/2026/26-1200-s13_misc_3-24-26.pdf
    return {"roster_source_url": SOURCE["source_url"],
            "roster": [{"official_key": SOURCE["source_filing_id"], "official_name": "John Perez"}],
            "filings": [{"official_key": SOURCE["source_filing_id"], "official_name": "John Perez",
                         "year": 2026, "filed_at": "2026-03-24T10:15:00",
                         "statement_type": "Pre-confirmation", "filing_id": SOURCE["source_filing_id"],
                         "source_url": SOURCE["source_url"], "pdf_path": str(FIXTURES / "perez.pdf")}]}


def test_off_by_default_prevents_io(monkeypatch, tmp_path):
    monkeypatch.delenv("FORM700", raising=False)
    with pytest.raises(ValueError, match="off"):
        p.acquire(tmp_path / "does-not-exist", tmp_path / "output")
    with pytest.raises(ValueError, match="off"):
        p.extract(tmp_path, "openai/gpt-5.4-mini")
    assert not (tmp_path / "output").exists()


def test_real_pdf_hash_and_acquire(index, tmp_path):
    raw = (FIXTURES / "perez.pdf").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SOURCE["sha256"]
    ip = tmp_path / "index.json"
    ip.write_text(json.dumps(index))
    manifest = p.acquire(ip, tmp_path / "out")
    assert manifest["filings"][0]["pdf_sha256"] == SOURCE["sha256"]
    assert (tmp_path / "out" / manifest["filings"][0]["pdf_file"]).read_bytes() == raw


def test_incomplete_roster_is_explicit(index):
    # Observed in the cited FPPC portal annual search; not a fabricated official.
    index["roster"].append({"official_key": "Mike Gipson", "official_name": "Mike Gipson"})
    result = p.plan(index)
    assert result["status"] == "incomplete"
    assert result["missing_officials"] == ["Mike Gipson"]


def test_ambiguous_latest_fails(index):
    other = copy.deepcopy(index["filings"][0])
    other["pdf_path"] = "perez.pdf"
    index["filings"].append(other)
    with pytest.raises(ValueError, match="ambiguous"):
        p.plan(index)


@pytest.mark.parametrize("url", ["http://form700search.fppc.ca.gov/", "https://example.com/file.pdf",
    "https://form700search.fppc.ca.gov/Home/SearchTicket", "https://user:pass@www.fppc.ca.gov/file"])
def test_access_boundaries(url):
    with pytest.raises(ValueError): p.public_url(url)


def test_html_challenge_rejected(index, tmp_path):
    index["filings"][0].pop("pdf_path")
    index["filings"][0]["pdf_url"] = SOURCE["source_url"]
    ip = tmp_path / "index.json"
    ip.write_text(json.dumps(index))
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text="<html>Access challenge</html>")))
    with pytest.raises(ValueError, match="Not a PDF"):
        p.acquire(ip, tmp_path / "out", client)
    assert not (tmp_path / "out" / "manifest.json").exists()


@pytest.fixture(scope="module")
def pages():
    # Extract from the preserved primary-source PDF, not generated mock filing text.
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("FORM700", "true")
        return p.pdf_pages(FIXTURES / "perez.pdf")


def real_interest(pages):
    # Schedule A-2, PDF page 3: Double Nickel Advisors, LLC; Principal.
    return {"kind": "business_position", "business_name": "Double Nickel Advisors, LLC",
            "value_range": None, "position": "Principal", "schedule": "A-2", "page": 3,
            "evidence_quote": "Double Nickel Advisors, LLC"}


def test_real_pdf_page_citations(pages):
    assert len(pages) == 8
    assert "CIM Group" in pages[4]
    row = real_interest(pages)
    assert p.validate({"interests": [row], "warnings": []}, pages) == [row]
    row["page"] = 1
    with pytest.raises(ValueError, match="absent"):
        p.validate({"interests": [row], "warnings": []}, pages)


def test_stages_real_cited_record_and_requires_ten(index, pages, tmp_path, monkeypatch):
    monkeypatch.setenv("TOKENROUTER_KEY", "test-key-not-a-secret")
    monkeypatch.setattr(p, "pdf_pages", lambda path: pages)
    ip = tmp_path / "index.json"
    ip.write_text(json.dumps(index))
    out = tmp_path / "out"
    p.acquire(ip, out)
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"model": "openai/gpt-5.4-mini", "choices": [{
            "finish_reason": "stop", "message": {"content": json.dumps({
                "interests": [real_interest(pages)], "warnings": []})}}]})
    staged = p.extract(out, "openai/gpt-5.4-mini", httpx.Client(transport=httpx.MockTransport(respond)))
    assert str(calls[0].url) == "https://api.tokenrouter.com/v1/chat/completions"
    assert staged["database_load_allowed"] is False
    assert staged["interests"][0]["official_entity"] is None
    assert staged["interests"][0]["filing_id"] is None
    review = json.loads((out / "review-ten.json").read_text())
    assert review["enough_filings"] is False
    assert review["items"][0]["reviewer"] == ""
    assert not any(review["items"][0]["checks"].values())
    assert "test-key" not in "".join(x.read_text() for x in out.rglob("*.json"))


def test_missing_key_stops_before_pdf_reads(monkeypatch, tmp_path):
    monkeypatch.delenv("TOKENROUTER_KEY", raising=False)
    monkeypatch.delenv("TOKENROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError, match="TOKENROUTER"):
        p.extract(tmp_path, "openai/gpt-5.4-mini")


def test_no_guessed_tokenrouter_endpoint(monkeypatch):
    assert p.tokenrouter_url() == "https://api.tokenrouter.com/v1/chat/completions"


def test_partial_extraction_cannot_be_reviewed(tmp_path):
    p.write_json(tmp_path / "manifest.json", {})
    p.write_json(tmp_path / "staged.json", {"status": "extracting", "database_load_allowed": False})
    with pytest.raises(ValueError, match="No complete"):
        p.review(tmp_path)
