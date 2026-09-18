# JobHunt

Entry-level data science / ML / AI jobs and internships in India, refreshed every morning, plus an application tracker and outreach helper. One page, works on a phone, nothing to install.

**Live app:** https://gopi-354.github.io/jobhunt/

## For the job seeker

1. Open the link. **Settings** → fill in your profile (2 minutes, be specific, include numbers) → paste the OpenRouter key you were given → Save.
2. **Jobs** tab, every morning after 7:00 IST. "New" shows what arrived since your last visit. Press **AI-score** once to rank them for you; the reason line tells you what to emphasize.
3. For anything worth it press **Apply ↗**. It opens the posting and moves it to **Tracker** with a follow-up reminder 7 days out. **Not for me** hides it forever. **Save** keeps it for later.
4. **Find people** on any job → LinkedIn and Google searches for people at that company in Bengaluru, recruiters, and alumni. Add 1-2 as contacts → **Draft email** or **LinkedIn note** → edit → **Open in Gmail**. **Mark messaged** sets a follow-up reminder.
5. Daily rhythm that works: 5 applications + 3 outreach messages, every weekday. Follow up after 7 and 14 days, then let it go.

Your applications, contacts and drafts are stored only in your browser. **Settings → Export backup** once a week.

Missing a company? Ask Gopi to add its careers-board slug to `pipeline/config.json`. Bad jobs slipping through? The title filters are in the same file.

## For the maintainer

- `pipeline/build.py` runs daily via `.github/workflows/daily.yml` (07:00 IST) and commits `docs/data/jobs.json`. GitHub Pages serves `docs/`.
- Sources: Internshala (HTML), LinkedIn public guest search (best-effort, rate-limited from CI sometimes), JSearch on RapidAPI (only if `RAPIDAPI_KEY` secret is set), and ~30 company boards through official Greenhouse/Lever/Ashby APIs (list in `pipeline/config.json`, all verified to carry India data roles).
- Filters: title must look like a data/ML/AI/analyst role; senior/lead/manager/3+ years titles are dropped; ATS results must mention an Indian city or remote.
- Fit scoring in CI needs the `OPENROUTER_API_KEY` secret and reads `profile.md`. Without it the app can score in the browser with the user's own key. Model in `config.json`.
- Jobs are kept 45 days; `first_seen` and `fit` survive across runs.

```
python -m venv .venv && .venv/Scripts/pip install -r pipeline/requirements.txt pytest
.venv/Scripts/python -m pytest -q tests            # pipeline logic
node --test tests/logic.test.js                    # app logic
.venv/Scripts/python pipeline/build.py             # real fetch → docs/data/jobs.json (~2 min)
python -m http.server 8080 --directory docs        # open http://localhost:8080
```

Secrets to add once in the repo (Settings → Secrets → Actions): `OPENROUTER_API_KEY` (recommended), `RAPIDAPI_KEY` (optional, from the old job-search-automation repo).
