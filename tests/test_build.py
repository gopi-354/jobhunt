import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from build import merge, normalize, title_ok  # noqa: E402
from sources import relative_date  # noqa: E402

NOW = datetime(2026, 9, 18, tzinfo=timezone.utc)


def row(title, company="Acme", location="Bengaluru", source="greenhouse", src_id="1", url=None):
    return {"title": title, "company": company, "location": location, "source": source, "src_id": src_id,
            "url": url or f"https://x/{src_id}", "type": "fulltime", "posted_at": None, "pay": "", "desc": "d"}


def test_title_filter():
    assert title_ok("Data Scientist") and title_ok("Machine Learning Intern") and title_ok("AI Engineer - Fresher")
    assert not title_ok("Senior Data Scientist") and not title_ok("Data Science Manager") and not title_ok("Backend Engineer")
    assert not title_ok("Data Scientist (5+ years)") and not title_ok("ML Engineer, 3 years experience")


def test_normalize_filters_and_dedupes():
    rows = [row("Data Scientist"), row("Data Scientist", src_id="1"), row("Data Scientist", src_id="2", source="lever"),
            row("Data Analyst", location="Berlin", src_id="3"), row("Data Analyst", location="Berlin", source="linkedin", src_id="4"),
            row("Senior ML Engineer", src_id="5")]
    out = normalize(rows)
    assert [j["title"] for j in out] == ["Data Scientist", "Data Analyst"]
    assert out[0]["bangalore"] is True and out[1]["source"] == "linkedin"


def test_merge_keeps_first_seen_and_fit_and_drops_old():
    fresh = normalize([row("Data Scientist", src_id="1"), row("ML Intern", src_id="2")])
    prev = [{"id": fresh[0]["id"], "first_seen": "2026-09-01", "last_seen": "2026-09-17", "fit": {"score": 8, "reason": "r", "highlight": "h"}},
            {"id": "old", "first_seen": "2026-06-01", "last_seen": "2026-06-02"},
            {"id": "recent-missing", "first_seen": "2026-09-10", "last_seen": "2026-09-17", "title": "kept"}]
    merged = {j["id"]: j for j in merge(prev, fresh, NOW)}
    assert merged[fresh[0]["id"]]["first_seen"] == "2026-09-01" and merged[fresh[0]["id"]]["fit"]["score"] == 8
    assert merged[fresh[1]["id"]]["first_seen"] == "2026-09-18" and merged[fresh[1]["id"]]["fit"] is None
    assert "old" not in merged and "recent-missing" in merged


def test_relative_date():
    t = date(2026, 9, 18)
    assert relative_date("2 days ago", t) == "2026-09-16" and relative_date("Today", t) == "2026-09-18"
    assert relative_date("1 week ago", t) == "2026-09-11" and relative_date("", t) is None
