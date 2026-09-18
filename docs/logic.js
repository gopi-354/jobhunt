// Pure helpers. No DOM, no storage. Tested in tests/logic.test.js with node.

export const STAGES = ["applied", "replied", "interview", "offer", "rejected", "ghosted"];
export const CONTACT_STATUS = ["to_contact", "messaged", "replied", "call_done", "closed"];

export function daysAgo(iso, today = new Date()) {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return Math.max(0, Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000));
}

export function ago(iso, today = new Date()) {
  const n = daysAgo(iso, today);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 7) return `${n}d ago`;
  if (n < 30) return `${Math.floor(n / 7)}w ago`;
  return `${Math.floor(n / 30)}mo ago`;
}

export function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Jobs list filtering. `f` = {q, type, where, source, show, minFit}; `states` = per-job user state; `fits` = client-side scores.
export function filterJobs(jobs, f, states, fits, lastVisit) {
  const q = (f.q || "").toLowerCase().trim();
  return jobs.filter((j) => {
    const st = states[j.id]?.status;
    if (f.show === "new" && lastVisit && j.first_seen < lastVisit) return false;
    if (f.show !== "all" && (st === "dismissed" || st === "applied")) return false;
    if (f.show === "saved" && st !== "saved") return false;
    if (f.type !== "all" && j.type !== f.type) return false;
    if (f.where === "bangalore" && !j.bangalore) return false;
    if (f.where === "remote" && !j.remote) return false;
    if (f.source !== "all" && j.source !== f.source) return false;
    const fit = j.fit || fits[j.id];
    if (f.minFit > 0 && (!fit || fit.score < f.minFit)) return false;
    if (q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function sortJobs(jobs, by, fits) {
  const score = (j) => (j.fit || fits[j.id])?.score ?? -1;
  const date = (j) => j.posted_at || j.first_seen || "";
  return [...jobs].sort((a, b) => (by === "newest" ? date(b).localeCompare(date(a)) || score(b) - score(a)
                                                     : score(b) - score(a) || date(b).localeCompare(date(a))));
}

export function trackerSummary(states, today = todayISO()) {
  const rows = Object.values(states).filter((s) => s.status === "applied");
  const week = addDays(today, -7);
  return {
    total: rows.length,
    thisWeek: rows.filter((s) => (s.appliedAt || "") >= week).length,
    waiting: rows.filter((s) => (s.stage || "applied") === "applied").length,
    interviews: rows.filter((s) => s.stage === "interview").length,
    followUpsDue: rows.filter((s) => s.followUp && s.followUp <= today && !["offer", "rejected"].includes(s.stage)).length,
  };
}

export function gmailUrl(to, subject, body) {
  const p = new URLSearchParams({ view: "cm", fs: "1", to: to || "", su: subject || "", body: body || "" });
  return `https://mail.google.com/mail/?${p}`;
}

export function mailtoUrl(to, subject, body) {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;
}

export function peopleSearchLinks(company, role = "data scientist", city = "Bengaluru") {
  const e = encodeURIComponent;
  const c = (company || "").trim();
  return [
    { label: `LinkedIn: ${role}s at ${c || "company"}`, url: `https://www.linkedin.com/search/results/people/?keywords=${e(`${c} ${role}`)}&origin=GLOBAL_SEARCH_HEADER` },
    { label: `LinkedIn: ${c || "company"} people in ${city}`, url: `https://www.linkedin.com/search/results/people/?keywords=${e(`${c} ${city}`)}&origin=GLOBAL_SEARCH_HEADER` },
    { label: `LinkedIn: recruiters / talent at ${c || "company"}`, url: `https://www.linkedin.com/search/results/people/?keywords=${e(`${c} recruiter OR "talent acquisition"`)}&origin=GLOBAL_SEARCH_HEADER` },
    { label: "Google X-ray (profiles, no login wall)", url: `https://www.google.com/search?q=${e(`site:linkedin.com/in "${c}" ("data scientist" OR "machine learning" OR "analytics") ${city}`)}` },
    { label: `LinkedIn jobs at ${c || "company"}`, url: `https://www.linkedin.com/jobs/search/?keywords=${e(c)}&location=${e(city)}` },
    { label: "Careers page", url: `https://www.google.com/search?q=${e(`"${c}" careers`)}` },
  ];
}

export function emailPatterns(first, last, domain) {
  const f = (first || "").toLowerCase().replace(/[^a-z]/g, "");
  const l = (last || "").toLowerCase().replace(/[^a-z]/g, "");
  const d = (domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!f || !d) return [];
  const locals = l ? [`${f}.${l}`, `${f}`, `${f}${l}`, `${f[0]}${l}`, `${f}_${l}`, `${f[0]}.${l}`, `${l}.${f}`] : [f];
  return [...new Set(locals)].map((x) => `${x}@${d}`);
}

export function toCSV(rows, cols) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function parseJSON(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const aa = s.indexOf("["), bb = s.lastIndexOf("]");
  const arrFirst = aa !== -1 && (a === -1 || aa < a);
  return JSON.parse(arrFirst ? s.slice(aa, bb + 1) : s.slice(a, b + 1));
}

export const prompts = {
  why: (job, profile) => `Candidate profile:\n${profile}\n\nJob: ${job.title} at ${job.company} (${job.location}, ${job.type}).\n${job.snippet ? "Snippet: " + job.snippet : ""}\n\nIn plain text, no markdown headers:\n1) Fit (one line, honest).\n2) Gaps or risks (one line).\n3) Three bullet points on what to emphasize in the application, specific to this role.\n4) One sentence: the single best first step (apply / find referral / skip).`,
  email: (contact, job, profile) => `Write a cold email from an entry-level data science candidate in Bengaluru. Profile:\n${profile}\n\nTo: ${contact.name || "a person"}, ${contact.role || "role unknown"} at ${contact.company || job?.company || "the company"}.\n${job ? `Context: they are hiring "${job.title}" (${job.url}).` : "Context: no specific opening; asking about data/AI roles or a referral."}\n\nRules: subject line first as "Subject: ...", then the body. Under 120 words. One specific, genuine reason for writing to THIS person or company. Ask for one small thing (a referral, or 15 minutes of advice). No flattery, no buzzwords, no "I hope this email finds you well". Sign with the candidate's name from the profile.`,
  note: (contact, job, profile) => `Write a LinkedIn connection request note (max 280 characters, plain text) from an entry-level data science candidate in Bengaluru to ${contact.name || "someone"} (${contact.role || ""} at ${contact.company || job?.company || ""}). ${job ? `They are hiring "${job.title}".` : ""} Profile: ${profile.slice(0, 600)}. Be specific and human, ask for nothing more than a connect or a quick pointer.`,
  followup: (contact, job, profile) => `Write a polite follow-up message (max 60 words) to ${contact.name || "the contact"} at ${contact.company || job?.company || ""} who has not replied in a week to a message about ${job ? `the "${job.title}" role` : "data/AI roles"}. From: ${profile.split("\n")[0]}. One line of new value or context, one clear ask, no guilt.`,
  score: (jobs, profile) => `Candidate profile:\n${profile}\n\nScore each job 1-10 for an entry-level candidate (10 = apply today; penalize 3+ years or unrelated domain). Reply with ONLY a JSON array of objects {"id","score","reason"(max 20 words),"highlight"(max 15 words: what to emphasize)}.\n\nJobs:\n${jobs.map((j) => `- id=${j.id} | ${j.title} | ${j.company} | ${j.location} | ${j.type} | ${(j.snippet || "").slice(0, 200)}`).join("\n")}`,
};
