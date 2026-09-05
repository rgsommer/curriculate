// Quick check of src/lib/daily/parse.ts against sample DisplayAI rows.
// Run from frontend/:  node scripts/daily-parse-check.mjs
// Transpiles the TS module with the project's typescript package, no build needed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const src = fs.readFileSync(new URL("../src/lib/daily/parse.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = path.join(os.tmpdir(), `daily-parse-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const P = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

let failures = 0;
const check = (label, ok, got) => {
  if (!ok) { failures++; console.log(`FAIL ${label}`, got === undefined ? "" : JSON.stringify(got)); }
  else console.log(`ok   ${label}`);
};

// ---- primitives ----
check("parseTime 10:59 AM", P.parseTime("10:59 AM") === 659);
check("parseTime 1:00 PM", P.parseTime("1:00 PM") === 780);
check("parseTime 12:00 PM", P.parseTime("12:00 PM") === 720);
check("parseTime 12:20 AM", P.parseTime("12:20 AM") === 20);
check("parseTime 08:55", P.parseTime("08:55") === 535);
check("parseTime junk", P.parseTime("59 minutes") === null);
check("parseDuration", P.parseDuration("59 minutes") === 59);

const st = P.parseStatus("A-FD & B1");
check("status letter/grace", st.letter === "A" && st.grace && st.FD && st.B1 && !st.B2, st);
check("status REC", P.parseStatus("REC").rec === true);
check("status All 3 with 4", (() => { const s = P.parseStatus("BAll 3 4"); return s.FD && s.B1 && s.B2 && s.extra; })());

const pl = P.parsePlansLine("Plans for Saturday, Sep 5, 2026...    -275%--272%--137%--205%--181%-");
check("plans percents", pl.kind === "percents" && pl.values.join() === "275,272,137,205,181" && pl.title === "Plans for Saturday, Sep 5, 2026...", pl);
const pn = P.parsePlansLine("Plans for Thursday, Sep 10, 2026...    -660--871--220--820--290-");
check("plans numbers", pn.kind === "numbers" && pn.values.join() === "660,871,220,820,290", pn);

const cls = P.parseClassText("Math 7B (23) 207 (J003) Today we practice solving equations and using properties of operations. How do properties help solve equations faster? - Complete NS7-3: p. 7 problems. - Complete NS7-4: p. 8 problems. Reminders: Test on Unit 1 (Number Sense) on Fri Sep 18; finish last day's work.");
check("class header", cls.subj === "Math 7B" && cls.sec === "7B" && cls.room === "Rm 207" && cls.code === "J003", cls);
check("class today/q", cls.today.startsWith("Today we practice") && cls.q === "How do properties help solve equations faster?", cls);
check("class bullets", cls.plan.length === 2 && cls.plan[1] === "Complete NS7-4: p. 8 problems.", cls.plan);
check("class reminders", cls.remind.startsWith("Test on Unit 1"), cls.remind);

const ce = P.parseClassText("CE 8A (22) - 212 (B003 📷 📿) Today we review God's word. What helps you remember a Bible verse best? - Test the week's memory verse - Assign: Review the video (7 minutes) Reminders: Dress-down payments due BY Fri Sep 25.");
check("CE header with dash and emoji", ce.subj === "CE 8A" && ce.room === "Rm 212" && ce.code === "B003", ce);
check("CE assign split", ce.assign.length === 1 && ce.plan.length === 1, ce);
check("duty row", P.parseClassText("Recess Duty").duty && P.parseClassText("Recess Duty").rec);

check("url from HYPERLINK", P.urlFromFormula('=HYPERLINK("https://youtu.be/abc123def","▶")') === "https://youtu.be/abc123def");
check("url from IMAGE", P.urlFromFormula('=IMAGE("https://example.com/p.png")') === "https://example.com/p.png");
check("isVideoUrl", P.isVideoUrl("https://www.youtube.com/watch?v=x") && !P.isVideoUrl("https://docs.google.com/document/d/1"));

// ---- whole payload from a Thursday-shaped grid ----
const display = [
  ["Good morning, Thursday workers!", "", "", "0"],
  [],
  ["Week 1                       Brampton Christian School                      38 weeks left!"],
  [],
  ['Two short verses to remember for life. ~"God is our refuge and strength." Psalm 46:1'],
  [],
  ["", "FALSE", "UNSCRAMBLE for a treat: TNOMISNEPEO ___ ___ ___", "FALSE"],
  ["", "", "Plans for Thursday, Sep 10, 2026...    -660--871--220--820--290-", "1"],
  ["10:00 AM", "FALSE", "Math 7A (22) 202 (J003) Today we practice equations. How do properties help? - NS7-3 p. 7 - NS7-4 p. 8 Reminders: Test Thu Sep 17.", "AB1 & B2", "", "1"],
  ["59 minutes"],
  ["11:00 AM", "FALSE", "History 7A (22) 202 (H001) Today we introduce the course. What makes a useful historical perspective? - Handouts - Written task p.2 Reminders: Due Thu Sep 17. Link: https://youtu.be/abc123def", "A-FD & B1", "", "0"],
  ["12:00 PM", "FALSE", "Lunch", "REC"],
  ["12:20 PM", "FALSE", "Recess Duty", "REC"],
  ["12:55 PM", "FALSE", "CE 8A (22) - 212 (B003) Today we review. What helps you? - Test the week's memory verse Reminders: none.", "AFD Only"],
  ["1:30 PM", "FALSE", "", ""],
  ["3:25 PM", "FALSE", "Dismissal Rm212"],
  ["4:00 PM", "", "Before you head out today, please: - Tidy your floor area. - Say sorry to anyone you wronged."],
];
const setup = [
  [], ["", "School", "Brampton Christian School"], ["", "Teacher", "Mr. Sommer"], [], [], [],
  ["", "Time in advance to show next", "15", "minutes"],
  ["", "Time in advance to show reminders", "2", "minutes"],
  ["", "Change time to red", "3", "minutes before end"],
  ["", "Show homework from", "1", "days before"],
  ["", "Show homework", "1", "minutes before end of class"],
  ["", "Show riddle answer until", "12:30", "1"],
  ["", "Blank screen during announcements", "08:55", "09:00"],
  ["", "Show Dismissal List", "", "15:15:00"],
  ["", "Grade to show", "", "7"],
  ["", "Show pregnancy weeks during", "History", "15"],
  ["", "Can go to washroom x min before", "", "10"],
  ["", "Display riddle answer every", "3", "Lesson pic"],
  ["", "Snacks are allowed with B2 for", "5", "minutes"],
];
const slots = [
  ["6", "1", "", "5", "3", "2", ""],
  ["Vocab", "Verse & Poem", "Homework", "Kiss&Ride", "Gestation", "Lesson Pic", ""],
  ["FALSE", "FALSE", "TRUE", "FALSE", "FALSE", "C11", ""],
  ["", "", "Daily Update", "", "", "", ""],
  [], [],
  ["500", "800", "500", "200", "200", "600", "1300"],
];
const slotFormulas = [["", "", "", "", "", '=IMAGE("https://example.com/lesson.png")', ""]];
const displayD = display.map((r, i) => [i === 8 ? '=HYPERLINK("https://youtu.be/mathvideo1","▶")' : ""]);
const displayC = display.map(() => [""]);

const out = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas, feature: "#N/A" });
check("meta greeting/line", out.meta.greeting.startsWith("Good morning") && out.meta.line === "Week 1 · Brampton Christian School · 38 weeks left!", out.meta);
check("meta verse/puzzle", out.meta.verse.startsWith("Two short") && out.meta.puzzle === "UNSCRAMBLE for a treat: TNOMISNEPEO", out.meta);
check("meta plans + points", out.meta.plans === "Plans for Thursday, Sep 10, 2026..." && out.points.numbers.length === 5 && out.points.entered === true, out.points);
check("meta headout", out.meta.headout.length === 2 && out.meta.headout[0] === "Tidy your floor area.", out.meta.headout);
check("feature error blanked", out.meta.feature === "");
const per = out.periods;
check("period count (headout row excluded)", per.length === 7, per.map((p) => p.start));
check("period ends: duration row shortens", per[0].start === 600 && per[0].end === 659, per[0]);
check("period ends: next start", per[1].start === 660 && per[1].end === 720, per[1]);
check("video from D formula", per[0].video === "https://youtu.be/mathvideo1", per[0].video);
check("video from text URL", per[1].video === "https://youtu.be/abc123def", per[1].video);
check("lunch is duty+rec", per[2].duty && per[2].rec && per[2].status === "REC");
check("empty period flagged", per[5].empty === true && per[5].duty === true);
check("status carried", per[1].status === "A-FD & B1");
check("setup values", out.setup.nextAdvance === 15 && out.setup.redAt === 3 && out.setup.homeworkAt === 1 && out.setup.blankFrom === 535 && out.setup.blankTo === 540 && out.setup.dismissalAt === 915 && out.setup.riddleUntil === 750 && out.setup.graceMin === 15 && out.setup.washroomBefore === 10 && out.setup.snacksB2Min === 5, out.setup);
check("picture from slot", out.picture && out.picture.url === "https://example.com/lesson.png" && out.picture.seconds === 600, out.picture);

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);
