"""Job sources. Every fetcher is best-effort: returns [] on failure and logs why. Rows are normalized dicts:
title, company, location, url, source, type ("internship"|"fulltime"|"unknown"), posted_at (ISO date|None),
pay (str), desc (str, plain text, may be empty), src_id (stable id within source).
"""
from __future__ import annotations

import asyncio
import html
import os
import re
import time
from datetime import date, datetime, timedelta, timezone

import httpx
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      "Accept-Language": "en-IN,en;q=0.9"}
TIMEOUT = 40


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


def _text(s: str | None) -> str:
    s = html.unescape(s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _row(**kw) -> dict:
    base = {"title": "", "company": "", "location": "", "url": "", "source": "", "type": "unknown",
            "posted_at": None, "pay": "", "desc": "", "src_id": ""}
    base.update({k: (v.strip() if isinstance(v, str) else v) for k, v in kw.items()})
    base["desc"] = base["desc"][:2500]
    return base


def _date(v) -> str | None:
    """Anything → 'YYYY-MM-DD' or None."""
    if not v:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, tz=timezone.utc).date().isoformat()
    s = str(v).strip()
    m = re.match(r"\d{4}-\d{2}-\d{2}", s)
    return m.group(0) if m else None


def relative_date(text: str, today: date | None = None) -> str | None:
    """'2 days ago' / 'Today' / '3 weeks ago' / 'Just now' → ISO date."""
    today = today or date.today()
    t = (text or "").lower()
    if not t:
        return None
    if any(w in t for w in ("today", "just now", "hour", "minute", "few")):
        return today.isoformat()
    m = re.search(r"(\d+)\s*(day|week|month)", t)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    days = n * {"day": 1, "week": 7, "month": 30}[unit]
    return (today - timedelta(days=days)).isoformat()


def _kind(title: str, hint: str = "") -> str:
    t = f"{title} {hint}".lower()
    return "internship" if re.search(r"\bintern|internship|trainee|apprentice", t) else "fulltime"


# ---------------------------------------------------------------- ATS boards (official public APIs)

async def _get_json(client, url, params=None):
    r = await client.get(url, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


async def greenhouse(client, slug):
    d = await _get_json(client, f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", {"content": "true"})
    return [_row(title=j.get("title"), company=slug, url=j.get("absolute_url"), source="greenhouse",
                 location=(j.get("location") or {}).get("name", ""), posted_at=_date(j.get("first_published") or j.get("updated_at")),
                 desc=_text(j.get("content")), src_id=str(j["id"]), type=_kind(j.get("title", "")))
            for j in d.get("jobs", [])]


async def lever(client, slug):
    d = await _get_json(client, f"https://api.lever.co/v0/postings/{slug}", {"mode": "json"})
    if not isinstance(d, list):
        raise ValueError("not found")
    return [_row(title=j.get("text"), company=slug, url=j.get("hostedUrl"), source="lever",
                 location=(j.get("categories") or {}).get("location", ""), posted_at=_date(j.get("createdAt")),
                 desc=j.get("descriptionPlain") or _text(j.get("description")), src_id=str(j["id"]),
                 type=_kind(j.get("text", ""), (j.get("categories") or {}).get("commitment", "")))
            for j in d]


async def ashby(client, slug):
    d = await _get_json(client, f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    return [_row(title=j.get("title"), company=slug, url=j.get("jobUrl") or j.get("applyUrl"), source="ashby",
                 location=(j.get("location") or "") + (" (Remote)" if j.get("isRemote") else ""),
                 posted_at=_date(j.get("publishedAt")), desc=j.get("descriptionPlain") or _text(j.get("descriptionHtml")),
                 src_id=str(j["id"]), type=_kind(j.get("title", ""), j.get("employmentType", "")))
            for j in d.get("jobs", []) if j.get("isListed", True)]


async def fetch_ats(cfg: dict) -> list[dict]:
    fetchers = {"greenhouse": greenhouse, "lever": lever, "ashby": ashby}
    sem = asyncio.Semaphore(8)
    out: list[dict] = []

    async def one(client, ats, slug):
        async with sem:
            try:
                rows = await fetchers[ats](client, slug)
                out.extend(rows)
            except Exception as e:  # noqa: BLE001
                log(f"{ats}:{slug} skipped ({type(e).__name__})")

    async with httpx.AsyncClient(headers=UA, follow_redirects=True) as client:
        await asyncio.gather(*(one(client, ats, s) for ats, slugs in cfg["ats"].items() for s in slugs))
    log(f"ats boards: {len(out)} postings (before location filter)")
    return out


# ---------------------------------------------------------------- Internshala (HTML)

def _internshala_page(client: httpx.Client, path: str, kind: str) -> list[dict]:
    r = client.get(f"https://internshala.com/{path}", timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out = []
    for card in soup.select("div.individual_internship"):
        a = card.select_one("a.job-title-href") or card.select_one('a[href*="/detail/"]')
        href = (a.get("href") if a else None) or card.get("data-href") or ""
        if not href:
            continue
        title_el = card.select_one(".job-internship-name") or a
        company = card.select_one(".company-name")
        loc = card.select_one(".locations")
        pay = re.search(r"₹\s?[\d,.]+(?:\s?(?:-|to)\s?₹?\s?[\d,.]+)?(?:\s?(?:/\s?\w+|LPA|lakhs?|per \w+))?", card.get_text(" "))
        posted = card.select_one("[class*=status-]")
        out.append(_row(title=_text(title_el.get_text()) if title_el else "", company=_text(company.get_text()) if company else "",
                        location=_text(loc.get_text()) if loc else "", url="https://internshala.com" + href if href.startswith("/") else href,
                        source="internshala", type=kind, pay=re.sub(r"\s+", " ", pay.group(0)).strip() if pay else "",
                        posted_at=relative_date(_text(posted.get_text()) if posted else ""),
                        src_id=re.sub(r"\D", "", href)[-8:] or href))
    return out


def fetch_internshala(cfg: dict) -> list[dict]:
    c = cfg["internshala"]
    out: list[dict] = []
    with httpx.Client(headers=UA, follow_redirects=True) as client:
        for city in c["cities"]:
            suffix = f"-in-{city}" if city else ""
            for slug in c["internships"]:
                try:
                    out += _internshala_page(client, f"internships/{slug}-internship{suffix}/", "internship")
                except Exception as e:  # noqa: BLE001
                    log(f"internshala {slug}{suffix}: {type(e).__name__}")
                time.sleep(1.0)
            for slug in c["jobs"]:
                try:
                    out += _internshala_page(client, f"jobs/{slug}-jobs{suffix}/", "fulltime")
                except Exception as e:  # noqa: BLE001
                    log(f"internshala jobs {slug}{suffix}: {type(e).__name__}")
                time.sleep(1.0)
    log(f"internshala: {len(out)} cards")
    return out


# ---------------------------------------------------------------- LinkedIn public guest search (best effort)

def _linkedin_page(client: httpx.Client, s: dict, start: int) -> list[dict]:
    r = client.get("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
                   params={"keywords": s["keywords"], "location": s["location"], "f_E": s.get("experience", "1,2"),
                           "f_TPR": "r604800", "start": start}, timeout=TIMEOUT)
    if r.status_code == 429:
        raise RuntimeError("rate limited")
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out = []
    for card in soup.select("div.base-card"):
        a = card.select_one("a.base-card__full-link")
        if not a:
            continue
        url = a.get("href", "").split("?")[0]
        urn = card.get("data-entity-urn", "")
        t = card.select_one("time")
        title = _text((card.select_one(".base-search-card__title") or a).get_text())
        out.append(_row(title=title, company=_text((card.select_one(".base-search-card__subtitle") or card).get_text()),
                        location=_text((card.select_one(".job-search-card__location") or card).get_text()), url=url,
                        source="linkedin", type=_kind(title), posted_at=t.get("datetime") if t else None,
                        src_id=urn.rsplit(":", 1)[-1] or url))
    return out


def fetch_linkedin(cfg: dict) -> list[dict]:
    out: list[dict] = []
    with httpx.Client(headers=UA, follow_redirects=True) as client:
        for s in cfg["linkedin_searches"]:
            for start in (0, 25):
                try:
                    page = _linkedin_page(client, s, start)
                    out += page
                    if len(page) < 10:
                        break
                except Exception as e:  # noqa: BLE001
                    log(f"linkedin '{s['keywords']}' start={start}: {type(e).__name__}: {e}")
                    if "rate" in str(e).lower():
                        log("linkedin: backing off, keeping what we have")
                        return out
                    break
                time.sleep(2.0)
    log(f"linkedin: {len(out)} cards")
    return out


# ---------------------------------------------------------------- JSearch (RapidAPI, optional)

def fetch_jsearch(cfg: dict) -> list[dict]:
    key = os.environ.get("RAPIDAPI_KEY", "").strip()
    if not key:
        log("jsearch: RAPIDAPI_KEY not set, skipped")
        return []
    out: list[dict] = []
    with httpx.Client(headers={**UA, "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}) as client:
        for q in cfg["jsearch_queries"]:
            try:
                r = client.get("https://jsearch.p.rapidapi.com/search",
                               params={"query": q, "page": 1, "num_pages": 1, "date_posted": "week", "country": "in"}, timeout=TIMEOUT)
                r.raise_for_status()
                for j in r.json().get("data", []):
                    loc = ", ".join(x for x in (j.get("job_city"), j.get("job_state"), j.get("job_country")) if x)
                    out.append(_row(title=j.get("job_title"), company=j.get("employer_name"), location=loc + (" (Remote)" if j.get("job_is_remote") else ""),
                                    url=j.get("job_apply_link"), source="jsearch", desc=j.get("job_description") or "",
                                    posted_at=_date(j.get("job_posted_at_datetime_utc")), src_id=j.get("job_id", ""),
                                    type=_kind(j.get("job_title", ""), j.get("job_employment_type", "")),
                                    pay=" - ".join(str(x) for x in (j.get("job_min_salary"), j.get("job_max_salary")) if x)))
            except Exception as e:  # noqa: BLE001
                log(f"jsearch '{q}': {type(e).__name__}")
    log(f"jsearch: {len(out)} results")
    return out


def fetch_all(cfg: dict) -> list[dict]:
    rows = asyncio.run(fetch_ats(cfg))
    rows += fetch_internshala(cfg)
    rows += fetch_linkedin(cfg)
    rows += fetch_jsearch(cfg)
    return rows
