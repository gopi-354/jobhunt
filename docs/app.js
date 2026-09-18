import { STAGES, CONTACT_STATUS, ago, addDays, todayISO, filterJobs, sortJobs, trackerSummary, gmailUrl, mailtoUrl,
         peopleSearchLinks, emailPatterns, toCSV, parseJSON, prompts } from "./logic.js";

const LS = "jobhunt.v1";
const DEFAULTS = {
  profile: { name: "", headline: "", education: "", skills: "", projects: "", links: "", prefs: "" },
  settings: { key: "", model: "google/gemini-3.7-flash", lastVisit: null },
  jobs: {},        // jobId -> { status: saved|applied|dismissed, appliedAt, stage, followUp, notes, snap:{title,company,url,location} }
  contacts: [],    // { id, name, role, company, linkedin, email, jobId, status, lastContact, followUp, notes, drafts:{} }
  fits: {},        // jobId -> { score, reason, highlight }  (scored in-browser)
  ai: {},          // jobId -> { why }
};

let state = load();
let DATA = { updated_at: null, jobs: [], by_source: {} };
let tab = ["jobs", "tracker", "outreach", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "jobs";
const filters = { q: "", type: "all", where: "all", source: "all", show: "open", minFit: 0, sort: "fit" };
const ui = { busy: {}, outreach: { company: "", role: "data scientist", city: "Bengaluru", jobId: "", first: "", last: "", domain: "" }, toast: null, error: "" };
const prevVisit = state.settings.lastVisit;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "null");
    return raw ? { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...raw.settings }, profile: { ...DEFAULTS.profile, ...raw.profile } }
               : structuredClone(DEFAULTS);
  } catch { return structuredClone(DEFAULTS); }
}
function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { toast("Could not save: " + e.message); } }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const jobById = (id) => DATA.jobs.find((j) => j.id === id) || (state.jobs[id]?.snap ? { id, ...state.jobs[id].snap } : null);
const isNew = (j) => !prevVisit || j.first_seen >= prevVisit;
const profileText = () => {
  const p = state.profile;
  const t = [p.name && `Name: ${p.name}`, p.headline && `Headline: ${p.headline}`, p.education && `Education: ${p.education}`,
             p.skills && `Skills: ${p.skills}`, p.projects && `Projects / experience: ${p.projects}`, p.links && `Links: ${p.links}`,
             p.prefs && `Preferences: ${p.prefs}`].filter(Boolean).join("\n");
  return t || "Entry-level data scientist / AI engineer in Bengaluru. Strong in classical ML (scikit-learn, XGBoost), Python, SQL; comfortable with LLM apps and RAG.";
};

// ---------------------------------------------------------------- LLM
async function llm(prompt, temperature = 0.3) {
  const key = state.settings.key.trim();
  if (!key) throw new Error("Add your OpenRouter key in Settings first.");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": location.origin, "X-Title": "JobHunt" },
    body: JSON.stringify({ model: state.settings.model || DEFAULTS.settings.model, temperature, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).choices[0].message.content.trim();
}
async function withBusy(key, fn) {
  ui.busy[key] = true; render();
  try { await fn(); } catch (e) { toast(e.message); } finally { delete ui.busy[key]; render(); }
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg, undo) {
  ui.toast = { msg, undo }; renderToast();
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = null; renderToast(); }, 6000);
}
function renderToast() {
  let el = $("#toast");
  if (!ui.toast) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(ui.toast.msg)}</span>${ui.toast.undo ? '<button id="undo">Undo</button>' : ""}`;
  $("#undo", el)?.addEventListener("click", () => { ui.toast.undo(); ui.toast = null; renderToast(); save(); render(); });
}

// ---------------------------------------------------------------- job state mutations
function setJob(id, patch) {
  const j = jobById(id);
  state.jobs[id] = { ...(state.jobs[id] || {}), ...patch, snap: state.jobs[id]?.snap || (j && { title: j.title, company: j.company, url: j.url, location: j.location, type: j.type }) };
  save();
}
function markApplied(id) {
  const before = state.jobs[id] ? { ...state.jobs[id] } : null;
  setJob(id, { status: "applied", appliedAt: todayISO(), stage: "applied", followUp: addDays(todayISO(), 7) });
  toast("Marked as applied. Follow-up set for 7 days.", () => { if (before) state.jobs[id] = before; else delete state.jobs[id]; });
}

// ---------------------------------------------------------------- views
function fitPill(j) {
  const f = j.fit || state.fits[j.id];
  if (!f) return `<div class="fit"><span class="n">–</span><small>fit</small></div>`;
  const cls = f.score >= 7 ? "hi" : f.score >= 5 ? "mid" : "lo";
  return `<div class="fit"><span class="n ${cls}">${f.score}</span><small>fit</small></div>`;
}
function jobCard(j) {
  const st = state.jobs[j.id] || {};
  const f = j.fit || state.fits[j.id];
  const busy = ui.busy["why:" + j.id];
  return `<article class="card job" data-id="${j.id}">
    <div class="head">
      <div>
        <h3><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></h3>
        <div class="sub"><b>${esc(j.company)}</b> · ${esc(j.location || "location n/a")}${j.pay ? " · " + esc(j.pay) : ""}</div>
        <div class="sub" style="margin-top:6px">
          ${isNew(j) ? '<span class="tag new">new</span>' : ""}<span class="tag">${j.type === "internship" ? "internship" : "full-time"}</span>
          <span class="tag">${esc(j.source)}</span>${j.remote ? '<span class="tag">remote</span>' : ""}
          <span>${j.posted_at ? "posted " + ago(j.posted_at) : "found " + ago(j.first_seen)}</span>
        </div>
      </div>
      ${fitPill(j)}
    </div>
    ${f?.reason ? `<p class="reason">${esc(f.reason)}${f.highlight ? ` <b>Emphasize:</b> ${esc(f.highlight)}` : ""}</p>` : ""}
    <div class="actions">
      <button class="primary" data-act="apply">Apply ↗</button>
      <button data-act="save">${st.status === "saved" ? "★ Saved" : "☆ Save"}</button>
      <button data-act="skip">Not for me</button>
      <button data-act="why" ${busy ? "disabled" : ""}>${busy ? "Thinking…" : "AI: why me?"}</button>
      <button data-act="outreach">Find people</button>
      ${st.status === "applied" ? '<span class="tag">applied ' + esc(st.appliedAt) + "</span>" : ""}
    </div>
    ${state.ai[j.id]?.why ? `<div class="ai-out">${esc(state.ai[j.id].why)}</div>` : ""}
  </article>`;
}

function viewJobs() {
  const shown = sortJobs(filterJobs(DATA.jobs, filters, state.jobs, state.fits, prevVisit), filters.sort, state.fits);
  const unscored = shown.filter((j) => !j.fit && !state.fits[j.id]).length;
  const sources = Object.keys(DATA.by_source || {}).sort();
  const chip = (k, v, label) => `<button class="chip ${filters[k] === v ? "on" : ""}" data-f="${k}" data-v="${v}">${label}</button>`;
  return `
  <div class="toolbar">
    <input type="search" id="q" placeholder="Search title, company, location" value="${esc(filters.q)}">
    <select id="sort"><option value="fit" ${filters.sort === "fit" ? "selected" : ""}>Best fit first</option><option value="newest" ${filters.sort === "newest" ? "selected" : ""}>Newest first</option></select>
    <select id="minFit">${[0, 6, 8].map((n) => `<option value="${n}" ${filters.minFit === n ? "selected" : ""}>${n ? `fit ≥ ${n}` : "any fit"}</option>`).join("")}</select>
    <select id="source"><option value="all">all sources</option>${sources.map((s) => `<option ${filters.source === s ? "selected" : ""}>${s}</option>`).join("")}</select>
  </div>
  <div class="toolbar">
    <div class="chips">${chip("show", "new", "New")}${chip("show", "open", "To review")}${chip("show", "saved", "Saved")}${chip("show", "all", "Everything")}</div>
    <div class="chips">${chip("type", "all", "Any type")}${chip("type", "fulltime", "Full-time")}${chip("type", "internship", "Internships")}</div>
    <div class="chips">${chip("where", "all", "Anywhere in India")}${chip("where", "bangalore", "Bengaluru")}${chip("where", "remote", "Remote")}</div>
  </div>
  <div class="count">${shown.length} of ${DATA.jobs.length} jobs${DATA.updated_at ? ` · data refreshed ${ago(DATA.updated_at)}` : ""}
    ${unscored && state.settings.key ? ` · <button class="small" data-act="scoreAll" ${ui.busy.score ? "disabled" : ""}>${ui.busy.score ? "Scoring…" : `AI-score ${Math.min(unscored, 40)} unscored`}</button>` : ""}
    ${!state.settings.key ? ' · <a href="#settings" data-tab="settings">add an OpenRouter key</a> for fit scores and drafts' : ""}</div>
  ${shown.length ? shown.slice(0, 150).map(jobCard).join("") : '<div class="empty">Nothing here. Try "Everything", or wait for tomorrow\'s 7am refresh.</div>'}`;
}

function viewTracker() {
  const s = trackerSummary(state.jobs);
  const rows = Object.entries(state.jobs).filter(([, v]) => v.status === "applied").map(([id, v]) => ({ id, ...v, job: jobById(id) || v.snap || {} }));
  const today = todayISO();
  const section = (stage) => {
    const list = rows.filter((r) => (r.stage || "applied") === stage).sort((a, b) => (b.appliedAt || "").localeCompare(a.appliedAt || ""));
    if (!list.length) return "";
    return `<h2>${stage} (${list.length})</h2>` + list.map((r) => `
      <div class="card row" data-id="${r.id}">
        <div>
          <b><a href="${esc(r.job.url)}" target="_blank" rel="noopener">${esc(r.job.title || "(untitled)")}</a></b> · ${esc(r.job.company || "")}
          <div class="note">applied ${esc(r.appliedAt || "?")}${r.followUp ? ` · follow up <span class="${r.followUp <= today && !["offer", "rejected"].includes(r.stage) ? "due" : ""}">${esc(r.followUp)}</span>` : ""}</div>
          <details ${r.notes ? "open" : ""}><summary>notes</summary><textarea data-act="notes" placeholder="Recruiter name, what they said, next step…">${esc(r.notes || "")}</textarea></details>
        </div>
        <div class="ctl">
          <select data-act="stage">${STAGES.map((x) => `<option ${x === (r.stage || "applied") ? "selected" : ""}>${x}</option>`).join("")}</select>
          <input type="date" data-act="followUp" value="${esc(r.followUp || "")}">
          <button class="small" data-act="outreach">Find people</button>
          <button class="small ghost" data-act="untrack">Remove</button>
        </div>
      </div>`).join("");
  };
  return `
  <div class="stats">
    <div class="stat"><b>${s.total}</b><span>applications</span></div>
    <div class="stat"><b>${s.thisWeek}</b><span>this week</span></div>
    <div class="stat"><b>${s.waiting}</b><span>awaiting reply</span></div>
    <div class="stat"><b>${s.interviews}</b><span>interviews</span></div>
    <div class="stat ${s.followUpsDue ? "due" : ""}"><b>${s.followUpsDue}</b><span>follow-ups due</span></div>
  </div>
  <div class="toolbar">
    <details><summary>+ Add an application from elsewhere</summary>
      <div class="card"><div class="grid">
        <div><label>Job title</label><input id="m-title"></div><div><label>Company</label><input id="m-company"></div>
        <div><label>Link</label><input id="m-url" placeholder="https://"></div><div><label>Applied on</label><input id="m-date" type="date" value="${today}"></div>
      </div><div class="actions"><button class="primary" data-act="addManual">Add</button></div></div>
    </details>
    <span style="margin-left:auto"></span>
    <button class="small" data-act="exportCsv">Export CSV</button>
  </div>
  ${rows.length ? STAGES.map(section).join("") : '<div class="empty">No applications yet. Hit <b>Apply ↗</b> on a job and it lands here with a 7-day follow-up reminder.</div>'}
  <p class="note">A rule that works: 5 applications + 3 outreach messages every weekday. Follow up once after 7 days, once more after 14, then move on.</p>`;
}

function viewOutreach() {
  const o = ui.outreach;
  const links = peopleSearchLinks(o.company, o.role, o.city);
  const pats = emailPatterns(o.first, o.last, o.domain);
  const jobOpts = Object.entries(state.jobs).filter(([, v]) => v.status !== "dismissed").map(([id, v]) => ({ id, ...(jobById(id) || v.snap || {}) }));
  const contactCard = (c) => {
    const job = c.jobId ? jobById(c.jobId) : null;
    const d = c.drafts || {};
    const busy = (k) => ui.busy[`draft:${c.id}:${k}`];
    const subj = (d.email || "").match(/^Subject:\s*(.*)$/m)?.[1] || `Question about ${job ? job.title : "data roles"} at ${c.company || ""}`;
    const body = (d.email || "").replace(/^Subject:.*\n+/m, "");
    return `<div class="card" data-cid="${c.id}">
      <div class="row"><div>
        <b>${esc(c.name || "(no name)")}</b> ${c.role ? "· " + esc(c.role) : ""} ${c.company ? "· " + esc(c.company) : ""}
        <div class="note">${c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a> · ` : ""}${c.email ? esc(c.email) + " · " : ""}${job ? `re: ${esc(job.title)}` : ""}${c.lastContact ? ` · last contact ${esc(c.lastContact)}` : ""}${c.followUp ? ` · follow up <span class="${c.followUp <= todayISO() ? "due" : ""}">${esc(c.followUp)}</span>` : ""}</div>
      </div><div class="ctl">
        <select data-act="cstatus">${CONTACT_STATUS.map((x) => `<option value="${x}" ${x === (c.status || "to_contact") ? "selected" : ""}>${x.replace("_", " ")}</option>`).join("")}</select>
        <button class="small ghost" data-act="cdel">Delete</button>
      </div></div>
      <div class="actions">
        <button class="small" data-act="draft" data-k="email" ${busy("email") ? "disabled" : ""}>${busy("email") ? "Writing…" : "Draft email"}</button>
        <button class="small" data-act="draft" data-k="note" ${busy("note") ? "disabled" : ""}>${busy("note") ? "Writing…" : "LinkedIn note"}</button>
        <button class="small" data-act="draft" data-k="followup" ${busy("followup") ? "disabled" : ""}>${busy("followup") ? "Writing…" : "Follow-up"}</button>
        <button class="small" data-act="sent">Mark messaged</button>
      </div>
      ${["email", "note", "followup"].filter((k) => d[k] !== undefined).map((k) => `
        <label>${k === "email" ? "Email draft (edit freely)" : k === "note" ? "LinkedIn note (≤300 chars)" : "Follow-up"}</label>
        <textarea data-act="editDraft" data-k="${k}">${esc(d[k])}</textarea>
        <div class="actions">
          <button class="small" data-act="copy" data-k="${k}">Copy</button>
          ${k === "email" ? `<a class="chip" href="${esc(gmailUrl(c.email, subj, body))}" target="_blank" rel="noopener">Open in Gmail</a><a class="chip" href="${esc(mailtoUrl(c.email, subj, body))}">Mail app</a>` : ""}
          ${k === "note" && c.linkedin ? `<a class="chip" href="${esc(c.linkedin)}" target="_blank" rel="noopener">Open profile</a>` : ""}
        </div>`).join("")}
    </div>`;
  };
  return `
  <div class="grid">
    <div class="card">
      <b>Find people to reach out to</b>
      <p class="note">Warm beats cold: alumni from your college, people who posted about hiring, and recruiters reply most. Aim for 3 messages a day.</p>
      <label>Company</label><input id="o-company" value="${esc(o.company)}" placeholder="e.g. Sarvam">
      <div class="kv"><div><label>Role keyword</label><input id="o-role" value="${esc(o.role)}"></div><div><label>City</label><input id="o-city" value="${esc(o.city)}"></div></div>
      <div class="links" style="margin-top:10px">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div>
      <details style="margin-top:12px"><summary>Guess a work email</summary>
        <div class="kv"><div><label>First name</label><input id="o-first" value="${esc(o.first)}"></div><div><label>Last name</label><input id="o-last" value="${esc(o.last)}"></div></div>
        <label>Company domain</label><input id="o-domain" value="${esc(o.domain)}" placeholder="acme.com">
        ${pats.length ? `<div class="mono" style="margin-top:8px">${pats.map((p) => `<div>${esc(p)} <button class="small ghost" data-act="copyText" data-text="${esc(p)}">copy</button></div>`).join("")}</div><p class="note">Most companies use the first pattern. Verify with a free tool like hunter.io before sending.</p>` : ""}
      </details>
    </div>
    <div class="card">
      <b>Add a contact</b>
      <div class="kv"><div><label>Name</label><input id="c-name"></div><div><label>Role / title</label><input id="c-role" placeholder="Data Scientist, Recruiter…"></div></div>
      <div class="kv"><div><label>Company</label><input id="c-company" value="${esc(o.company)}"></div><div><label>Email (optional)</label><input id="c-email"></div></div>
      <label>LinkedIn URL (optional)</label><input id="c-linkedin" placeholder="https://www.linkedin.com/in/…">
      <label>Related job (optional)</label><select id="c-job"><option value="">none</option>${jobOpts.map((j) => `<option value="${j.id}" ${j.id === o.jobId ? "selected" : ""}>${esc(j.title)} · ${esc(j.company)}</option>`).join("")}</select>
      <div class="actions"><button class="primary" data-act="addContact">Add contact</button></div>
    </div>
  </div>
  <h2>Contacts (${state.contacts.length})</h2>
  ${state.contacts.length ? [...state.contacts].sort((a, b) => (a.followUp || "9").localeCompare(b.followUp || "9")).map(contactCard).join("")
                          : '<div class="empty">No contacts yet. Add the hiring manager or a data scientist at a company you applied to, then draft a message.</div>'}`;
}

function viewSettings() {
  const p = state.profile, s = state.settings;
  const f = (id, label, val, ph = "", ta = false) => `<label for="${id}">${label}</label>${ta ? `<textarea id="${id}" placeholder="${esc(ph)}">${esc(val)}</textarea>` : `<input id="${id}" value="${esc(val)}" placeholder="${esc(ph)}">`}`;
  return `
  <div class="grid">
    <div class="card">
      <b>Your profile</b> <span class="note">— used for fit scores and every draft. More specific = better output.</span>
      ${f("p-name", "Name", p.name)}
      ${f("p-headline", "One-line headline", p.headline, "Final-year CS student · classical ML + LLM apps · looking for DS/AI roles in Bengaluru")}
      ${f("p-education", "Education", p.education, "B.Tech CSE, XYZ College, 2026, 8.4 CGPA")}
      ${f("p-skills", "Skills", p.skills, "Python, pandas, scikit-learn, XGBoost, SQL, PyTorch basics, LangChain, RAG, Power BI", true)}
      ${f("p-projects", "Projects, internships, achievements (one per line, with numbers)", p.projects, "Churn model for X, AUC 0.87, deployed as API\nKaggle: top 5% in …\nInternship at …", true)}
      ${f("p-links", "Links", p.links, "github.com/…, linkedin.com/in/…, kaggle.com/…")}
      ${f("p-prefs", "Preferences and constraints", p.prefs, "Bengaluru or remote; paid internships only; can join immediately", true)}
      <div class="actions"><button class="primary" data-act="saveProfile">Save profile</button></div>
    </div>
    <div>
      <div class="card">
        <b>AI (OpenRouter)</b>
        <p class="note">One key powers fit scoring, "why me?", and all drafts. It is stored only in this browser. Set a spend limit on the key at openrouter.ai.</p>
        <label>API key</label><input id="s-key" type="password" value="${esc(s.key)}" placeholder="sk-or-v1-…">
        <label>Model</label><input id="s-model" value="${esc(s.model)}">
        <div class="actions"><button class="primary" data-act="saveKey">Save</button><button data-act="testKey" ${ui.busy.test ? "disabled" : ""}>${ui.busy.test ? "Testing…" : "Test key"}</button></div>
      </div>
      <div class="card">
        <b>Your data</b>
        <p class="note">Applications, contacts and drafts live in this browser only. Export before switching phones or clearing the browser.</p>
        <div class="actions"><button data-act="exportJson">Export backup</button><label class="chip" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json" hidden></label><button class="ghost" data-act="reset">Reset everything</button></div>
      </div>
      <div class="card">
        <b>How this works</b>
        <p class="note">Every day at 7:00 IST a script fetches entry-level data / ML / AI roles and internships in India from Internshala, LinkedIn public search, JSearch and ${Object.keys(DATA.by_source || {}).length || "several"} company career boards, filters out senior roles, and publishes them here. Jobs stay for 45 days. Last refresh: ${DATA.updated_at ? esc(DATA.updated_at.slice(0, 16).replace("T", " ")) + " UTC" : "unknown"}.</p>
        <p class="note">Sources today: ${esc(Object.entries(DATA.by_source || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "—")}.</p>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- render + events
function render() {
  const main = $("#main");
  main.innerHTML = { jobs: viewJobs, tracker: viewTracker, outreach: viewOutreach, settings: viewSettings }[tab]();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const due = trackerSummary(state.jobs).followUpsDue + state.contacts.filter((c) => c.followUp && c.followUp <= todayISO() && !["closed", "replied"].includes(c.status)).length;
  const newCount = DATA.jobs.filter((j) => isNew(j) && !state.jobs[j.id]).length;
  $('#tabs [data-tab="tracker"]').innerHTML = `Tracker${due ? `<span class="badge">${due}</span>` : ""}`;
  $('#tabs [data-tab="jobs"]').innerHTML = `Jobs${newCount ? `<span class="badge">${newCount}</span>` : ""}`;
  $("#meta").textContent = DATA.updated_at ? `${DATA.jobs.length} jobs · updated ${ago(DATA.updated_at)}` : "";
  main.querySelectorAll("#importFile").forEach((el) => el.addEventListener("change", importBackup));
}

function go(t) { tab = t; location.hash = t; window.scrollTo(0, 0); render(); }
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.tab); });
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t && t !== tab && ["jobs", "tracker", "outreach", "settings"].includes(t)) { tab = t; render(); } });

$("#main").addEventListener("click", async (e) => {
  const chipBtn = e.target.closest(".chip[data-f]");
  if (chipBtn) { filters[chipBtn.dataset.f] = chipBtn.dataset.v; render(); return; }
  const tabLink = e.target.closest("a[data-tab]");
  if (tabLink) { e.preventDefault(); go(tabLink.dataset.tab); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const card = btn.closest("[data-id]"); const id = card?.dataset.id;
  const ccard = btn.closest("[data-cid]"); const contact = state.contacts.find((c) => c.id === ccard?.dataset.cid);

  if (act === "apply") { window.open(jobById(id).url, "_blank", "noopener"); markApplied(id); render(); }
  else if (act === "save") { const cur = state.jobs[id]?.status; setJob(id, { status: cur === "saved" ? undefined : "saved" }); render(); }
  else if (act === "skip") { const before = state.jobs[id] ? { ...state.jobs[id] } : null; setJob(id, { status: "dismissed" }); render(); toast("Hidden.", () => { if (before) state.jobs[id] = before; else delete state.jobs[id]; }); }
  else if (act === "why") { await withBusy("why:" + id, async () => { state.ai[id] = { why: await llm(prompts.why(jobById(id), profileText())) }; save(); }); }
  else if (act === "outreach") { const j = jobById(id); ui.outreach.company = j?.company || ""; ui.outreach.jobId = id; go("outreach"); }
  else if (act === "scoreAll") {
    await withBusy("score", async () => {
      const todo = sortJobs(filterJobs(DATA.jobs, filters, state.jobs, state.fits, prevVisit), "newest", state.fits).filter((j) => !j.fit && !state.fits[j.id]).slice(0, 40);
      for (let i = 0; i < todo.length; i += 10) {
        const out = parseJSON(await llm(prompts.score(todo.slice(i, i + 10), profileText()), 0));
        for (const r of out) if (r?.id) state.fits[r.id] = { score: Math.max(1, Math.min(10, +r.score || 5)), reason: String(r.reason || "").slice(0, 200), highlight: String(r.highlight || "").slice(0, 160) };
        save();
      }
      toast(`Scored ${todo.length} jobs.`);
    });
  }
  else if (act === "untrack") { delete state.jobs[id]; save(); render(); }
  else if (act === "addManual") {
    const title = $("#m-title").value.trim(), company = $("#m-company").value.trim();
    if (!title) return toast("Title is required.");
    const mid = "manual-" + Date.now();
    state.jobs[mid] = { status: "applied", appliedAt: $("#m-date").value || todayISO(), stage: "applied", followUp: addDays($("#m-date").value || todayISO(), 7),
                        snap: { title, company, url: $("#m-url").value.trim(), location: "", type: "fulltime" } };
    save(); render();
  }
  else if (act === "exportCsv") {
    const rows = Object.entries(state.jobs).filter(([, v]) => v.status === "applied").map(([jid, v]) => { const j = jobById(jid) || v.snap || {}; return { title: j.title, company: j.company, url: j.url, applied: v.appliedAt, stage: v.stage, followUp: v.followUp, notes: v.notes }; });
    download("applications.csv", toCSV(rows, ["title", "company", "url", "applied", "stage", "followUp", "notes"]), "text/csv");
  }
  else if (act === "addContact") {
    const c = { id: "c" + Date.now(), name: $("#c-name").value.trim(), role: $("#c-role").value.trim(), company: $("#c-company").value.trim(), email: $("#c-email").value.trim(),
                linkedin: $("#c-linkedin").value.trim(), jobId: $("#c-job").value, status: "to_contact", drafts: {} };
    if (!c.name && !c.linkedin && !c.email) return toast("Give at least a name, email or LinkedIn URL.");
    state.contacts.unshift(c); save(); render();
  }
  else if (act === "cdel" && contact) { state.contacts = state.contacts.filter((c) => c !== contact); save(); render(); }
  else if (act === "draft" && contact) {
    const k = btn.dataset.k;
    await withBusy(`draft:${contact.id}:${k}`, async () => { contact.drafts = contact.drafts || {}; contact.drafts[k] = await llm(prompts[k](contact, contact.jobId ? jobById(contact.jobId) : null, profileText()), 0.5); save(); });
  }
  else if (act === "sent" && contact) { contact.status = contact.status === "to_contact" ? "messaged" : contact.status; contact.lastContact = todayISO(); contact.followUp = addDays(todayISO(), 7); save(); render(); toast("Logged. Follow-up in 7 days."); }
  else if (act === "copy" && contact) { await navigator.clipboard.writeText(contact.drafts?.[btn.dataset.k] || ""); toast("Copied."); }
  else if (act === "copyText") { await navigator.clipboard.writeText(btn.dataset.text); toast("Copied."); }
  else if (act === "saveProfile") { for (const k of Object.keys(state.profile)) state.profile[k] = $("#p-" + k).value.trim(); save(); toast("Profile saved."); }
  else if (act === "saveKey") { state.settings.key = $("#s-key").value.trim(); state.settings.model = $("#s-model").value.trim() || DEFAULTS.settings.model; save(); toast("Saved."); render(); }
  else if (act === "testKey") { state.settings.key = $("#s-key").value.trim(); state.settings.model = $("#s-model").value.trim() || DEFAULTS.settings.model; save(); await withBusy("test", async () => { toast("Key works: " + (await llm("Reply with the single word OK.", 0)).slice(0, 40)); }); }
  else if (act === "exportJson") download(`jobhunt-backup-${todayISO()}.json`, JSON.stringify(state, null, 1), "application/json");
  else if (act === "reset") { if (confirm("Delete all applications, contacts, drafts and settings from this browser?")) { localStorage.removeItem(LS); state = structuredClone(DEFAULTS); render(); } }
});

$("#main").addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "sort") { filters.sort = el.value; render(); }
  else if (el.id === "minFit") { filters.minFit = +el.value; render(); }
  else if (el.id === "source") { filters.source = el.value; render(); }
  const id = el.closest("[data-id]")?.dataset.id;
  if (id && el.dataset.act === "stage") { setJob(id, { stage: el.value, followUp: ["offer", "rejected"].includes(el.value) ? "" : state.jobs[id].followUp }); render(); }
  if (id && el.dataset.act === "followUp") { setJob(id, { followUp: el.value }); render(); }
  const contact = state.contacts.find((c) => c.id === el.closest("[data-cid]")?.dataset.cid);
  if (contact && el.dataset.act === "cstatus") { contact.status = el.value; if (["replied", "closed"].includes(el.value)) contact.followUp = ""; save(); render(); }
});

let typing;
$("#main").addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "q") { clearTimeout(typing); typing = setTimeout(() => { filters.q = el.value; render(); $("#q")?.focus(); $("#q")?.setSelectionRange(1e4, 1e4); }, 250); return; }
  if (el.id?.startsWith("o-")) { ui.outreach[el.id.slice(2)] = el.value; if (["company", "role", "city", "first", "last", "domain"].includes(el.id.slice(2))) { clearTimeout(typing); typing = setTimeout(() => { const f = el.id; render(); $("#" + f)?.focus(); $("#" + f)?.setSelectionRange(1e4, 1e4); }, 400); } return; }
  const id = el.closest("[data-id]")?.dataset.id;
  if (id && el.dataset.act === "notes") { state.jobs[id].notes = el.value; save(); }
  const contact = state.contacts.find((c) => c.id === el.closest("[data-cid]")?.dataset.cid);
  if (contact && el.dataset.act === "editDraft") { contact.drafts[el.dataset.k] = el.value; save(); }
});

function download(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function importBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  file.text().then((t) => { const d = JSON.parse(t); if (!d.jobs || !d.contacts) throw new Error("not a JobHunt backup"); state = { ...structuredClone(DEFAULTS), ...d }; save(); render(); toast("Backup imported."); }).catch((err) => toast("Import failed: " + err.message));
}

// ---------------------------------------------------------------- boot
(async () => {
  try {
    const r = await fetch("data/jobs.json", { cache: "no-store" });
    if (r.ok) DATA = await r.json();
  } catch { /* offline: show what we can */ }
  render();
  state.settings.lastVisit = todayISO(); save();
})();
