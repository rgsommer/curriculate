// Quick check of src/lib/daily/parse.ts against sample DisplayAI rows.
// Run from frontend/:  node scripts/daily-parse-check.mjs
// Transpiles the TS module with the project's typescript package, no build needed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// parse.ts pulls in the formula evaluator, so both modules are transpiled into
// one temporary directory and the relative import is pointed at the .mjs copy.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-parse-"));
const build = (name) => {
  const src = fs.readFileSync(new URL(`../src/lib/daily/${name}.ts`, import.meta.url), "utf8");
  const js = ts
    .transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
    .outputText.replace(/(from\s+")(\.\/[a-z]+)(")/g, "$1$2.mjs$3");
  fs.writeFileSync(path.join(dir, `${name}.mjs`), js);
};
build("formula");
build("parse");
const P = await import(pathToFileURL(path.join(dir, "parse.mjs")).href);
const F = await import(pathToFileURL(path.join(dir, "formula.mjs")).href);
fs.rmSync(dir, { recursive: true, force: true });

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
const plSingle = P.parsePlansLine("Plans for Monday, Sep 7, 2026...    -660-871-220-820-");
check("plans: neighbours may share one dash", plSingle.values.join() === "660,871,220,820", plSingle);
const plStar = P.parsePlansLine("Plans for Thursday, Sep 10, 2026...    *10-0-0-19-9-");
check("plans: a marked first value still counts", plStar.values.join() === "10,0,0,19,9", plStar);
const plNeg = P.parsePlansLine("Plans for Monday, Sep 7, 2026...    -660---871--220-");
check("plans: three dashes is a negative value", plNeg.values.join() === "660,-871,220", plNeg);
check("points labels: read from row 3, in column order",
  P.pointsLabels((() => { const r = []; r[3] = "7A"; r[16] = "7B"; r[42] = "8A"; r[55] = "8B"; return r; })()).join() === "7A,7B,8A,8B");
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

check("duty title: lunch", P.friendlyDutyTitle("Lunch") === "Enjoy your lunch");
check("duty title: recess duty is what students are doing", P.friendlyDutyTitle("Recess Duty") === "Out for recess");
check("duty title: playground", P.friendlyDutyTitle("Playground") === "Out on the playground");
check("duty title: dismissal", P.friendlyDutyTitle("Dismissal Rm212") === "Dismissal");
check("duty title: no school", P.friendlyDutyTitle("No School (Labour Day)") === "No school today");
check("duty title: nothing better to say", P.friendlyDutyTitle("MAPS Testing") === "");

check("theme: Math is blue", P.subjectTheme("J003", "Math 7A").accent === "#2F6BD8");
check("theme: History is rust", P.subjectTheme("H001", "History 7A").accent === "#C2571A");
check("theme: CE is violet", P.subjectTheme("B003", "CE 8A").accent === "#7C5CD6");
check("theme: Geography is green", P.subjectTheme("G002", "Geography 8A").accent === "#2E8B4A");
check("theme: an unknown code still gets a colour", /^hsl\(/.test(P.subjectTheme("Z009", "Drama 8B").accent), P.subjectTheme("Z009", "Drama 8B"));
check("theme: the same subject always gets the same colour",
  P.subjectTheme("Z009", "Drama 8B").accent === P.subjectTheme("Z009", "Drama 8B").accent);
check("weekday colour: Thursday", (P.weekdayColour(5) || {}).name === "Thursday" && P.weekdayColour(5).colour === "#B4A7D6");
check("weekday colour: none at the weekend", P.weekdayColour(1) === null && P.weekdayColour(7) === null);

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
// a rich-text link lives in neither the value nor the formula
const linkGrid = []; linkGrid[6] = ["", "", "https://prayercast.com/peru.html"];
const richOut = P.buildPayload({ display: prayGrid, displayD, displayC: [], setup, slots, slotFormulas, feature: "", displayLinks: linkGrid });
check("pray link from a rich-text link", richOut.meta.pray && richOut.meta.pray.url === "https://prayercast.com/peru.html", richOut.meta.pray);
// and the cell may sit in any header column, not just A or C
const colEGrid = display.map((r) => r.slice());
colEGrid.splice(6, 0, ["", "", "", "", "Pray for Chad"]);
const colELinks = []; colELinks[6] = ["", "", "", "", "https://prayercast.com/chad.html"];
const colEOut = P.buildPayload({ display: colEGrid, displayD, displayC: [], setup, slots, slotFormulas, feature: "", displayLinks: colELinks });
check("pray found in column E", colEOut.meta.pray && colEOut.meta.pray.url === "https://prayercast.com/chad.html", colEOut.meta.pray);
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


// ---- the end-of-day package ----
const c15 = "Before you head out today, please remember: 1) Tidy your floor area and make sure your desk is neat. 2) If you\u2019ve wronged someone today, take a moment to say sorry and make it right.  And as you go, receive this blessing: \u201cNow may the God of peace equip you with everything good.\u201d";
const head = P.splitHeadout(c15);
check("headout: numbered items", head.items.length === 2 && head.items[0].startsWith("Tidy your floor area"), head.items);
check("headout: blessing split off", head.blessing.startsWith("\u201cNow may the God of peace"), head.blessing);
const circled = P.splitHeadout("Make sure ... \u2460 your floor area and desk are tidy  \u2461 you hug a friend ... before you go today...  The grace of the Lord Jesus Christ be with you all.");
check("headout: circled items", circled.items.length === 2 && circled.items[1] === "you hug a friend", circled.items);
check("headout: blessing after 'before you go today'", circled.blessing.startsWith("The grace of the Lord"), circled.blessing);

const dis = P.parseDismissal([
  ["For Dismissal Messages", "", "", ""],
  ["Lunch", "12:00", "", "5"],
  ["Lunch Recess", "12:20", "", "minutes before Dismissal list"],
  ["Dismissal", "15:30", "", ""],
]);
check("dismissal times", dis.times.length === 3 && dis.times[0].at === 720 && dis.times[2].at === 930, dis.times);
check("dismissal advance minutes", dis.advanceMin === 5, dis.advanceMin);
check("dismissal header row skipped", !dis.times.some((x) => /^for /i.test(x.label)), dis.times);
check("dismissal defaults when the block is missing", P.parseDismissal([]).advanceMin === 5 && P.parseDismissal([]).times.length === 0);

const wait = P.parseWaiting([
  ["Kiss & Ride", "", ""],
  ["Waiting (Recent First)", "", "Called"],
  ["Nguyen, Mia (8A)", "", "3:26 PM"],
  ["Okafor, Daniel (7B)", "", "3:27 PM"],
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["Should not be read", "", ""],
]);
check("waiting list from the header cell", wait.length === 2 && wait[0] === "Nguyen, Mia (8A)", wait);
check("waiting list empty without a header", P.parseWaiting([["Name", "Time"], ["A", "B"]]).length === 0);

const tomorrowGrid = display.map((r) => r.slice());
tomorrowGrid.splice(1, 0, [" Tomorrow: MAPS Roster Due"]);
const withTomorrow = P.buildPayload({ display: tomorrowGrid, displayD: [], displayC: [], setup, slots, slotFormulas, feature: "" });
check("meta tomorrow", withTomorrow.meta.tomorrow === "MAPS Roster Due", withTomorrow.meta.tomorrow);


// ---- the verse: A5's LEFT(..., 85), cut at a word boundary instead ----
check("truncateWords: short text is left alone", P.truncateWords("God is our refuge", 85) === "God is our refuge");
const cutv = P.truncateWords("Do you ever face temptations? Did you know that in your own strength you will fail? Here is more.", 85);
check("truncateWords: cuts at a space", !/\sH$/.test(cutv) && cutv.endsWith("\u2026") && cutv.length <= 86, cutv);
check("truncateWords: no word is broken", cutv.slice(0, -1).split(" ").every((w) => w.length < 20) && "Do you ever face temptations? Did you know that in your own strength you will fail?".startsWith(cutv.slice(0, -1)), cutv);
const sheetCut = "Do you ever face temptations? Did you know that in your own strength you will fail? H";
check("tidyTruncated: drops the half word the sheet left", P.tidyTruncated(sheetCut) === "Do you ever face temptations? Did you know that in your own strength you will fail?\u2026", P.tidyTruncated(sheetCut));
check("tidyTruncated: leaves a finished sentence", P.tidyTruncated("God is our refuge and strength, a very present help in trouble. Psalm 46:1") === "God is our refuge and strength, a very present help in trouble. Psalm 46:1");

const verseRows = ["v1", "v2", "v3", "v4", "v5", "v6", "v7 the long one", "v8", "v9", "v10"].map((v) => [v]);
const vs = (over) => S({ verses: verseRows.map((r) => r[0]), verseWeek: 1, a9: 600, a11: 660, ...over });
check("verse: picks week*5 + weekday - 1", P.evaluateVerse(vs({}), 500, 3).text.startsWith("v7"), P.evaluateVerse(vs({}), 500, 3));
const wrapped = S({ verses: ["a", "b", "c", "d", "e", "f"], verseWeek: 1, a9: 600 });
check("verse: wraps past the end of the column", P.evaluateVerse(wrapped, 500, 7).text === "e", P.evaluateVerse(wrapped, 500, 7));
check("verse: full for 20 min from A9", P.evaluateVerse(vs({}), 610, 3).open === true);
check("verse: short again after that", P.evaluateVerse(vs({}), 640, 3).open === false);
check("verse: full again for 20 min from A11", P.evaluateVerse(vs({}), 670, 3).open === true);
check("verse: short before A9", P.evaluateVerse(vs({}), 500, 3).open === false);
check("verse: empty when the Verses tab is missing", P.evaluateVerse(S({}), 610, 3).text === "");


// ---- handouts named in the lesson cell ----
const withLink = P.extractLinks("Complete the Introduction Fill-In-the-Blanks worksheet (or from this link: https://docs.google.com/document/d/1Yz/edit?tab=t.0) and hand it in.");
check("links: one handout found", withLink.links.length === 1 && withLink.links[0].url === "https://docs.google.com/document/d/1Yz/edit?tab=t.0", withLink.links);
check("links: named from the words before it", withLink.links[0].label === "Complete the Introduction Fill-In-the-Blanks worksheet", withLink.links[0].label);
check("links: the address leaves the text", !/https?:/.test(withLink.clean) && withLink.clean.startsWith("Complete the Introduction"), withLink.clean);
const kindOnly = P.extractLinks("See https://docs.google.com/presentation/d/1a/edit");
check("links: falls back to the kind of thing it is", kindOnly.links[0].label === "Slides", kindOnly.links[0]);
check("links: a dangling preposition is dropped", P.extractLinks("Handout at https://example.org/x.pdf").links[0].label === "Handout", P.extractLinks("Handout at https://example.org/x.pdf").links[0]);
check("links: pdf recognised", P.extractLinks("https://example.org/x.pdf").links[0].label === "PDF", P.extractLinks("https://example.org/x.pdf").links[0]);
const twice = P.extractLinks("A https://example.org/a.pdf then again https://example.org/a.pdf");
check("links: the same handout twice is one", twice.links.length === 1, twice.links);
check("links: none when there are none", P.extractLinks("Read p18-23 to prepare.").links.length === 0);

const lesson = P.parseClassText("Math 7A (22) 202 (J003) Today we practice. What is next? - Do NS7-3. - Print the Unit 1 review (or from this link: https://docs.google.com/document/d/1Q/edit?usp=sharing) Reminders: none.");
check("class links carried on the period", lesson.links.length === 1 && lesson.links[0].label === "Print the Unit 1 review", lesson.links);
check("class bullets no longer carry the address", lesson.plan.every((b) => !/https?:/.test(b)), lesson.plan);
check("a URL's own ? is not read as the lesson question", lesson.q === "What is next?", lesson.q);

const runGrid = display.map(() => []);
runGrid[8] = [{ text: "Due Dates handout", url: "https://example.org/due.pdf" }];
const withRuns = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas, feature: "", displayCRuns: runGrid });
check("rich-text handout merged in", (withRuns.periods[0].links || []).some((l) => l.label === "Due Dates handout"), withRuns.periods[0].links);


// ---- the day's plan from the VerticalAi tab ----
const dayText = 'Before I forget, here are your TOP things to remember/do for today...... Math 7A (23) 202 Today we introduce the course, materials, and expectations. What helps you learn best in class? - Slides presentation on Math - Complete the Introduction Fill-In-the-Blanks worksheet by Wed Sep 16 Reminders: Handouts in class; link posted. CE 8A (21) - 212 (B002) Today we learn about the finer points from assemblies. What was the main message you noticed? - Discuss Boy/Girl assemblies. Reminders: Bring signed permission slip. Math 7A (23) 202 (J002) Today we practice place value and order of operations. What strategies help you avoid mistakes? - Do NS7-1: p. 2 Reminders: Bring homework. Geography 8B (22) 211 Today we meet and start the first assignment. What matters most for you in this class? - First Class introductions Reminders: none.';
const dayClasses = P.classesFromText(dayText);
check("day plan: one entry per class", dayClasses.length === 4, dayClasses.map((c) => `${c.subj} ${c.code}`));
check("day plan: header without a code still parses", dayClasses[0].subj === "Math 7A" && dayClasses[0].room === "Rm 202" && dayClasses[0].code === "", dayClasses[0]);
check("day plan: header with a code keeps it", dayClasses[1].subj === "CE 8A" && dayClasses[1].code === "B002", dayClasses[1]);
check("day plan: the lead-in is not a class", !dayClasses.some((c) => /Before I forget/.test(c.subj)), dayClasses.map((c) => c.subj));
check("day plan: today text survives the split", dayClasses[3].today.startsWith("Today we meet"), dayClasses[3].today);
check("day plan: question survives the split", dayClasses[0].q === "What helps you learn best in class?", dayClasses[0].q);
check("day plan: same class twice is one", P.classesFromText(dayText + " " + dayText).length === 4);
check("day plan: nothing from ordinary prose", P.classesFromText("Remember to bring your Bible tomorrow.").length === 0);

const byDay = P.dayPlanByWeekday([[], ["", "", "", "", dayText]]);
check("day plan: F to J are Monday to Friday", (byDay[4] || []).length === 4 && !byDay[2], Object.keys(byDay));


// ---- the Lessons tab: the teacher's own material, keyed by lesson code ----
const lessonRows = [
  ["Code", "", "Page", "Homework", "", "", "Picture", "Video"],
  ["~J003", "", "p. 7", "Complete NS7-3 p.7 and the Unit 1 review: https://example.org/unit1.pdf", "", "", "", "https://youtu.be/lessonvid"],
  ["h001", "", "p. 2", "Written task due Thu Sep 17", "", "", "https://example.com/history.png", ""],
  ["not a code", "", "x", "y", "", "", "", ""],
];
const lessonForms = [[], [], ["", "", "", "", "", "", '=IMAGE("https://example.com/history.png")', ""], []];
const lessonRuns = [[], [], [[], [{ text: "Due Dates handout", url: "https://example.org/due.pdf" }]], []];
const L = P.parseLessons(lessonRows, lessonForms, lessonRuns);
check("lessons: keyed by code without the tilde", !!L.J003 && !!L.H001 && Object.keys(L).length === 2, Object.keys(L));
check("lessons: page and homework", L.J003.page === "p. 7" && L.J003.homework.startsWith("Complete NS7-3"), L.J003);
check("lessons: the homework link becomes a handout", L.J003.links.length === 1 && L.J003.links[0].url === "https://example.org/unit1.pdf", L.J003.links);
check("lessons: the address leaves the homework text", !/https?:/.test(L.J003.homework), L.J003.homework);
check("lessons: video from column J", L.J003.video === "https://youtu.be/lessonvid", L.J003.video);
check("lessons: picture from an =IMAGE() in column I", L.H001.image === "https://example.com/history.png", L.H001.image);
check("lessons: a rich-text handout in the homework cell", L.H001.links.some((x) => x.label === "Due Dates handout"), L.H001.links);
check("lessons: a row that is not a lesson is skipped", !L["NOT A CODE"], Object.keys(L));

const dayWithMat = P.classesFromText("History 7A (22) 202 (H001) Today we introduce the course. What makes a useful perspective? - Handouts Reminders: none.", L);
check("day plan carries the lesson's material", dayWithMat[0].page === "p. 2" && dayWithMat[0].image === "https://example.com/history.png" && dayWithMat[0].links.length === 1, dayWithMat[0]);

const withLessons = P.buildPayload({ display, displayD, displayC, setup, slots, slotFormulas, feature: "", lessons: lessonRows, lessonFormulas: lessonForms, lessonLinkRuns: lessonRuns });
const mathRow = withLessons.periods.find((x) => x.code === "J003");
check("period picks up its lesson row", mathRow && mathRow.page === "p. 7" && mathRow.homework.startsWith("Complete NS7-3"), mathRow && { page: mathRow.page, homework: mathRow.homework });
check("row video still wins over the lesson video", mathRow && mathRow.video === "https://youtu.be/mathvideo1", mathRow && mathRow.video);


// ---- the day's plan paired with the times in Vertical column A ----
const dutyRun = P.classesFromText("Reminders: assembly follow-up next class. Playground CE 8A (21) - 212 (B002) Today we learn about the finer points. What was the main message? - Discuss Reminders: none.");
check("day plan: the word before the subject is not swallowed", dutyRun[0].subj === "CE 8A", dutyRun[0].subj);

const mathText = "Math 7A (23) 202 (J003) Today we practise equations. What helps? - NS7-3 Reminders: none.";
const histText = "History 7A (22) 202 (H001) Today we introduce the course. What makes a useful perspective? - Handouts Reminders: none.";
// Vertical: column A the time, F to J the weekday. Row 0 is a run-together copy
// on VerticalAi with no time; rows 1 and 2 carry times.
const vAi = [["", "", histText + " " + mathText]];
const vTimes = [[], ["11:00 AM", "", "", "", "", histText], ["10:00 AM", "", "", "", "", mathText]];
const planned = P.dayPlanByWeekday(vAi, {}, vTimes)[2] || [];
check("day plan: times come from Vertical column A", planned.map((c) => c.start).join() === "600,660", planned.map((c) => [c.subj, c.start]));
check("day plan: sorted by time", planned[0].subj === "Math 7A" && planned[1].subj === "History 7A", planned.map((c) => c.subj));
check("day plan: the timed copy wins over the run-together one", planned.length === 2, planned.map((c) => c.subj));

const echo = P.dayPlanByWeekday([["", "", "Math 7A (23) 202 Today we practise. What helps? - NS7-3 Reminders: none."]], {}, vTimes)[2] || [];
check("day plan: a codeless echo of a coded class is dropped", echo.length === 2 && echo.every((c) => c.code), echo.map((c) => `${c.subj}:${c.code}`));


// ---- the code is on Vertical even when the AI column drops it ----
const aiNoCode = [["", "", "History 7A (22) 202 Today we introduce the course. What makes a useful perspective? - Handouts Reminders: none."]];
const vWithCode = [["11:00 AM", "", "", "", "", "History 7A (22) 202 (H001) Today we introduce the course. What makes a useful perspective? - Handouts Reminders: none."]];
const borrowed = P.dayPlanByWeekday(aiNoCode, L, vWithCode)[2] || [];
check("code borrowed from Vertical", borrowed.length === 1 && borrowed[0].code === "H001", borrowed.map((c) => `${c.subj}:${c.code}`));
check("the borrowed code reaches the Lessons row", borrowed[0].page === "p. 2" && borrowed[0].links.some((x) => x.label === "Due Dates handout"), borrowed[0]);

// A subject that runs twice gets its two codes in the order they are written.
const aiTwice = [["", "", "Math 7A (23) 202 Today we introduce. What helps? - a Reminders: none. Math 7A (23) 202 Today we practise. What next? - b Reminders: none."]];
const vTwice = [["", "", "", "", "", "Math 7A (23) 202 (J001) Today we introduce. What helps? - a Reminders: none. Math 7A (23) 202 (J002) Today we practise. What next? - b Reminders: none."]];
const twiceRun = P.dayPlanByWeekday(aiTwice, {}, vTwice)[2] || [];
check("a subject twice keeps both codes in order", twiceRun.map((c) => c.code).join() === "J001,J002", twiceRun.map((c) => `${c.subj}:${c.code}`));


// ---- one handout, however many ways it is written ----
const docA = "https://docs.google.com/document/d/1YzABC/edit?tab=t.0";
const docB = "https://docs.google.com/document/d/1YzABC/edit?usp=sharing";
const docC = "https://docs.google.com/document/d/1YzABC/edit";
check("canonical url: the query does not make a new Google file", P.canonicalUrl(docA) === P.canonicalUrl(docB) && P.canonicalUrl(docB) === P.canonicalUrl(docC), [docA, docB, docC].map(P.canonicalUrl));
check("canonical url: different files stay different", P.canonicalUrl(docA) !== P.canonicalUrl("https://docs.google.com/document/d/9OTHER/edit"));
check("canonical url: scheme and www do not matter", P.canonicalUrl("http://tinyurl.com/BCSQuickCheckin") === P.canonicalUrl("https://www.tinyurl.com/bcsquickcheckin/"));
check("canonical url: an ordinary query still counts", P.canonicalUrl("https://x.org/a?id=1") !== P.canonicalUrl("https://x.org/a?id=2"));

const sameThrice = P.extractLinks(`Print the worksheet ${docA} or here ${docB} or here ${docC}`);
check("one handout however many spellings", sameThrice.links.length === 1, sameThrice.links);

const lessonDupe = { J003: { code: "J003", page: "", homework: "", image: "", video: "", links: [{ label: "Worksheet", url: docB }] } };
const merged = P.classesFromText(`Math 7A (23) 202 (J003) Today we practise. What helps? - Print it (${docA}) Reminders: none.`, lessonDupe);
check("the lesson's copy of a handout is not a second chip", merged[0].links.length === 1, merged[0].links);


// Three links in one run of prose each take the words nearest them, not the
// words that opened the sentence.
const run = P.extractLinks("Complete the Introduction Fill-In-the-Blanks worksheet (or from this link: https://docs.google.com/document/d/1A/edit?tab=t.0 Complete the Getting to Know You form http://tinyurl.com/BCSQuickCheckin by Wed List of all assignments this year: https://docs.google.com/document/d/1B/edit?usp=sharing");
check("three links in one run get three different names", new Set(run.links.map((l) => l.label)).size === 3, run.links.map((l) => l.label));
check("each name is the words nearest its own link", run.links[1].label.includes("Getting to Know You") && run.links[2].label.includes("assignments"), run.links.map((l) => l.label));
check("a due date left over from the link before is dropped", run.links[2].label === "List of all assignments this year", run.links[2].label);


// ---- the shape the Vertical tab writes a lesson in ----
const verticalCell = [
  "Math 7A (23) 202",
  "\u25CFJ001  : Introduction: Overview, expectations, textbook, etc.",
  "Slides presentation on Math [Assign: Complete the Introduction Fill-In-the-Blanks worksheet by Wed Sep 16 handed out in class (or from this link: https://docs.google.com/document/d/1Y_z/edit?tab=t.0 Complete the Getting to Know You form http://tinyurl.com/BCSQuickCheckin by Thu Sep 10",
  "List of all assignments this year: https://docs.google.com/document/d/1fSE/edit?usp=sharing]\uD83D\uDD0D",
].join("\n");
const vc = P.parseClassText(verticalCell);
check("vertical shape: header", vc.subj === "Math 7A" && vc.room === "Rm 202" && !vc.duty, vc);
check("vertical shape: code from the bullet marker", vc.code === "J001", vc.code);
check("vertical shape: the title is the lesson", vc.today === "Introduction: Overview, expectations, textbook, etc.", vc.today);
check("vertical shape: the activity line becomes a bullet", vc.plan.length === 1 && vc.plan[0] === "Slides presentation on Math", vc.plan);
check("vertical shape: the Assign block becomes assignments", vc.assign.length === 2 && vc.assign[1].startsWith("List of all assignments"), vc.assign);
check("vertical shape: no address is left in the words", !/https?:/.test(JSON.stringify([vc.today, vc.plan, vc.assign])), [vc.today, vc.plan, vc.assign]);
check("vertical shape: three handouts, three names", vc.links.length === 3 && new Set(vc.links.map((l) => l.label)).size === 3, vc.links.map((l) => l.label));
check("vertical shape: a line break separates one name from the next", vc.links[2].label === "List of all assignments this year", vc.links[2].label);
check("vertical shape: survives the run-together split", P.classesFromText(verticalCell)[0].plan.length === 1, P.classesFromText(verticalCell)[0]);
check("DisplayAI shape still parses as before", P.parseClassText("Math 7B (23) 207 (J003) Today we practice. What helps? - Do NS7-3. Reminders: bring it.").today.startsWith("Today we practice"));


// ---- the room reads the AI wording, the times and codes come from Vertical ----
const shorthand = "Math 7A (23) 202\n\u25CFJ001  : Introduction: Overview, expectations, textbook, etc.\nSlides presentation on Math [Assign: Do the worksheet]";
const written = "Math 7A (23) 202 Today we introduce the course, materials, and expectations. What helps you learn best in class? - Slides presentation on Math - Complete the Fill-In-the-Blanks worksheet Reminders: handouts in class.";
const spine = [["10:00 AM", "", "", "", "", shorthand]];
// VerticalAi is read from D, so Monday is column index 2; Vertical is read
// from A, so Monday is index 5.
const prose = [["", "", written]];
const blended = P.dayPlanByWeekday(prose, {}, spine)[2] || [];
check("the AI wording is what shows", blended.length === 1 && blended[0].today.startsWith("Today we introduce the course"), blended[0] && blended[0].today);
check("the time still comes from Vertical", blended[0].start === 600, blended[0] && blended[0].start);
check("the code still comes from Vertical", blended[0].code === "J001", blended[0] && blended[0].code);
check("the AI bullets come with it", blended[0].plan.length === 2, blended[0] && blended[0].plan);
const noProse = P.dayPlanByWeekday([], {}, spine)[2] || [];
check("without an AI version the shorthand still reads", noProse[0].today === "Introduction: Overview, expectations, textbook, etc.", noProse[0] && noProse[0].today);


// ---- a Vertical lesson whose title happens to end in a question mark ----
const ceCell = "CE 8A (22) - 212\n\u25CFB002 \uD83D\uDCF7 \uD83C\uDF7F: Continue 'Can I Trust the Bible?' presentation "
  + "[Assign: Take one aspect of this year\u2019s theme verse to make a letter-sized poster. "
  + "It should be \u25CFCreative \u25CFColourful \u25CFInclude the verse Due Wed Sep 16]\uD83D\uDD0D";
const ceLesson = P.parseClassText(ceCell);
check("vertical shape: recognised by its own marks, not by the others failing", ceLesson.today === "Continue 'Can I Trust the Bible?' presentation", ceLesson.today);
check("vertical shape: the title is not read as the lesson question", ceLesson.q === "", ceLesson.q);
check("vertical shape: no code or emoji left in the words", !/B002|\uD83D/.test(ceLesson.today), ceLesson.today);
check("vertical shape: the header still parses", ceLesson.subj === "CE 8A" && ceLesson.room === "Rm 212" && ceLesson.code === "B002", ceLesson);
check("vertical shape: bulleted points inside Assign become separate items", ceLesson.assign.length === 4 && ceLesson.assign[1] === "Creative" && ceLesson.assign[3].startsWith("Include the verse"), ceLesson.assign);


// ---- the bell schedule, and the greeting the sheet computes from NOW() ----
const bells = P.bellSchedule([["8:55 AM"], ["9:05 AM"], ["10:00 AM"], [""], ["11:00 AM"], ["12:00 PM"], ["2:30 PM"], ["3:25 PM"], ["0:36"], ["9:00 AM"]]);
check("bell schedule: the day's times in order", bells.join() === "535,545,600,660,720,870,925", bells);
check("bell schedule: a duration is not a bell", !bells.includes(36), bells);
check("bell schedule: it stops when the run does", bells.length === 7 && !bells.includes(540), bells);

const who = ["everyone", "class", "hard-workers", "JH Students", "students"];
check("greeting: morning", P.evaluateGreeting(who, 9 * 60, 930, 4) === "Good morning, hard-workers!", P.evaluateGreeting(who, 9 * 60, 930, 4));
check("greeting: lunch from 11:56", P.evaluateGreeting(who, 11 * 60 + 56, 930, 2) === "Enjoy your lunch, everyone!", P.evaluateGreeting(who, 11 * 60 + 56, 930, 2));
check("greeting: afternoon up to dismissal", P.evaluateGreeting(who, 14 * 60, 930, 6) === "Good afternoon, students!");
check("greeting: goodbye after it", P.evaluateGreeting(who, 15 * 60 + 40, 930, 6) === "Goodbye, students!");
check("greeting: nothing when the column is empty", P.evaluateGreeting([], 9 * 60, 930, 4) === "");


// ---- the stand-ready window before the last bell ----
check("setup: ready window defaults to five minutes", P.parseSetup([]).dismissalReadyMin === 5, P.parseSetup([]).dismissalReadyMin);
check("setup: a row can change it", P.parseSetup([["", "Stand ready for dismissal", "8", "minutes"]]).dismissalReadyMin === 8);
check("setup: the other labels still read", P.parseSetup([["", "Change time to red", "3", "minutes before end"]]).redAt === 3);

// ---- O Canada: the flag and the words, from the day's column of Poems ----
{
  const poems = [
    ["O Canada \u2014 English", "\u00d4 Canada \u2014 fran\u00e7ais", "", "", ""],
    ["O Canada! Our home and native land!", "\u00d4 Canada! Terre de nos a\u00efeux,", "", "", ""],
    ["", "", "", "", ""],
  ];
  const f = [[], [], ["", '=IMAGE("https://example.org/flag.png")', "", "", ""]];
  const tue = P.anthemOfDay(poems, f, 3); // Sheets counts Sunday as 1
  check("anthem: the day's own column", tue.lines[0] === "\u00d4 Canada \u2014 fran\u00e7ais" && /Terre de nos/.test(tue.lines[1]), tue);
  check("anthem: the flag comes out of the picture cell", tue.image === "https://example.org/flag.png", tue);
  const mon = P.anthemOfDay(poems, f, 2);
  check("anthem: Monday sings in English and has no flag of its own", mon.lines[0] === "O Canada \u2014 English" && mon.image === "", mon);
  check("anthem: the weekend has no column", P.anthemOfDay(poems, f, 1).lines.length === 0);
  check("setup: the anthem window defaults to five minutes", P.parseSetup([]).anthemMin === 5);
  check("setup: a row can change the anthem window", P.parseSetup([["", "O Canada for", "4", "minutes"]]).anthemMin === 4);
}

// ---- the lesson picture and video, from Lessons I and J ----
{
  const rows = [];
  rows[0] = ["~H001", "", "p. 12", "Read p12-18", "", "", "https://drive.google.com/open?id=ABC123", ""];
  rows[1] = ["~J002", "", "", "", "", "", "", ""];
  const runs = [];
  runs[1] = []; runs[1][4] = [{ text: "the diagram", url: "https://example.org/diagram.png" }];
  const L = P.parseLessons(rows, [], runs);
  check("lesson picture: a Drive open?id link is the picture",
    L.H001.image === "https://lh3.googleusercontent.com/d/ABC123", L.H001);
  check("lesson picture: a link attached to the cell's text counts",
    L.J002.image === "https://example.org/diagram.png", L.J002);
  check("lesson row: page and homework still read", L.H001.page === "p. 12" && L.H001.homework === "Read p12-18");
}

// ---- the corrective writing assignment ----
const pgrid = (() => {
  const g = [];
  for (let r = 0; r < 46; r += 1) g[r] = [];
  const cols = [4, 17, 30, 43, 56];
  ["7A", "7B", "7C", "8A", "8B"].forEach((n, i) => { g[2][cols[i] - 1] = n; });
  // Six days: only the last five count, so 7A's poor day outside the window
  // must not add to its tally — it has one inside, which is not enough.
  [[2, 7, 6, 8, 8], [2, 8, 7, 8, 7], [8, 6, 8, 3, 6], [8, 7, 7, 7, 8], [7, 8, 6, 4, 5], [9, 9, 9, 9, 9]]
    .forEach((row, d) => { row.forEach((v, i) => { g[3 + d][cols[i] - 1] = String(v); }); });
  return g;
})();
const owed = P.writingOwed(pgrid, pgrid[2]);
check("writing: two poor days in the last five", owed.writing.join() === "8A", owed);
check("writing: the note says which columns it read", /8A=AQ/.test(owed.writingNote), owed.writingNote);
check("writing: an empty grid says so", P.writingOwed([], []).writing.length === 0);
// A year not yet played: the score rows are still noughts, and a nought is not
// a poor day — it is a day that has not happened.
{
  const g = [];
  for (let r = 0; r < 46; r += 1) g[r] = [];
  const cols = [4, 17, 30, 43, 56];
  ["7A", "7B", "7C", "8A", "8B"].forEach((n, i) => { g[2][cols[i] - 1] = n; });
  [[8, 7, 6, 9, 8], [7, 8, 7, 8, 7]].forEach((row, d) => { row.forEach((v, i) => { g[3 + d][cols[i] - 1] = String(v); }); });
  for (let r = 5; r < 45; r += 1) cols.forEach((c) => { g[r][c - 1] = "0"; });
  const owed = P.writingOwed(g, g[2]);
  check("writing: unplayed days do not count as poor ones", owed.writing.length === 0, owed);
}
check("column letters", P.columnName(4) === "D" && P.columnName(43) === "AQ" && P.columnName(74) === "BV");

// ---- the privilege code, in words ----
check("status words: a pair", P.statusWords("AB1 & B2").words === "Free seat + Free pass", P.statusWords("AB1 & B2"));
check("status words: all three", P.statusWords("BAll 3").words === "All 3");
check("status words: the group letter comes through", P.statusWords("A-FD & B1").letter === "A" && P.statusWords("A-FD & B1").grace === true);
check("status words: the perfect-class bonus", P.statusWords("BAll 3 4").words === "All 3 +2", P.statusWords("BAll 3 4"));
check("status words: recess", P.statusWords("REC").words === "Recess");
// An unlabelled code is the digits themselves: Benefit 1, Benefit 2, Benefit 3.
check("status words: a bare code reads its digits", P.statusWords("A-1000").words === "Free seat", P.statusWords("A-1000"));
check("status words: benefit 3 is the extra Formal Discussion", P.statusWords("A0010").words === "Extra FD", P.statusWords("A0010"));
check("status words: none of them", P.statusWords("A-0000").words === "");

// Each benefit has its own window in the period.
const win = (elapsed) => ({ elapsed, seatMin: 5, laterMin: 15 });
check("benefit windows: the free seat is for the opening minutes",
  P.statusWords("AB1", win(3)).words === "Free seat" && P.statusWords("AB1", win(9)).words === "");
check("benefit windows: the pass waits out the teaching",
  P.statusWords("AB2", win(9)).words === "" && P.statusWords("AB2", win(20)).words === "Free pass");
check("benefit windows: so does the extra Formal Discussion",
  P.statusWords("AFD Only", win(9)).words === "" && P.statusWords("AFD Only", win(40)).words === "Extra FD");
check("benefit windows: all three shows from the first minute",
  P.statusWords("AAll 3", win(1)).words === "All 3" && P.statusWords("AAll 3", win(40)).words === "All 3");
check("benefit windows: the colour follows what is on offer",
  P.statusWords("AB1 & B2", win(3)).code === "AB1" && P.statusWords("AB1 & B2", win(20)).code === "AB2",
  [P.statusWords("AB1 & B2", win(3)), P.statusWords("AB1 & B2", win(20))]);
check("setup: the free-seat window defaults to five minutes", P.parseSetup([]).seatMin === 5);
check("setup: a row can change the free-seat window", P.parseSetup([["", "Free seat for", "7", "minutes"]]).seatMin === 7);
check("status digits: the flags line up with the labels", (() => {
  const a = P.parseStatus("A1100"), b = P.parseStatus("AB1 & B2");
  return a.B1 === b.B1 && a.B2 === b.B2 && a.FD === b.FD;
})(), [P.parseStatus("A1100"), P.parseStatus("AB1 & B2")]);

// ---- the formula evaluator, so Setup's NOW() rules follow the scrubber ----
// A stand-in for the Setup tab: A1:F20, M1:Q8 and the S1:AB8 slot block.
const setupA = [];
setupA[3] = ["", "", "", "", "", ""]; // A4:F4
const setupM = [
  ["everyone", "For Dismissal Messages", "", "", ""],
  ["class", "Lunch", "12:00 PM", "5", ""],
  ["hard-workers", "", "", "", ""],
  ["JH Students", "", "15:25:00", "", ""], // O4 — the dismissal time
  ["students", "", "", "", ""],
];
const slotCells = [
  [], // S1
  [], // S2 (a picture: no text value, only the formula below)
  [], // S3
  [], // S4
];
slotCells[0] = ["", "", "3", "1", "2"];              // S..W row 1 — priorities
slotCells[1] = ["", "", "Memory Verse", "Message", "Lesson Pic"]; // row 2 — names
slotCells[2] = ["", "", "Trust in the Lord with all your heart.", "", ""]; // row 3 — the material
slotCells[3] = ["", "", "", "", ""];                  // row 4 — the sheet's own answer, at its clock
const slotRules = [[], [], [], []];
slotRules[1] = ['=IMAGE("https://example.com/verse-of-the-week.png")']; // S2
slotRules[3] = [
  "", "",
  // U4: the memory verse for the first ten minutes of a CE class, but the
  // picture in S2 once the week's last teaching day comes round.
  '=IF(AND(TIMEVALUE(NOW())>=TIMEVALUE("09:05"),TIMEVALUE(NOW())<TIMEVALUE("09:15")),IF(WEEKDAY(NOW())=6,Setup!S2,Setup!U3),"")',
];
const book = {
  setup: [
    { top: 1, left: 1, width: 6, height: 20, values: setupA },
    { top: 1, left: 13, width: 5, height: 8, values: setupM },
    { top: 1, left: 19, width: 10, height: 8, values: slotCells, formulas: slotRules },
  ],
};
const at = (h, m, day = 8) => new Date(2026, 8, day, h, m, 0); // Sep 8 2026 is a Tuesday
const ev = (f, when) => F.evaluateFormula(f, { book, now: when, sheet: "Setup" });

check("formula: arithmetic and text", ev("=1+2*3&\" boxes\"", at(9, 0)) === "7 boxes", ev("=1+2*3&\" boxes\"", at(9, 0)));
check("formula: TIMEVALUE(NOW()) moves with the clock",
  ev('=IF(TIMEVALUE(NOW())>TIMEVALUE("11:55"),"lunch","before")', at(12, 5)) === "lunch"
  && ev('=IF(TIMEVALUE(NOW())>TIMEVALUE("11:55"),"lunch","before")', at(9, 5)) === "before");
check("formula: WEEKDAY counts Sunday as 1", ev("=WEEKDAY(NOW())", at(9, 0, 11)) === "6", ev("=WEEKDAY(NOW())", at(9, 0, 11)));
check("formula: a reference reads the cell", ev("=Setup!U3", at(9, 0)) === "Trust in the Lord with all your heart.");
check("formula: an =IMAGE() cell hands on its picture",
  ev("=Setup!S2", at(9, 0)) === "https://example.com/verse-of-the-week.png");
check("formula: INDEX over a whole column", ev("=INDEX(Setup!M:M,WEEKDAY(NOW())-1,1)", at(9, 0)) === "class",
  ev("=INDEX(Setup!M:M,WEEKDAY(NOW())-1,1)", at(9, 0)));
// The greeting cell, as the sheet writes it.
const greet = '=if(timevalue(now())<0.5,if(timevalue(now())>timevalue("11:55"),"Enjoy your lunch, ","Good morning, "),if(timevalue(now())<=Setup!O4,"Good afternoon, ","Goodbye, "))&index(Setup!M:M,weekday(now())-1,1)&"!"';
check("formula: the greeting cell, morning", ev(greet, at(9, 0)) === "Good morning, class!", ev(greet, at(9, 0)));
check("formula: the greeting cell, afternoon", ev(greet, at(14, 0)) === "Good afternoon, class!", ev(greet, at(14, 0)));
check("formula: the greeting cell, after dismissal", ev(greet, at(15, 40)) === "Goodbye, class!", ev(greet, at(15, 40)));
// The memory-verse slot as the sheet writes it, cut down to the parts that
// decide what shows: the week's card, the poem, and Setup C19 choosing which
// column of Poems the poem comes from.
{
  const setupA = [];
  setupA[18] = ["", "", "TRUE"]; // C19
  const book2 = {
    setup: [{ top: 1, left: 1, width: 6, height: 20, values: setupA },
            { top: 1, left: 19, width: 10, height: 8, values: [[], [], [], []] }],
    master: [{ top: 1, left: 1, width: 11, height: 2, values: [[], ["", "3"]] }], // B2 = week 3
    poems: [{ top: 1, left: 1, width: 2, height: 60,
              values: [["A one", "B one"], ["A two", "B two"], ["A three", "B three"]] }],
    memorycards: [{ top: 1, left: 8, width: 1, height: 40, values: [["Trust in the Lord"], [""], ["@@@@"], ["with all your heart."]] }],
  };
  const at2 = (h, m) => new Date(2026, 8, 8, h, m, 0); // a Tuesday
  const ev2 = (f) => F.evaluateFormula(f, { book: book2, now: at2(9, 10), sheet: "Setup" });
  check("formula: JOIN over a column", ev2('=join("|",MemoryCards!H:H)').startsWith("Trust in the Lord||@@@@|with all your heart."), ev2('=join("|",MemoryCards!H:H)'));
  check("formula: Setup C19 picks the other column of Poems",
    ev2("=index(if(C19,Poems!B:B,Poems!A:A),Master!B2,1)") === "B three",
    ev2("=index(if(C19,Poems!B:B,Poems!A:A),Master!B2,1)"));
  setupA[18] = ["", "", "FALSE"];
  check("formula: and the usual column when it is off",
    ev2("=index(if(C19,Poems!B:B,Poems!A:A),Master!B2,1)") === "A three");
  check("formula: INDIRECT builds a reference from text",
    F.evaluateFormula('=indirect("Setup!C19")', { book: book2, now: at2(9, 10), sheet: "Setup" }) === "FALSE");
}

// The Daily Update cell (Setup!W5) in miniature: LET binding names, a LAMBDA
// called by name, FILTER over a weekday column with a ROW() condition, and
// TEXT() formatting a date.
{
  const va = [];
  for (let r = 0; r < 14; r += 1) va[r] = [];
  // VerticalAi F..J, rows 6..14 — Thursday is column I.
  const put = (row, col, v) => { va[row - 1][col - 1] = v; };
  // The grid starts at column D, so column I is the fifth of it.
  ["one", "two", "skip-10", "skip-11", "five"].forEach((v, k) => put(6 + k, 6, v));
  const book3 = {
    verticalai: [{ top: 1, left: 4, width: 7, height: 20, values: va }],
    setup: [{ top: 1, left: 1, width: 16, height: 40, values: (() => {
      const g = []; for (let r = 0; r < 40; r += 1) g[r] = [];
      g[28][12] = "Here is today"; // M29
      g[27][1] = "9/17/2026 14:30"; g[27][2] = "History test"; // B28, C28
      return g;
    })() }],
  };
  const ev3 = (f) => F.evaluateFormula(f, { book: book3, now: new Date(2026, 8, 10, 9, 10, 0), sheet: "Setup" });
  check("formula: INDEX takes a whole column", JSON.stringify(ev3("=index(VerticalAi!F6:J14,,4)")) !== "", ev3("=index(VerticalAi!F6:J14,,4)"));
  const filt = '=join("|",filter(index(VerticalAi!F6:J14,,4),(row(VerticalAi!F6:F14)<>8)*(row(VerticalAi!F6:F14)<>9)))';
  check("formula: FILTER with a ROW condition", ev3(filt) === "one|two|five||||", ev3(filt));
  check("formula: LET binds names", ev3("=let(a,2,b,a*3,a+b)") === "8", ev3("=let(a,2,b,a*3,a+b)"));
  check("formula: a LAMBDA called by the name LET gave it",
    ev3('=let(twice,lambda(n,n*2),twice(4)&"")') === "8", ev3('=let(twice,lambda(n,n*2),twice(4)&"")'));
  check("formula: TEXT formats a date", ev3('=text(datevalue("9/17/2026 14:30"),"dddd, mmm d")') === "Thursday, Sep 17",
    ev3('=text(datevalue("9/17/2026 14:30"),"dddd, mmm d")'));
  check("formula: RANDBETWEEN is steady through the day",
    ev3("=randbetween(1,9)") === ev3("=randbetween(1,9)"));
  check("formula: MOD and DAYS", ev3("=mod(days(45000,44990),4)") === "2", ev3("=mod(days(45000,44990),4)"));
}

check("formula: an unknown function falls back", F.evaluateOr("=SPARKLINE(A1:B2)", "the sheet's answer", { book, now: at(9, 0), sheet: "Setup" }) === "the sheet's answer");

// The same rule through the E1 evaluator: the slot has no value in the sheet
// (it was read outside the window), and the board works it out for itself.
const srcSlots = P.buildSources({
  display: [[], [], [], [], [], [], ["0", "", "", ""]],
  displayD: [], displayC: [], setup: setupA,
  slots: slotCells.map((r) => (r || []).slice(2)),
  slotRules: [(slotRules[3] || []).slice(2)],
  slotBlock: slotCells, slotBlockFormulas: slotRules,
  setupMessages: setupM, feature: "", master: [],
});
check("slots: row 3 comes through", srcSlots.slots[0].content === "Trust in the Lord with all your heart.", srcSlots.slots[0]);
const inWindow = P.evaluateFeature(srcSlots, 9 * 60 + 10, at(9, 10));
const outOfWindow = P.evaluateFeature(srcSlots, 10 * 60, at(10, 0));
const onFriday = P.evaluateFeature(srcSlots, 9 * 60 + 10, at(9, 10, 11));
check("E1: the memory verse shows in its ten minutes", inWindow.text === "Trust in the Lord with all your heart.", inWindow);
check("E1: and not outside them", outOfWindow.text === "" && outOfWindow.image === "", outOfWindow);
check("E1: the picture takes its place on the week's last day",
  onFriday.image === "https://example.com/verse-of-the-week.png" && onFriday.text === "", onFriday);
check("E1: without a clock it still reads the sheet's own answer",
  P.evaluateFeature(srcSlots, 9 * 60 + 10).text === "", P.evaluateFeature(srcSlots, 9 * 60 + 10));

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);
