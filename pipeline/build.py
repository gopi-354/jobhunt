"""Fetch -> filter -> dedupe -> merge with previous data -> optional LLM fit scoring -> docs/data/jobs.json"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config.json").read_text(encoding="utf-8"))
OUT = ROOT / "docs" / "data" / "jobs.json"
PROFILE = ROOT / "profile.md"


def _id(row: dict) -> str:
    key = f"{row['source']}:{row['src_id']}" if row.get("src_id") else row["url"]
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def title_ok(title: str, cfg: dict = CFG) -> bool:
    t = f" {title.lower()} "
    if not any(k in t for k in cfg["title_require"]):
        return False
    if any(k in t for k in cfg["title_exclude"]):
        return False
    m = re.search(r"(\d+)\s*\+?\s*(?:years|yrs)", t)
    return not (m and int(m.group(1)) >= 3)


def location_ok(location: str, source: str, cfg: dict = CFG) -> bool:
    if source in ("internshala", "linkedin", "jsearch"):  # already India-scoped by the query
        return True
    return any(k in location.lower() for k in cfg["india_markers"])


def in_bangalore(location: str, cfg: dict = CFG) -> bool:
    return any(k in location.lower() for k in cfg["bangalore_markers"])


def normalize(rows: list[dict], cfg: dict = CFG) -> list[dict]:
    """Filter + dedupe. Keeps the first occurrence per id, then per (company, title) pair."""
    out, seen_id, seen_ct = [], set(), set()
    for r in rows:
        if not r.get("title") or not r.get("url"):
            continue
        if not title_ok(r["title"], cfg) or not location_ok(r.get("location", ""), r["source"], cfg):
            continue
        rid = _id(r)
        ct = (r.get("company", "").lower(), re.sub(r"\W+", " ", r["title"].lower()).strip())
        if rid in seen_id or ct in seen_ct:
            continue
        seen_id.add(rid)
        seen_ct.add(ct)
        out.append({"id": rid, "title": r["title"], "company": r.get("company", ""), "location": r.get("location", ""),
                    "bangalore": in_bangalore(r.get("location", ""), cfg), "remote": "remote" in r.get("location", "").lower(),
                    "type": r.get("type", "unknown"), "source": r["source"], "url": r["url"], "posted_at": r.get("posted_at"),
                    "pay": r.get("pay", ""), "snippet": (r.get("desc") or "")[:280], "_desc": r.get("desc") or ""})
    return out


def merge(previous: list[dict], fresh: list[dict], now: datetime, cfg: dict = CFG) -> list[dict]:
    """Preserve first_seen and fit from previous runs; drop anything older than keep_days."""
    prev = {j["id"]: j for j in previous}
    cutoff = (now - timedelta(days=cfg["keep_days"])).date().isoformat()
    merged = {}
    for j in fresh:
        old = prev.get(j["id"])
        j["first_seen"] = old["first_seen"] if old else now.date().isoformat()
        j["fit"] = old.get("fit") if old else None
        j["last_seen"] = now.date().isoformat()
        merged[j["id"]] = j
    for pid, old in prev.items():  # keep recently-seen jobs even if one source hiccups today
        if pid not in merged and old.get("last_seen", old["first_seen"]) >= cutoff:
            merged[pid] = old
    return [j for j in merged.values() if j["first_seen"] >= cutoff]


PROMPT = """You are helping an entry-level candidate in Bengaluru decide which jobs to apply to. Candidate profile:
---
{profile}
---
Job:
Title: {title}
Company: {company}
Location: {location}
Type: {type}
Description (may be truncated):
{desc}

Reply with ONLY a JSON object:
{{"score": <1-10 integer, 10 = apply today, 1 = do not bother; penalize roles needing 3+ years or a very different domain>,
 "reason": "<max 25 words, concrete, mention the strongest match or the blocker>",
 "highlight": "<max 20 words: what from the profile to emphasize in the application or outreach>"}}"""


async def score_jobs(jobs: list[dict], api_key: str, model: str, profile: str, limit: int) -> int:
    todo = [j for j in jobs if j.get("fit") is None and j.get("_desc") is not None][:limit]
    if not todo:
        return 0
    sem = asyncio.Semaphore(4)
    done = 0

    async def one(client: httpx.AsyncClient, j: dict) -> None:
        nonlocal done
        prompt = PROMPT.format(profile=profile, title=j["title"], company=j["company"], location=j["location"], type=j["type"],
                               desc=(j.get("_desc") or j.get("snippet") or "(no description available; judge from title)")[:5000])
        try:
            async with sem:
                r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                                      json={"model": model, "temperature": 0, "messages": [{"role": "user", "content": prompt}]},
                                      headers={"Authorization": f"Bearer {api_key}", "HTTP-Referer": "https://github.com/gopi-354/jobhunt",
                                               "X-Title": "jobhunt"}, timeout=60)
                r.raise_for_status()
            s = r.json()["choices"][0]["message"]["content"]
            d = json.loads(s[s.find("{"): s.rfind("}") + 1])
            j["fit"] = {"score": max(1, min(10, int(d.get("score", 5)))), "reason": str(d.get("reason", ""))[:200],
                        "highlight": str(d.get("highlight", ""))[:160]}
            done += 1
        except Exception as e:  # noqa: BLE001
            if done == 0:
                print(f"  llm: {type(e).__name__}: {str(e)[:160]}")

    async with httpx.AsyncClient() as client:
        await asyncio.gather(*(one(client, j) for j in todo))
    return done


def main() -> None:
    from sources import fetch_all  # local import so tests can import build without network deps

    now = datetime.now(timezone.utc)
    previous = json.loads(OUT.read_text(encoding="utf-8"))["jobs"] if OUT.exists() else []
    print("fetching...")
    raw = fetch_all(CFG)
    fresh = normalize(raw, CFG)
    jobs = merge(previous, fresh, now, CFG)
    new = sum(1 for j in jobs if j["first_seen"] == now.date().isoformat())
    print(f"raw {len(raw)} -> kept {len(fresh)} -> merged {len(jobs)} ({new} new today)")

    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        profile = PROFILE.read_text(encoding="utf-8") if PROFILE.exists() else "Entry-level data scientist / AI engineer in Bengaluru."
        n = asyncio.run(score_jobs(jobs, key, CFG["llm_model"], profile, CFG["max_llm_scores_per_run"]))
        print(f"scored {n} jobs")
    else:
        print("OPENROUTER_API_KEY not set: fit scores left empty (the app can score in-browser with a key)")

    for j in jobs:
        j.pop("_desc", None)
    jobs.sort(key=lambda j: ((j["fit"]["score"] if j.get("fit") else 0), j["first_seen"], j.get("posted_at") or ""), reverse=True)
    by_source = {}
    for j in jobs:
        by_source[j["source"]] = by_source.get(j["source"], 0) + 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated_at": now.isoformat(timespec="seconds"), "count": len(jobs), "new_today": new,
                               "by_source": by_source, "jobs": jobs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
