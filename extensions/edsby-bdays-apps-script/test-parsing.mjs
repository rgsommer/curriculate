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
  extractParentEmail_,
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
ok("1030 clears the credentials", msg1030.includes("NOT a credential problem"));
ok("1030 points at discoverZoomNodes", msg1030.includes("discoverZoomNodes"));
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

// ── Zoom node-id harvesting ─────────────────────────────────────────────────
// The regexes are read straight out of Code.gs so the test can't drift from it.
group("Zoom node-id harvesting");
const PATTERNS = eval("[" + src.match(/const PATTERNS = \[([\s\S]*?)\n  \];/)[1] + "]");
const grab = (text) => {
  const seen = new Set(), out = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.source, "g");
    let m;
    while ((m = re.exec(text)) !== null) if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
};
eq("HTML href", grab('<a href="/p/ZoomMyStudents/21471167">x</a>'), ["21471167"]);
eq("escaped-slash JSON url", grab('"url":"\\/p\\/ZoomMyStudents\\/9988776"'), ["9988776"]);
eq("xds then nid", grab('{"xds":"ZoomMyStudents","nid":33445566}'), ["33445566"]);
eq("xds then nid, keys apart", grab('{"xds":"ZoomMyStudents","label":"My Students","nid":"7778889"}'), ["7778889"]);
eq("nid then xds", grab('{"nid":44556677,"xds":"ZoomMyStudents"}'), ["44556677"]);
eq("bare colon form", grab("ZoomMyStudents: 12345678"), ["12345678"]);
eq("two ids", grab("ZoomMyStudents/111222 ZoomMyStudents/333444").sort(), ["111222", "333444"]);
eq("dedupes", grab("ZoomMyStudents/555666 ZoomMyStudents/555666").length, 1);
eq("rejects short ids", grab("ZoomMyStudents/12"), []);
eq("ignores other views", grab("ZoomOtherThing/21471167"), []);
ok("does not leak an nid across objects",
   !grab('{"xds":"ZoomMyStudents"},{"o":1},{"nid":999888}').includes("999888"));
eq("HTML nav + JSON nav in one blob",
   grab('<a href="/p/ZoomMyStudents/21471167">Old</a>' +
        '{"nav":[{"xds":"ZoomMyStudents","name":"My Students","nid":24880031}]}').sort(),
   ["21471167", "24880031"]);

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
eq("one setValues per mapped column", writes.length, Object.keys(M.CONFIG.COLS).length);
eq("no writes for an empty roster", (() => { const w = []; M.writeStudents_({ getRange: () => ({ setValues: (v) => w.push(v) }) }, [], {}); return w.length; })(), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
