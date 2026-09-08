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
check("isImageUrl png", P.isImageUrl("https://example.com/a/b.PNG?x=1"));
check("isImageUrl drive", P.isImageUrl("https://drive.google.com/file/d/ABC123/view?usp=sharing"));
check("isImageUrl rejects doc", !P.isImageUrl("https://docs.google.com/document/d/1/edit"));
check("isImageUrl rejects youtube", !P.isImageUrl("https://youtu.be/abc123def"));
check("normalizeImageUrl drive path", P.normalizeImageUrl("https://drive.google.com/file/d/ABC123/view?usp=sharing") === "https://lh3.googleusercontent.com/d/ABC123", P.normalizeImageUrl("https://drive.google.com/file/d/ABC123/view?usp=sharing"));
check("normalizeImageUrl drive uc", P.normalizeImageUrl("https://drive.google.com/uc?export=view&id=XYZ789") === "https://lh3.googleusercontent.com/d/XYZ789", P.normalizeImageUrl("https://drive.google.com/uc?export=view&id=XYZ789"));
check("normalizeImageUrl leaves plain", P.normalizeImageUrl("https://example.com/p.png") === "https://example.com/p.png");
check("refFromFormula IMAGE(ref)", P.refFromFormula("=IMAGE(Setup!Z4)") === "Setup!Z4", P.refFromFormula("=IMAGE(Setup!Z4)"));
check("refFromFormula plain ref", P.refFromFormula("=Setup!$Z$4") === "Setup!$Z$4", P.refFromFormula("=Setup!$Z$4"));
check("refFromFormula ignores literal", P.refFromFormula('=IMAGE("https://x/y.png")') === "");
check("refFromFormula ignores IF chain", P.refFromFormula("=if(B7,Setup!V4,Setup!Z4)") === "", P.refFromFormula("=if(B7,Setup!V4,Setup!Z4)"));

// ---- the sheet's own display rules, evaluated against the board's clock ----
const S = (over) => ({ ...P.EMPTY_SOURCES, ...over });
const slot = (priority, name, value, formula) => ({ priority, name, value: value || "", formula: formula || "" });

const poemWin = S({ windowStart: 750, windowEnd: 800, poemF3: "Poem of the week" });
check("feature: poem inside the window", P.evaluateFeature(poemWin, 760).text === "Poem of the week", P.evaluateFeature(poemWin, 760));
check("feature: nothing outside the window", P.evaluateFeature(poemWin, 700).text === "", P.evaluateFeature(poemWin, 700));

const b7 = S({ b7: true, slots: [slot(6, "Vocab"), slot(1, "Verse", "Dress-down Friday")] });
check("feature: B7 takes Setup!V4", P.evaluateFeature(b7, 600).text === "Dress-down Friday", P.evaluateFeature(b7, 600));

const d7 = S({ d7: true, slots: [0, 1, 2, 3, 4].map(() => slot(null, "")).concat([slot(2, "Lesson Pic", "", '=IMAGE("https://x/flag.png")')]) });
const d7r = P.evaluateFeature(d7, 600);
check("feature: D7 takes the lesson picture", d7r.image === "https://x/flag.png" && d7r.text === "", d7r);
check("feature: D7 with an empty Z4 says No class", P.evaluateFeature(S({ d7: true }), 600).text === "No class");

const byPriority = S({ slots: [slot(6, "Vocab", "vocab word"), slot(1, "Verse", "verse text"), slot(3, "Homework", "hw")] });
check("feature: priority 1 wins", P.evaluateFeature(byPriority, 600).text === "verse text", P.evaluateFeature(byPriority, 600));
const dashSkipped = S({ slots: [slot(1, "Verse", ""), slot(2, "Lesson Pic", "-"), slot(3, "Gestation", "Week 15")] });
check("feature: empty and \"-\" slots are skipped", P.evaluateFeature(dashSkipped, 600).text === "Week 15", P.evaluateFeature(dashSkipped, 600));

// the difference from the sheet: an =IMAGE() cell has no text value, so the
// sheet's own <>"" test skips it. Here it counts as filled.
const pictureSlot = S({ slots: [slot(1, "Verse", "", '=IMAGE("https://x/canada.png")'), slot(2, "Other", "later text")] });
const ps = P.evaluateFeature(pictureSlot, 600);
check("feature: a picture slot counts as filled", ps.image === "https://x/canada.png" && ps.source.startsWith("Verse"), ps);

const riddle = S({ windowStart: 750, riddle: "Why did the horse...?" });
check("feature: riddle before the window", P.evaluateFeature(riddle, 600).text === "Why did the horse...?", P.evaluateFeature(riddle, 600));
check("feature: offset hours shift the window", P.evaluateFeature(S({ windowStart: 750, windowEnd: 800, offsetHours: 1, poemF3: "P" }), 810).text === "P");

const daily = S({ a11: 600, verticalRow: ["1", "", "mon", "tue", "wed", "line one\nline two\nline three", "fri"] });
check("daily: full text before the first period", P.evaluateDailyText(daily, 500, 5) === "line one\nline two\nline three", P.evaluateDailyText(daily, 500, 5));
check("daily: first two lines once started", P.evaluateDailyText(daily, 700, 5) === "line one\nline two", P.evaluateDailyText(daily, 700, 5));
check("daily: Skip 7A is stripped", P.evaluateDailyText(S({ verticalRow: ["1", "", "", "", "", "Skip 7A Bring your book", ""] }), 500, 5) === "Bring your book");
check("daily: weekday picks the column", P.evaluateDailyText(S({ verticalRow: ["1", "", "monday", "tuesday", "", "", ""] }), 500, 2) === "monday", P.evaluateDailyText(S({ verticalRow: ["1", "", "monday", "tuesday", "", "", ""] }), 500, 2));
const row3 = []; const row46 = [];
const put = (arr, col1, v) => { arr[col1 - 1] = v; };
put(row3, 4, "7A"); put(row3, 17, "7B"); put(row3, 30, "7C"); put(row3, 43, "8A"); put(row3, 56, "8B");
[13, 26, 39, 52, 65].forEach((base, i) => ["1", "1", "1", "0"].forEach((d, k) => put(row46, base + k, i === 0 ? ["1", "1", "0", "0"][k] : d)));
const pc = P.buildPointsClasses(row3, row46);
check("points classes built in formula order", pc.map((c) => c.name).join() === "7B,7C,7A,8A,8B", pc.map((c) => c.name));
check("points class letters", pc.map((c) => c.letter).join() === "B,C,A,A,B", pc.map((c) => c.letter));
const statusPeriod = { start: 600, end: 660, text: "Math 7A (22) 202 (J003) Today we..." };
check("status: empty outside the period", P.evaluateStatus(pc, statusPeriod, 700, 15) === "");
check("status: REC for lunch", P.evaluateStatus(pc, { start: 600, end: 660, text: "Lunch" }, 610, 15) === "REC");
check("status: * rows print nothing", P.evaluateStatus(pc, { start: 600, end: 660, text: "*hidden" }, 610, 15) === "");
// 7A digits are 1,1,0,0 -> mid window prints d1 d2 d4 d3 = 1 1 0 0 -> "B1 & B2"
check("status: mid window uses all four flags", P.evaluateStatus(pc, statusPeriod, 630, 15) === "AB1 & B2", P.evaluateStatus(pc, statusPeriod, 630, 15));
// inside the grace window B2 is forced off: d1 0 d4 d3 = 1 0 0 0
check("status: grace window forces B2 off", P.evaluateStatus(pc, statusPeriod, 605, 15) === "A-1000", P.evaluateStatus(pc, statusPeriod, 605, 15));
check("status: unknown class prints nothing", P.evaluateStatus(pc, { start: 600, end: 660, text: "Assembly" }, 630, 15) === "");

const style = (s) => { const st = P.statusStyle(s); return st ? st.bg : null; };
check("colour: A-1000 is the grey-on-green no-privilege code", style("A-1000") === "#66EE55", P.statusStyle("A-1000"));
check("colour: REC is green", style("REC") === "#5BE55B");
check("colour: All 3 is orange", style("AAll 3") === "#F0993E");
check("colour: B1 & B2 beats the bare B1 rule", style("AB1 & B2") === "#E8912D", P.statusStyle("AB1 & B2"));
check("colour: -FD Only has no fill", style("A-FD Only") === "transparent", P.statusStyle("A-FD Only"));
check("colour: FD Only is bright green", style("AFD Only") === "#66EE55");
check("colour: a trailing 4 is the morning marker", style("AAll 3 4") === "#A0522D", P.statusStyle("AAll 3 4"));
check("colour: a trailing 1 is magenta", style("AB1") === "#EE22EE", P.statusStyle("AB1"));
// "ends with 1" is the sheet's first rule, so it beats the dark-green ones
check("colour: FD & B1 also ends in 1, so magenta wins", style("AFD & B1") === "#EE22EE", P.statusStyle("AFD & B1"));
// but "B1 & B2" is listed above "ends with 4", so the morning marker loses there
check("colour: B1 & B2 beats the trailing 4", style("AB1 & B2 4") === "#E8912D", P.statusStyle("AB1 & B2 4"));
check("colour: FD & B1 with the marker is brown", style("AFD & B1 4") === "#A0522D", P.statusStyle("AFD & B1 4"));
check("colour: nothing for an empty status", P.statusStyle("") === null);

check("daily: poem inside the window", P.evaluateDailyText(S({ windowStart: 750, windowEnd: 800, poemRow: ["mon", "tue", "wed", "thu", "fri"] }), 760, 5) === "thu");

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
const prayGrid = display.map((r) => r.slice());
prayGrid.splice(6, 0, ["", "", "Pray for Albania"]);
const prayC = []; prayC[6] = ['=HYPERLINK("https://prayercast.com/albania.html","Pray for Albania")'];
const prayOut = P.buildPayload({ display: prayGrid, displayD, displayC: prayC, setup, slots, slotFormulas, feature: "" });
check("pray text", prayOut.meta.pray && prayOut.meta.pray.text === "Pray for Albania", prayOut.meta.pray);
check("pray link from hyperlink formula", prayOut.meta.pray && prayOut.meta.pray.url === "https://prayercast.com/albania.html", prayOut.meta.pray);
check("no pray when absent", out.meta.pray === null, out.meta.pray);
check("feature error blanked", out.meta.feature === "");
check("no feature image when none", out.meta.featureImage === "", out.meta.featureImage);

const withImg = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas,
  feature: "", featureFormula: '=IMAGE("https://drive.google.com/file/d/PIC42/view")' });
check("feature image from =IMAGE formula", withImg.meta.featureImage === "https://lh3.googleusercontent.com/d/PIC42", withImg.meta.featureImage);
check("feature text cleared when image", withImg.meta.feature === "", withImg.meta.feature);

const withUrlText = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas,
  feature: "https://example.com/map.jpg", featureFormula: "" });
check("feature image from bare URL value", withUrlText.meta.featureImage === "https://example.com/map.jpg", withUrlText.meta.featureImage);

const withPoem = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas,
  feature: "The fisherman goes out at dawn", featureFormula: "=Poems!F3" });
check("poem text is not an image", withPoem.meta.featureImage === "" && withPoem.meta.feature.startsWith("The fisherman"), withPoem.meta);
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
