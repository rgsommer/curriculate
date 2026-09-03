// Unit tests for the pure (non-UrlFetchApp, non-SpreadsheetApp) parts of Code.gs.
//
// Apps Script has no test runner, so Code.gs is loaded as text, given an export
// footer, and required as CommonJS. Anything touching UrlFetchApp or
// SpreadsheetApp is exercised through a stub instead.
//
//   node extensions/edsby-bdays-apps-script/test-parsing.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "Code.gs"), "utf8");
const shim = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bdays-")), "code.cjs");
fs.writeFileSync(shim, src + `
module.exports = {
  CONFIG, collectStudentRecords_, extractGroupFromClasses_, unwrapSlice_,
  describeShape_, countCookies_, edsbyErrorCode_, edsbyErrorStr_,
  explainStatus_, findUserNid_, writeStudents_, extractStudent_,
  extractParentEmail_, harvestNavLinksFromText_, findUserNidInText_,
  STUDENT_VIEW_RE, STUDENT_LIST_VIEWS, isPlausibleNid_, identityCandidates_,
  sidOf_, sidsInSetCookie_, classifySetCookie_, explainStatusShort_,
  groupTokenOf_, isHomeroomClass_, ownedColumns_, clearImportedColumns_,
  planSync_, nameKey_, rowValuesFor_, writeRowValues_,
};
`);
const M = createRequire(import.meta.url)(shim);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n    got ${a}\n    exp ${b}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const group = (n) => console.log("\n" + n);

// ── The ZoomMyStudents row table ────────────────────────────────────────────
// Shape recorded from bcs.edsby.com; see backend/behavior/lib/edsbyRead.js.
group("ZoomMyStudents parsing");
const zoom = { slices: [{ data: { zoom: { data: { table: { rec: {
  r1001: { nid: 1001, FirstName: "Ada", PrefName: "Ada", LastName: "Byron", Grade: "8",
           Classes: [{ PrefName: "HR8B", LastName: "Homeroom - 8B" }, { PrefName: "MATH8B" }] },
  r1002: { nid: 1002, FirstName: "Alan", LastName: "Turing", Grade: "7",
           Classes: [{ PrefName: "MATH7A", LastName: "Mathematics 7A" }] },
  r1003: { nid: 1003, FirstName: "Grace", LastName: "Hopper", Grade: "6", Classes: [] },
} } } } } }] };
const recs = M.collectStudentRecords_(M.unwrapSlice_(zoom));
eq("finds all students", recs.length, 3);
eq("parses nids", recs.map((r) => r.nid).sort(), [1001, 1002, 1003]);
const deepRec = { rec: { r7: { nid: 7 }, r8: { nid: 8 }, r9: { nid: 9 } } };
eq("rec map found at a different depth",
   M.collectStudentRecords_(M.unwrapSlice_({ slices: [{ data: { a: { b: { c: deepRec } } } }] })).length, 3);
const noRec = { list: [{ nid: 55, nodetype: 1, nodesubtype: 5 }, { nid: 56, role: "Student" }] };
eq("deep-walk fallback when no rec map",
   M.collectStudentRecords_(M.unwrapSlice_({ slices: [{ data: noRec }] })).map((r) => r.nid).sort(),
   [55, 56]);
eq("null safe", M.collectStudentRecords_(null), []);
eq("unwrap passes through when there are no slices", M.unwrapSlice_({ zoom: 1 }), { zoom: 1 });

// ── Group (class designator) derivation ─────────────────────────────────────
group("Group derivation");
eq("homeroom HR8B -> 8B", M.extractGroupFromClasses_(recs.find((r) => r.nid === 1001).classes), "8B");
eq("no homeroom, MATH7A -> 7A", M.extractGroupFromClasses_(recs.find((r) => r.nid === 1002).classes), "7A");
eq("no classes -> empty", M.extractGroupFromClasses_([]), "");
eq("falls back to the label", M.extractGroupFromClasses_([{ LastName: "Homeroom - 6C", PrefName: "HR6" }]), "6C");

// Class-code shapes taken from the live bcs.edsby.com response (names invented —
// real student data does not belong in the repo).
group("Group tokens (real code shapes)");
eq("HR8A", M.groupTokenOf_({ PrefName: "HR8A", LastName: "Homeroom - 08" }), "8A");
eq("GEO8B", M.groupTokenOf_({ PrefName: "GEO8B", LastName: "Geography - 08" }), "8B");
eq("MATH7B", M.groupTokenOf_({ PrefName: "MATH7B", LastName: "Mathematics - 07" }), "7B");
eq("HIST7C", M.groupTokenOf_({ PrefName: "HIST7C", LastName: "History - 07" }), "7C");
eq("CED8A", M.groupTokenOf_({ PrefName: "CED8A", LastName: "Christian Education - 08" }), "8A");
eq("MLS68Sommer yields nothing (no trailing boundary)",
   M.groupTokenOf_({ PrefName: "MLS68Sommer", LastName: "Learning Skills" }), "");
eq("'Homeroom - 08' alone has no letter", M.groupTokenOf_({ PrefName: "", LastName: "Homeroom - 08" }), "");
ok("HR8A is a homeroom", M.isHomeroomClass_({ PrefName: "HR8A", LastName: "Homeroom - 08" }));
ok("GEO8B is not", !M.isHomeroomClass_({ PrefName: "GEO8B", LastName: "Geography - 08" }));

group("Group derivation uses the student's grade");
const HR8A = { PrefName: "HR8A", LastName: "Homeroom - 08" };
const HR7B = { PrefName: "HR7B", LastName: "Homeroom - 7B" };
const GEO8B = { PrefName: "GEO8B", LastName: "Geography - 08" };
const MATH7B = { PrefName: "MATH7B", LastName: "Mathematics - 07" };
const MLS = { PrefName: "MLS68Sommer", LastName: "Learning Skills" };
const HIST7C = { PrefName: "HIST7C", LastName: "History - 07" };

// The bug this fixes: a real grade-8 student carries a stale 7B homeroom.
// Homeroom-first labelled her "7B"; grade-matching gives "8B".
eq("grade 8 with a stale 7B homeroom -> 8B",
   M.extractGroupFromClasses_([GEO8B, HR7B, MATH7B, MLS], "8"), "8B");
eq("grade 8 with a matching homeroom -> 8A",
   M.extractGroupFromClasses_([HR8A, GEO8B, MLS], "8"), "8A");
eq("grade 8, both homerooms, matching one wins",
   M.extractGroupFromClasses_([HR8A, HR7B, MATH7B], "8"), "8A");
eq("grade 7, single subject class -> 7C",
   M.extractGroupFromClasses_([HIST7C], "7"), "7C");
eq("only an untokenised class -> empty (caller falls back to grade)",
   M.extractGroupFromClasses_([MLS], "8"), "");
eq("no grade given still prefers the homeroom",
   M.extractGroupFromClasses_([GEO8B, HR7B], ""), "7B");
eq("grade with no matching class falls back to the homeroom",
   M.extractGroupFromClasses_([HR7B, MATH7B], "9"), "7B");
eq("numeric grade works like a string",
   M.extractGroupFromClasses_([GEO8B, HR7B], 8), "8B");
eq("'Grade 8' style value works",
   M.extractGroupFromClasses_([GEO8B, HR7B], "Grade 8"), "8B");

// ── Error reporting ─────────────────────────────────────────────────────────
// The payload that prompted this rewrite: HTTP 403 carrying Edsby error 1030.
group("Error reporting");
const e1030 = { error: 1030, when: "2026-09-03 13:57:39", errorstr: "no links to node", ticket: "" };
eq("errorstr extracted", M.edsbyErrorStr_(e1030), "no links to node");
eq("error code extracted", M.edsbyErrorCode_(e1030), 1030);
eq("errorstr inside slices", M.edsbyErrorStr_({ slices: [{ errorstr: "denied" }] }), "denied");
eq("no code when absent", M.edsbyErrorCode_({ slices: [{ data: {} }] }), null);
const msg1030 = M.explainStatus_({ ok: false, status: 403, json: e1030, text: JSON.stringify(e1030) });
ok("1030 reports Edsby's own code and string", msg1030.includes("1030") && msg1030.includes("no links to node"));
ok("1030 does not blame jver/cver", !/jver|cver/i.test(msg1030));
const bare403 = M.explainStatus_({ ok: false, status: 403, json: null, text: "forbidden" });
ok("a code-less 403 suspects the node id before jver/cver",
   bare403.indexOf("node id") < bare403.indexOf("JVER"));
ok("expired session", M.explainStatus_({ sessionExpired: true, status: 401 }).includes("Session expired"));
eq("healthy response", M.explainStatus_({ ok: true, status: 200, json: { slices: [{ data: {} }] } }), "OK.");

// ── Diagnostic helpers ──────────────────────────────────────────────────────
group("Diagnostic helpers");
eq("one cookie", M.countCookies_("session_id_edsby=abc"), 1);
eq("full Cookie header", M.countCookies_("session_id_edsby=abc; _ga=1; foo=bar"), 3);
eq("describeShape", M.describeShape_({ a: 1, b: 2 }), "{a,b}");
eq("finds userid", M.findUserNid_({ env: { userid: "9912345" } }), "9912345");
eq("finds nested userNid", M.findUserNid_({ a: { b: { userNid: "445566" } } }), "445566");
eq("ignores implausibly short ids", M.findUserNid_({ uid: "7" }), "");
eq("userNid null safe", M.findUserNid_(null), "");

// ── Nav-link harvesting ─────────────────────────────────────────────────────
group("Nav-link harvesting");
const H = (t) => M.harvestNavLinksFromText_(t).map((l) => l.view + "/" + l.nid);
eq("HTML href", H('<a href="/p/ZoomMyStudents/21471167">x</a>'), ["ZoomMyStudents/21471167"]);
eq("escaped-slash JSON url", H('"url":"\\/p\\/ZoomMyStudents\\/9988776"'), ["ZoomMyStudents/9988776"]);
eq("plain and escaped forms agree", H('/p/ZoomMyStudents/1111222'), H('\\/p\\/ZoomMyStudents\\/1111222'));
eq("xds then nid", H('{"xds":"ZoomMyStudents","nid":33445566}'), ["ZoomMyStudents/33445566"]);
eq("xds then nid, keys apart",
   H('{"xds":"ZoomMyStudents","label":"My Students","nid":"7778889"}'), ["ZoomMyStudents/7778889"]);
eq("nid then xds", H('{"nid":44556677,"xds":"ZoomMyStudents"}'), ["ZoomMyStudents/44556677"]);
eq("dedupes", H("/p/ZoomMyStudents/555666 /p/ZoomMyStudents/555666").length, 1);
eq("rejects short ids", H("/p/ZoomMyStudents/12"), []);
eq("null safe", H(null), []);
ok("does not leak an nid across objects",
   !H('{"xds":"ZoomMyStudents"},{"o":1},{"nid":999888}').includes("ZoomMyStudents/999888"));

// The point of harvesting ANY view, not just ZoomMyStudents: an account whose
// students live under a differently-named view must still be discoverable.
eq("captures other views too",
   H('<a href="/p/SchoolStudents/24880031">All</a><a href="/p/ZoomTeacherClasses/555111">Classes</a>').sort(),
   ["SchoolStudents/24880031", "ZoomTeacherClasses/555111"]);
eq("HTML nav + JSON nav in one blob",
   H('<a href="/p/ZoomMyStudents/21471167">Old</a>' +
     '{"nav":[{"xds":"SchoolStudents","name":"Students","nid":24880031}]}').sort(),
   ["SchoolStudents/24880031", "ZoomMyStudents/21471167"]);

group("Student-view classification");
for (const v of ["ZoomMyStudents", "SchoolStudents", "Students", "ClassStudents", "MyStudents"]) {
  ok(v + " counts as a student view", M.STUDENT_VIEW_RE.test(v));
}
for (const v of ["Home", "Panorama", "ZoomTeacherClasses", "Calendar"]) {
  ok(v + " does not", !M.STUDENT_VIEW_RE.test(v));
}
ok("every configured list view classifies as one",
   M.STUDENT_LIST_VIEWS.every((v) => M.STUDENT_VIEW_RE.test(v)));

group("User-nid detection");
eq("from JSON", M.findUserNid_({ env: { userid: "9912345" } }), "9912345");
eq("from nested JSON", M.findUserNid_({ a: { b: { userNid: "445566" } } }), "445566");
eq("ignores implausibly short ids", M.findUserNid_({ uid: "7" }), "");
eq("JSON null safe", M.findUserNid_(null), "");
eq("from raw text", M.findUserNidInText_('window._cf={"userid":21470001};'), "21470001");
eq("from quoted text", M.findUserNidInText_("usernid = '9988776'"), "9988776");
eq("text null safe", M.findUserNidInText_(null), "");
eq("text ignores short ids", M.findUserNidInText_('"uid":42'), "");

// ── Redirect handling ───────────────────────────────────────────────────────
// The HTML app shell 302s; not following it returns an empty body, which is
// why discovery originally found nothing. req_ must expose the override.
group("Redirect handling");
const reqSrc = src.slice(src.indexOf("function req_("), src.indexOf("function edsbyGetJson_("));
ok("req_ defaults to not following redirects", /followRedirects: o\.followRedirects === true/.test(reqSrc));
ok("the HTML shell fetch opts in", /followRedirects: true,/.test(src));
ok("only the HTML shell fetches opt in", (src.match(/followRedirects: true,/g) || []).length <= 2);

// ── 1030 messaging ──────────────────────────────────────────────────────────
// bootstrap answers unauthenticated, so a 200 from it must never be presented
// as proof the cookie works — that false premise produced a wrong diagnosis.
group("1030 messaging");
const m1030 = M.explainStatus_({ ok: false, status: 403, json: e1030, text: "" });
// The three 1030 variants seen live mean three different things.
ok("'no links to node' = stale cookie", /session cookie is stale/i.test(m1030));
ok("  ...and explains why nothing else catches it",
   /rather than a 401/i.test(m1030) && /bootstrap keeps/i.test(m1030));
ok("  ...and gives the fix", /copy a CURRENT/i.test(m1030));
const mDenied = M.explainStatus_({ status: 403, json: { error: 1030, errorstr: "denied nodetype(xds=ZoomMyStudents)" } });
ok("'denied nodetype' = authenticated, wrong role",
   /ARE authenticated/i.test(mDenied) && /School Teacher/i.test(mDenied));
ok("  ...and is not called a stale cookie", !/cookie is stale/i.test(mDenied));
const mNoXds = M.explainStatus_({ status: 403, json: { error: 1030, errorstr: "denied(xds not found)" } });
ok("'xds not found' = the view does not exist", /does not exist/i.test(mNoXds));
ok("  ...and is not called a stale cookie", !/cookie is stale/i.test(mNoXds));
ok("drops the 'session is valid' claim", !/session is valid/i.test(m1030));
ok("drops 'NOT a credential problem'", !/NOT a credential problem/i.test(m1030));
ok("that verdict is gone from Code.gs entirely", !/session cookie is VALID/i.test(src));

// ── Short status lines ──────────────────────────────────────────────────────
// The long explanation repeated once per probe row buried the signal under
// ~3 KB of duplicate text; rows now get one line and the detail prints once.
group("Short status lines");
eq("1030 in one line", M.explainStatusShort_({ status: 403, json: e1030 }),
   'HTTP 403 · Edsby 1030 "no links to node"');
ok("short form is short", M.explainStatusShort_({ status: 403, json: e1030 }).length < 60);
ok("full form stays detailed", M.explainStatus_({ status: 403, json: e1030 }).length > 200);
eq("expired", M.explainStatusShort_({ sessionExpired: true, status: 401 }),
   "session expired (login page returned)");
eq("plain status", M.explainStatusShort_({ status: 500, json: null }), "HTTP 500");
eq("non-JSON 200", M.explainStatusShort_({ status: 200, json: null }), "HTTP 200, non-JSON body");
ok("network error names the cause",
   /network error/.test(M.explainStatusShort_({ status: 0, text: "timeout" })));

// ── Node-id plausibility ────────────────────────────────────────────────────
// A bare /\d{4,}/ matched the timestamp "054748" out of a 200 KB bootstrap and
// was then used as a user nid, making every Home request fail with error 1030.
group("Node-id plausibility");
ok("accepts a real nid", M.isPlausibleNid_("21471167"));
ok("accepts a 6-digit nid", M.isPlausibleNid_("214711"));
ok("rejects a leading zero (the 054748 bug)", !M.isPlausibleNid_("054748"));
ok("rejects too short", !M.isPlausibleNid_("4748"));
ok("rejects too long", !M.isPlausibleNid_("12345678901"));
ok("rejects non-numeric", !M.isPlausibleNid_("21a71167"));
ok("rejects empty", !M.isPlausibleNid_(""));
ok("rejects null", !M.isPlausibleNid_(null));
eq("text scan skips the timestamp and keeps a real nid",
   M.findUserNidInText_('{"t":"05:47:48","uid":054748,"userid":21470001}'), "21470001");
eq("text scan returns nothing when only implausible ids exist",
   M.findUserNidInText_('{"uid":054748}'), "");

group("Identity candidates");
const bootLike = { config: { version: 9 }, me: { nid: 21470001, name: "Richard Sommer", role: "Teacher" },
                   junk: { nid: "000123", name: "bad" }, list: [{ nid: 21470002, name: "Someone Else" }] };
const cands = M.identityCandidates_(bootLike, 10);
ok("finds the signed-in person", cands.some((c) => c.nid === "21470001" && /Sommer/.test(c.name)));
ok("finds others too", cands.some((c) => c.nid === "21470002"));
ok("excludes the leading-zero nid", !cands.some((c) => c.nid === "000123"));
eq("anonymous bootstrap yields nothing", M.identityCandidates_({ config: { a: 1 } }, 10), []);
eq("respects the limit", M.identityCandidates_(bootLike, 1).length, 1);
eq("null safe", M.identityCandidates_(null, 5), []);

// ── Set-Cookie classification ───────────────────────────────────────────────
// The decisive test for a dead cookie: Edsby handing back a different session.
group("Set-Cookie classification");
eq("reads our sid", M.sidOf_("session_id_edsby=abc123; other=1"), "abc123");
eq("no sid", M.sidOf_("other=1"), "");
eq("sid from a string header", M.sidsInSetCookie_({ "Set-Cookie": "session_id_edsby=xyz; Path=/" }), ["xyz"]);
eq("sid from an array header",
   M.sidsInSetCookie_({ "Set-Cookie": ["a=1", "session_id_edsby=xyz; HttpOnly"] }), ["xyz"]);
eq("lowercase header name", M.sidsInSetCookie_({ "set-cookie": "session_id_edsby=q" }), ["q"]);
eq("none", M.sidsInSetCookie_({ "Set-Cookie": "a=1" }), []);
eq("absent header", M.sidsInSetCookie_({}), []);
eq("same sid means accepted",
   M.classifySetCookie_({ "Set-Cookie": "session_id_edsby=abc" }, "abc").kind, "same");
eq("different sid means rejected",
   M.classifySetCookie_({ "Set-Cookie": "session_id_edsby=zzz" }, "abc").kind, "replaced");
ok("the rejected verdict says the cookie is dead",
   /cookie is dead/i.test(M.classifySetCookie_({ "Set-Cookie": "session_id_edsby=zzz" }, "abc").note));
eq("no header is not a rejection", M.classifySetCookie_({}, "abc").kind, "none");

// ── Panorama extraction ─────────────────────────────────────────────────────
group("Panorama extraction");
const pano = {
  name: "Ada Byron",
  col3: { info: { lastname: "Byron", prefname: "Ada", grade: "8", gender: "F", birthday: "2010-04-01",
                  homeroom: { data: { teacher: [{ name: "Mr. Richard Sommer" }] } } } },
  col1: { parents: { parents: {
    p1: { nid: "5001", profpicname: { name: { role: "Mother", name: "Anne Byron" } } },
    p2: { nid: "5002", profpicname: { name: { role: "Father", name: "George Byron" } } },
  } } },
};
const st = M.extractStudent_(pano);
eq("last name", st.lastName, "Byron");
eq("dob", st.dob, "2010-04-01");
eq("homeroom teacher", st.firstHomeroomTeacher, "Mr. Richard Sommer");
eq("mother matched", [st.momNid, st.momName], ["5001", "Anne Byron"]);
eq("father matched", [st.dadNid, st.dadName], ["5002", "George Byron"]);
eq("parent email, account path",
   M.extractParentEmail_({ col1: { col1: { account: { email: "a@b.com" } } } }), "a@b.com");
eq("parent email, info fallback",
   M.extractParentEmail_({ col2: { info: { email: "c@d.com" } } }), "c@d.com");
eq("parent email, absent", M.extractParentEmail_({}), "");

// ── Clearing only what we own ───────────────────────────────────────────────
// The original clear spanned 1..getLastColumn(), wiping ten columns the import
// never rewrites — including column T, the formula the config promises to
// leave alone.
group("Clear only imported columns");
eq("owned columns, sorted and de-duplicated", M.ownedColumns_(), [1, 2, 5, 6, 7, 8, 14, 16, 17, 19, 21]);
const cleared = [];
const clearSheet = {
  getLastRow: () => 40,
  getRange: (r, c, nr, nc) => ({ clearContent: () => cleared.push({ col: c, row: r, rows: nr, cols: nc }) }),
};
M.clearImportedColumns_(clearSheet);
eq("clears each owned column", cleared.map((c) => c.col), [1, 2, 5, 6, 7, 8, 14, 16, 17, 19, 21]);
eq("one column wide each", [...new Set(cleared.map((c) => c.cols))], [1]);
eq("starts at the first data row", [...new Set(cleared.map((c) => c.row))], [M.CONFIG.DATA_START_ROW]);
eq("spans to the last row", [...new Set(cleared.map((c) => c.rows))], [40 - M.CONFIG.DATA_START_ROW + 1]);
for (const col of [3, 4, 9, 10, 11, 12, 13, 15, 18, 20]) {
  ok(`column ${col} is never cleared`, !cleared.some((c) => c.col === col));
}
const noRows = [];
M.clearImportedColumns_({ getLastRow: () => 2, getRange: () => ({ clearContent: () => noRows.push(1) }) });
eq("empty sheet clears nothing", noRows.length, 0);

// ── Sync planning ───────────────────────────────────────────────────────────
// Former grade 8s and departed students used to vanish silently, because a
// wipe-and-rewrite cannot tell "left" from "never here". The Edsby nid in
// column U makes the three cases separable.
group("Sync planning");
const row = (r, nid, last, first) => ({ row: r, nid, lastName: last, firstName: first });
const stu = (nid, last, first) => ({ nid, lastName: last, prefFirst: first });

// Steady state: everyone matches by nid.
let plan = M.planSync_(
  [row(4, "1001", "Byron", "Ada"), row(5, "1002", "Turing", "Alan")],
  [stu("1001", "Byron", "Ada"), stu("1002", "Turing", "Alan")]);
eq("all matched, none added or archived",
   [plan.updates.length, plan.appends.length, plan.archives.length], [2, 0, 0]);
eq("updates carry the sheet row", plan.updates.map((u) => u.row), [4, 5]);

// A departed student and a new arrival in the same run.
plan = M.planSync_(
  [row(4, "1001", "Byron", "Ada"), row(5, "1002", "Turing", "Alan")],
  [stu("1001", "Byron", "Ada"), stu("1003", "Hopper", "Grace")]);
eq("the leaver is archived, not deleted", plan.archives.map((a) => a.row), [5]);
eq("the arrival is appended", plan.appends.map((s) => s.nid), ["1003"]);
eq("the stayer is updated", plan.updates.map((u) => u.row), [4]);

// First merge run: the sheet has no nids yet, so it must adopt them by name
// rather than archiving every existing row.
plan = M.planSync_(
  [row(4, "", "Byron", "Ada"), row(5, "", "Turing", "Alan")],
  [stu("1001", "Byron", "Ada"), stu("1002", "Turing", "Alan")]);
eq("adopts existing rows by name", plan.updates.map((u) => u.row), [4, 5]);
eq("nothing archived on adoption", plan.archives.length, 0);
eq("nothing appended on adoption", plan.appends.length, 0);

// Name matching should be forgiving about case and spacing, since the sheet is
// hand-edited.
plan = M.planSync_([row(4, "", "  byron ", "ADA")], [stu("1001", "Byron", "Ada")]);
eq("name match ignores case and padding", plan.updates.length, 1);
eq("normalised key", M.nameKey_("  Byron ", "ADA"), "byron|ada");
eq("collapses inner whitespace", M.nameKey_("Van  Dyke", "Ann"), "van dyke|ann");
eq("empty name has no key", M.nameKey_("", ""), "");

// A renamed student keeps her row via the nid, and is not duplicated.
plan = M.planSync_([row(4, "1001", "Byron", "Ada")], [stu("1001", "Lovelace", "Ada")]);
eq("nid wins over a changed surname", plan.updates.map((u) => u.row), [4]);
eq("no duplicate row for a rename", plan.appends.length, 0);
eq("the old row is not archived", plan.archives.length, 0);

// Blank padding rows are not people.
plan = M.planSync_([row(4, "1001", "Byron", "Ada"), row(5, "", "", ""), row(6, "", "", "")],
                   [stu("1001", "Byron", "Ada")]);
eq("blank rows are not archived", plan.archives.length, 0);

// Two sheet rows for one student: only one can claim it, the other archives.
plan = M.planSync_([row(4, "1001", "Byron", "Ada"), row(5, "1001", "Byron", "Ada")],
                   [stu("1001", "Byron", "Ada")]);
eq("duplicate row claims once", plan.updates.length, 1);
eq("the duplicate is archived", plan.archives.map((a) => a.row), [5]);

// Degenerate inputs.
eq("empty sheet, empty Edsby", M.planSync_([], []), { updates: [], appends: [], archives: [] });
eq("empty sheet appends everyone", M.planSync_([], [stu("1", "A", "B")]).appends.length, 1);
eq("empty Edsby archives everyone", M.planSync_([row(4, "1", "A", "B")], []).archives.length, 1);
eq("null safe", M.planSync_(null, null), { updates: [], appends: [], archives: [] });

group("Row values");
const rv = M.rowValuesFor_(
  { nid: 7640360, lastName: "Bassoo", prefFirst: "Mya", fullName: "Mya Bassoo", gender: "F",
    group: "8A", grade: "8", dob: "2011-04-01", momNid: "5001", momName: "A Bassoo" },
  { 5001: "mum@example.test" });
eq("writes the nid to column U", rv[M.CONFIG.COLS.edsbyNid], 7640360);
eq("group", rv[M.CONFIG.COLS.group], "8A");
eq("mom email resolved", rv[M.CONFIG.COLS.momEmail], "mum@example.test");
eq("dad email blank without a nid", rv[M.CONFIG.COLS.dadEmail], "");
eq("falls back to grade when no group",
   M.rowValuesFor_({ grade: "7" }, {})[M.CONFIG.COLS.group], "7");
eq("only owned columns are produced",
   Object.keys(rv).map(Number).sort((a, b) => a - b),
   M.ownedColumns_());

group("Batched writes over scattered rows");
const written = [];
const wSheet = { getRange: (r, c, nr) => ({ setValues: (v) => written.push({ row: r, col: c, n: nr, vals: v.map((x) => x[0]) }) }) };
M.writeRowValues_(wSheet, [
  { row: 4, values: { 1: "Byron" } },
  { row: 5, values: { 1: "Turing" } },
  { row: 9, values: { 1: "Hopper" } },
]);
eq("contiguous rows coalesce into one call", written.filter((w) => w.n === 2).length, 1);
eq("the gap starts a new call", written.length, 2);
eq("first run values", written.find((w) => w.row === 4).vals, ["Byron", "Turing"]);
eq("second run values", written.find((w) => w.row === 9).vals, ["Hopper"]);
const none = [];
M.writeRowValues_({ getRange: () => ({ setValues: () => none.push(1) }) }, []);
eq("no entries, no calls", none.length, 0);

// ── Sheet writes ────────────────────────────────────────────────────────────
group("Sheet writes (batched)");
const writes = [];
const fakeSheet = { getRange: (r, c) => ({ setValues: (v) => writes.push({ col: c, row: r, vals: v.map((x) => x[0]) }) }) };
M.writeStudents_(fakeSheet, [
  { lastName: "Byron", prefFirst: "Ada", fullName: "Ada Byron", gender: "F", group: "8B", dob: "2010-01-01", momNid: "9", momName: "M B" },
  { lastName: "Turing", firstName: "Alan", fullName: "Alan Turing", gender: "M", group: "7A", dob: "2011-02-02", dadNid: "8", dadName: "D T" },
], { 9: "mom@x.com", 8: "dad@x.com" });
const col = (n) => writes.find((w) => w.col === n);
eq("column A last names", col(1).vals, ["Byron", "Turing"]);
eq("starts at DATA_START_ROW", col(1).row, M.CONFIG.DATA_START_ROW);
eq("column G group", col(7).vals, ["8B", "7A"]);
eq("column P mom email, blank without a nid", col(16).vals, ["mom@x.com", ""]);
eq("column S dad email", col(19).vals, ["", "dad@x.com"]);
eq("one setValues per mapped column", writes.length, M.ownedColumns_().length);
eq("no writes for an empty roster", (() => { const w = []; M.writeStudents_({ getRange: () => ({ setValues: (v) => w.push(v) }) }, [], {}); return w.length; })(), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
