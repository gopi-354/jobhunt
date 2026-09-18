import test from "node:test";
import assert from "node:assert/strict";
import { ago, addDays, emailPatterns, filterJobs, gmailUrl, parseJSON, sortJobs, trackerSummary, toCSV } from "../docs/logic.js";

const T = new Date("2026-09-18T12:00:00Z");
const jobs = [
  { id: "a", title: "Data Scientist", company: "Acme", location: "Bengaluru", bangalore: true, remote: false, type: "fulltime", source: "linkedin", first_seen: "2026-09-18", posted_at: "2026-09-17", fit: { score: 8 } },
  { id: "b", title: "ML Intern", company: "Beta", location: "Remote, India", bangalore: false, remote: true, type: "internship", source: "internshala", first_seen: "2026-09-10", posted_at: "2026-09-10", fit: null },
  { id: "c", title: "AI Engineer", company: "Gamma", location: "Pune", bangalore: false, remote: false, type: "fulltime", source: "greenhouse", first_seen: "2026-09-12", posted_at: null, fit: { score: 4 } },
];
const F = { q: "", type: "all", where: "all", source: "all", show: "open", minFit: 0 };

test("dates", () => {
  assert.equal(ago("2026-09-18", T), "today");
  assert.equal(ago("2026-09-15", T), "3d ago");
  assert.equal(ago("2026-08-20", T), "4w ago");
  assert.equal(addDays("2026-09-30", 3), "2026-10-03");
});

test("filter and sort", () => {
  assert.deepEqual(filterJobs(jobs, F, {}, {}, null).map((j) => j.id), ["a", "b", "c"]);
  assert.deepEqual(filterJobs(jobs, F, { a: { status: "applied" }, c: { status: "dismissed" } }, {}, null).map((j) => j.id), ["b"]);
  assert.deepEqual(filterJobs(jobs, { ...F, where: "bangalore" }, {}, {}, null).map((j) => j.id), ["a"]);
  assert.deepEqual(filterJobs(jobs, { ...F, type: "internship" }, {}, {}, null).map((j) => j.id), ["b"]);
  assert.deepEqual(filterJobs(jobs, { ...F, minFit: 6 }, {}, { b: { score: 9 } }, null).map((j) => j.id), ["a", "b"]);
  assert.deepEqual(filterJobs(jobs, { ...F, show: "new" }, {}, {}, "2026-09-15").map((j) => j.id), ["a"]);
  assert.deepEqual(filterJobs(jobs, { ...F, q: "gamma" }, {}, {}, null).map((j) => j.id), ["c"]);
  assert.deepEqual(sortJobs(jobs, "fit", {}).map((j) => j.id), ["a", "c", "b"]);
  assert.deepEqual(sortJobs(jobs, "fit", { b: { score: 9 } }).map((j) => j.id), ["b", "a", "c"]);
  assert.deepEqual(sortJobs(jobs, "newest", {}).map((j) => j.id), ["a", "c", "b"]);
});

test("tracker summary", () => {
  const s = trackerSummary({
    a: { status: "applied", appliedAt: "2026-09-17", stage: "applied", followUp: "2026-09-18" },
    b: { status: "applied", appliedAt: "2026-09-01", stage: "interview" },
    c: { status: "saved" },
  }, "2026-09-18");
  assert.deepEqual(s, { total: 2, thisWeek: 1, waiting: 1, interviews: 1, followUpsDue: 1 });
});

test("outreach helpers", () => {
  assert.deepEqual(emailPatterns("Priya", "Sharma", "https://www.acme.com/about"),
    ["priya.sharma@acme.com", "priya@acme.com", "priyasharma@acme.com", "psharma@acme.com", "priya_sharma@acme.com", "p.sharma@acme.com", "sharma.priya@acme.com"]);
  assert.deepEqual(emailPatterns("", "x", "acme.com"), []);
  assert.ok(gmailUrl("a@b.com", "Hi there", "line1\nline2").includes("su=Hi+there"));
  assert.equal(toCSV([{ a: 1, b: 'say "hi"' }], ["a", "b"]), 'a,b\n"1","say ""hi"""');
  assert.deepEqual(parseJSON('```json\n[{"id":"a","score":7}]\n```'), [{ id: "a", score: 7 }]);
  assert.deepEqual(parseJSON('Sure! {"x":1}'), { x: 1 });
});
