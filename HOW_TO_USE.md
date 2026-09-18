# How to use JobHunt

Open **https://gopi-354.github.io/jobhunt/** on your laptop or phone. Bookmark it. Nothing to install, no login.

The app does three things: brings you the jobs, tracks what you applied to, and helps you reach people at those companies. Ten focused minutes every morning beats two scattered hours.

---

## First time (5 minutes)

1. Go to **Settings**.
2. Fill in **Your profile**. This text is what the AI reads when it scores jobs and writes messages for you, so specifics matter:
   - Headline: one line, e.g. `B.Tech CSE 2025 · classical ML + LLM apps · looking for DS/AI roles in Bengaluru`.
   - Skills: real tools, not adjectives. `Python, pandas, scikit-learn, XGBoost, SQL, PyTorch, LangChain, RAG, Power BI`.
   - Projects: one per line, with a number in each. `Churn model, AUC 0.87, deployed with FastAPI` beats `worked on ML projects`.
   - Preferences: `Bengaluru or remote, paid internships only, can join immediately`.
3. Paste the **OpenRouter API key** you were given. Press **Test key**, then **Save**. The key stays in this browser only.
4. Back to **Jobs**.

If you switch phones or browsers, do this again, or use **Export backup** / **Import backup** in Settings.

---

## Every morning (10 minutes)

New jobs arrive at 7:00 IST.

1. **Jobs** tab. Press the **New** chip to see only what arrived since your last visit. The red number on the tab is the count.
2. Press **AI-score** (top of the list). It ranks the unscored jobs 1 to 10 for *you* and writes one line explaining why, plus what to emphasize. Takes about 20 seconds. Then pick **fit ≥ 6** from the dropdown.
3. For each job, one of four buttons:
   - **Apply ↗** opens the posting in a new tab and moves it to your Tracker with a follow-up reminder 7 days out. Press it *when you actually apply*.
   - **☆ Save** keeps it for later. Find saved jobs with the **Saved** chip.
   - **Not for me** hides it for good. Be quick with this; a clean list is the point.
   - **AI: why me?** gives a short honest read: fit, gaps, three things to emphasize, and whether to apply or find a referral first.
4. Use the chips to narrow: **Internships** vs **Full-time**, **Bengaluru** vs **Remote**, or a specific source. The search box matches title, company and location.

**Where the jobs come from:** Internshala, LinkedIn public search, JSearch (Google Jobs), and the official career boards of ~30 companies that hire data roles in India (Sarvam, Paytm, Meesho, Coinbase, Twilio, Stripe, Sigmoid, Glance, InMobi, Rubrik, Confluent and more). Senior, lead and 3+ years roles are filtered out before you see them. Some noise still gets through; the score handles it.

---

## Tracker: never lose an application

Every **Apply ↗** lands here. For each application:

- **Stage** dropdown: applied → replied → interview → offer / rejected / ghosted. Change it the moment something happens.
- **Follow up** date: set automatically to 7 days after applying. When it turns red, it is due. Send a short note, then set the next date (7 more days). After two follow-ups with no reply, mark **ghosted** and move on.
- **Notes**: recruiter name, what they asked, what you promised. Write it the same day.
- **Find people** jumps to Outreach with the company prefilled.

Applied somewhere outside the app (a referral, a walk-in, a college drive)? **+ Add an application from elsewhere**.

The five numbers at the top are your dashboard. **Follow-ups due** should be zero when you close the laptop.

**Export CSV** if you want the list in a spreadsheet.

---

## Outreach: the part most people skip, and the part that works

A referral or a warm reply from someone inside gets your application read. Cold applications alone mostly do not. Aim for **3 messages a day**, tracked here.

### Find people

1. Press **Find people** on a job, or type a company in the Outreach tab.
2. Use the links, in this order of reply rate:
   - Alumni from your college at that company (search their name plus your college on LinkedIn).
   - People who recently posted "we're hiring" for the team.
   - **Recruiters / talent** at the company.
   - Data scientists on the team, ideally 1 to 3 years in, they remember being where you are.
3. **Google X-ray** finds profiles without LinkedIn's login wall.
4. **Guess a work email**: type first name, last name and the company domain. The first pattern is right most of the time. Verify with a free checker like hunter.io before sending; a bounced email to a wrong address costs you nothing, but a right one is gold.

### Add a contact and write to them

1. **Add a contact** with whatever you have: a name and LinkedIn URL is enough. Link the related job.
2. Press one of:
   - **Draft email**: under 120 words, one specific reason for writing, one small ask. Comes with a subject line.
   - **LinkedIn note**: fits the 300-character connection-request limit.
   - **Follow-up**: for when they have not replied in a week.
3. **Edit the draft.** Always. Add the one detail only you know: the project of theirs you read, the talk they gave, the shared college. The AI gives you a clean skeleton, you make it human.
4. **Copy**, or **Open in Gmail** (email is prefilled), or **Open profile** (LinkedIn).
5. Press **Mark messaged**. It logs the date and sets a follow-up reminder in 7 days.
6. When they reply, set the status to **replied**. If you get on a call, **call done**.

### What to ask for

Not "please give me a job". Ask for one of:
- a referral for a specific opening (give the link and one line on why you fit),
- 15 minutes of advice on breaking into DS at their company,
- whether the team is hiring interns or freshers this quarter.

People say yes to small, specific asks.

---

## A weekly rhythm

| Day | Do |
|---|---|
| Mon–Fri, morning | Jobs → New → AI-score → apply to 5 (fit ≥ 6) |
| Mon–Fri, evening | Outreach → 3 messages → clear red follow-ups |
| Saturday | Tracker review: move stale ones to ghosted, export a backup |
| Sunday | Off. Seriously. |

Five applications and three messages a day is 25 + 15 a week. Most people who land offers in this market are doing roughly this for 6 to 10 weeks.

---

## Questions

**The AI buttons say "add your OpenRouter key".** Settings → paste the key → Save. If it says the key is invalid, ask Gopi for a new one.

**A job is clearly not for me but keeps showing.** Press **Not for me**. If a whole category is noise (for example "financial analyst"), tell Gopi and the filter gets updated for everyone.

**A company I care about is missing.** Send Gopi the company's careers page URL. If it runs on Greenhouse, Lever or Ashby it can be added in a minute.

**I cleared my browser and everything is gone.** Applications and contacts live only in the browser. Restore from the last **Export backup** file. Export weekly.

**Fit scores are empty on new jobs.** Press **AI-score**. The daily job can also score them automatically once a key is set on the server side.

**Can it apply for me?** No, on purpose. Every application it makes for you is one you cannot speak to in an interview. It removes the searching and the tracking so the applying and the talking get your full attention.
