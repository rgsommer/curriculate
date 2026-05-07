#!/usr/bin/env node
// ============================================================
//  simulate-report.mjs
//  Generates a realistic Curriculate session report (HTML + PDF)
//  for 24 students / 8 teams completing a Water Cycle taskset.
//
//  Usage:
//    node scripts/simulate-report.mjs              # save files only
//    RESEND_API_KEY=re_xxx node scripts/simulate-report.mjs --send
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "..", "report-preview");

// ── Simulated students & teams ──────────────────────────────

const STUDENTS = [
  "Ava M.", "Liam K.", "Noor A.",          // Team 1
  "Ethan R.", "Priya S.", "Marcus W.",      // Team 2
  "Sofia G.", "Jackson T.", "Amira H.",     // Team 3
  "Owen B.", "Zara P.", "Lucas D.",         // Team 4
  "Chloe F.", "Kai N.", "Isla J.",          // Team 5
  "Noah C.", "Maya L.", "Dylan E.",         // Team 6
  "Emma V.", "Aiden Q.", "Fatima Z.",       // Team 7
  "Leo X.", "Hannah S.", "Ravi K.",         // Team 8
];

const TEAM_NAMES = [
  "Water Warriors", "Splash Squad", "Cycle Stars", "Raindrop Racers",
  "Cloud Chasers", "Hydro Heroes", "Storm Seekers", "Evap Express",
];

const MOODS = ["😊", "😎", "🤩", "😄", "🤔", "😁", "🥳", "💪"];
const EXIT_FEEDBACK = [
  "Super fun, loved the drawing task!",
  "We learned a lot about condensation.",
  "The riddle was hard but cool.",
  "Wish we had more time!",
  "Really liked working as a team.",
  "The sorting one was our favourite.",
  "We want to do this again!",
  "I didn't know clouds worked like that!",
];

// ── Build teams ─────────────────────────────────────────────

function buildTeams() {
  const teams = [];
  for (let i = 0; i < 8; i++) {
    const members = STUDENTS.slice(i * 3, i * 3 + 3);
    const score = 50 + Math.floor(Math.random() * 45); // 50-94
    teams.push({
      teamName: TEAM_NAMES[i],
      members,
      moodsIn: [MOODS[i], MOODS[(i + 3) % 8], MOODS[(i + 5) % 8]],
      tasksCompleted: 10,
      engagementLabel: ["High", "Very High", "Moderate", "High"][i % 4],
      teamScore: score,
      totalPossible: 100,
      exitFeedback: EXIT_FEEDBACK[i],
    });
  }
  return teams;
}

// ── Build student grades ────────────────────────────────────

function buildStudentGrades(teams) {
  const grades = [];
  for (const t of teams) {
    for (const name of t.members) {
      const pct = Math.max(35, Math.min(100, t.teamScore + Math.floor(Math.random() * 20) - 10));
      const scaled = Math.round(pct * 0.4); // out of 40
      const letter = pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F";
      grades.push({
        studentName: name,
        teamName: t.teamName,
        pointsEarned: Math.round(pct * 0.8),
        pointsPossible: 80,
        percent: pct,
        scaledGrade: scaled,
        maxGrade: 40,
        letterGrade: letter,
      });
    }
  }
  return grades;
}

// ── Task definitions (Water Cycle theme) ────────────────────

const TASKS = [
  { title: "Water Cycle Vocabulary", type: "multiple-choice", points: 10 },
  { title: "Evaporation vs Condensation", type: "sort", points: 10 },
  { title: "Cloud Formation Riddle", type: "riddle", points: 8 },
  { title: "Draw the Water Cycle", type: "draw", points: 12 },
  { title: "Water Cycle Sequence", type: "sequence", points: 10 },
  { title: "Precipitation True or False", type: "true-false", points: 8 },
  { title: "Transpiration Brainstorm", type: "brainstorm-battle", points: 10 },
  { title: "Water Cycle Teach-Back", type: "teach-back", points: 12 },
  { title: "Groundwater Fill-in-the-Blank", type: "cloze", points: 10 },
  { title: "Team Water Cycle Photo", type: "photo", points: 10 },
];

// ── Build transcript & AI summary ───────────────────────────

function buildPayload() {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 45 * 60000).toISOString(); // 45 min ago
  const endedAt = now.toISOString();
  const teams = buildTeams();
  const studentGrades = buildStudentGrades(teams);

  const transcript = {
    roomCode: "WATER-42",
    tasksetName: "The Water Cycle — Grade 5 Science",
    startedAt,
    endedAt,
    tasks: TASKS,
    teamsDetailed: teams,
    totalPossible: 100,
    submissions: [
      { kind: "photo", teamName: "Water Warriors", taskTitle: "Team Water Cycle Photo", filename: "water-warriors-photo.jpg", url: "https://curriculate.net/placeholder" },
      { kind: "photo", teamName: "Splash Squad", taskTitle: "Team Water Cycle Photo", filename: "splash-squad-photo.jpg", url: "https://curriculate.net/placeholder" },
      { kind: "image", teamName: "Cycle Stars", taskTitle: "Draw the Water Cycle", filename: "cycle-stars-drawing.png", url: "https://curriculate.net/placeholder" },
    ],
  };

  const aiSummary = {
    groupSummary: "Students demonstrated strong collaborative engagement with the water cycle content. Most teams correctly identified the key stages of evaporation, condensation, precipitation, and collection. The teach-back and drawing activities generated the richest discussions, with students using scientific vocabulary naturally. Two teams showed exceptional understanding of transpiration, going beyond the core curriculum. The sorting activity effectively revealed common misconceptions about the difference between evaporation and boiling.",
    engagementLabel: "High (87%)",
    overallProficiency: "Proficient (78%)",
    keyConcepts: [
      "Evaporation", "Condensation", "Precipitation", "Collection",
      "Transpiration", "Water vapour", "Cloud formation", "Groundwater",
      "Runoff", "The hydrological cycle",
    ],
    activities: TASKS.map((t) => `${t.title} (${t.points} pts)`),
    skillsDeveloped: [
      "Scientific vocabulary", "Sequencing", "Visual communication",
      "Collaborative reasoning", "Peer teaching", "Critical thinking",
    ],
    classChatBlurb: "Today in Grade 5 Science, students explored the water cycle through 10 interactive stations including drawing, sorting, brainstorming, and teaching each other! They worked in teams of 3 to master concepts like evaporation, condensation, and precipitation. Engagement was high and the class averaged 78% overall. Ask your child which stage of the water cycle they found most surprising!",
    cognitiveProfile: "The task set provided a well-balanced cognitive experience. Lower-order tasks (vocabulary recall, true/false) built foundational knowledge, while higher-order tasks (teach-back, brainstorm battle) pushed students to synthesize and evaluate. The draw task bridged understanding and creation effectively.",
    standardsAlignment: [
      { code: "ON-SCI-5.2", standard: "Understanding Earth and Space Systems: Water and the Environment", connection: "Students explored the continuous cycling of water through evaporation, condensation, precipitation, and collection." },
      { code: "ON-SCI-5.3", standard: "Investigating the Water Cycle", connection: "Teams investigated how water moves through different states and environments using hands-on sorting and sequencing activities." },
    ],
    perParticipant: STUDENTS.slice(0, 6).map((name, i) => ({
      studentName: name,
      teamName: TEAM_NAMES[Math.floor(i / 3)],
      engagementPercent: 70 + Math.floor(Math.random() * 25),
      finalPercent: 65 + Math.floor(Math.random() * 30),
      categories: [
        { label: "Knowledge & Understanding", percent: 70 + Math.floor(Math.random() * 25), comment: "Solid grasp of key vocabulary." },
        { label: "Thinking & Inquiry", percent: 60 + Math.floor(Math.random() * 30), comment: "Good problem-solving in sequencing tasks." },
        { label: "Communication", percent: 65 + Math.floor(Math.random() * 30), comment: "Contributed well during teach-back." },
        { label: "Application", percent: 70 + Math.floor(Math.random() * 25), comment: "Connected concepts to real-world examples." },
      ],
      summary: `${name} participated actively throughout the session, demonstrating ${i % 2 === 0 ? "strong" : "growing"} understanding of the water cycle stages. ${i % 3 === 0 ? "Showed leadership during the brainstorm activity." : "Engaged well with peers during collaborative tasks."}`,
    })),
  };

  const bloomsTaxonomy = {
    totalTaskCount: 10,
    cognitiveTaskCount: 10,
    highestLevel: "Create",
    dominantLevel: "Understand",
    summary: "6 of 10 tasks target higher-order thinking (Apply and above). The mix of recall, application, and creation tasks provides a well-rounded cognitive experience appropriate for Grade 5.",
    levels: [
      { label: "Remember", color: "#ef4444", primaryCount: 2, totalCount: 2 },
      { label: "Understand", color: "#f97316", primaryCount: 3, totalCount: 3 },
      { label: "Apply", color: "#eab308", primaryCount: 2, totalCount: 2 },
      { label: "Analyze", color: "#22c55e", primaryCount: 1, totalCount: 1 },
      { label: "Evaluate", color: "#3b82f6", primaryCount: 1, totalCount: 1 },
      { label: "Create", color: "#8b5cf6", primaryCount: 1, totalCount: 1 },
    ],
  };

  return {
    transcript,
    aiSummary,
    studentGrades,
    bloomsTaxonomy,
    teams,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const sendMode = process.argv.includes("--send");
  const { transcript, aiSummary, studentGrades, bloomsTaxonomy } = buildPayload();

  const params = {
    to: "rgsommer@me.com",
    transcript,
    aiSummary,
    includeIndividualReports: true,
    schoolName: "Westwood Public School",
    perspectives: ["Science", "Grade 5"],
    planName: "PRO",
    className: "5A — Ms. Thompson",
    gradeLevel: "5",
    assessmentCategories: [
      { label: "Knowledge & Understanding" },
      { label: "Thinking & Inquiry" },
      { label: "Communication" },
      { label: "Application" },
    ],
    studentGrades,
    gradingConfig: { maxGrade: 40 },
    bloomsTaxonomy,
  };

  if (sendMode) {
    // Actually send via the real emailer
    if (!process.env.RESEND_API_KEY) {
      console.error("❌ Set RESEND_API_KEY to send. Or run without --send to preview files.");
      process.exit(1);
    }
    const { sendTranscriptEmail } = await import("../email/transcriptEmailer.js");
    await sendTranscriptEmail(params);
    console.log("✅ Report email sent to rgsommer@me.com!");
    return;
  }

  // Preview mode — generate HTML + PDF files
  // We need to call the internal functions directly, so let's replicate the flow
  const { default: PDFDocument } = await import("pdfkit");

  // Dynamically import the module and access buildEmailHtml + buildReportPdfBuffer
  // Since they're not exported, we call sendTranscriptEmail but intercept the send
  // Instead, let's just generate the HTML by importing the module text and extracting

  // Simpler approach: mock sendSystemEmail to capture the output
  const origModule = await import("../email/shareInviteEmailer.js");
  const origSend = origModule.sendSystemEmail;

  let capturedHtml = "";
  let capturedPdf = null;
  let capturedSubject = "";

  // Monkey-patch sendSystemEmail to capture instead of send
  const shareInviteModule = await import("../email/shareInviteEmailer.js");

  // We can't easily monkey-patch ESM exports, so let's use a different approach:
  // Set RESEND_API_KEY to a dummy and intercept the fetch
  process.env.RESEND_API_KEY = "PREVIEW_MODE";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedHtml = body.html;
    capturedSubject = body.subject;
    if (body.attachments?.length) {
      capturedPdf = Buffer.from(body.attachments[0].content, "base64");
    }
    // Return a fake success response
    return { ok: true, json: async () => ({ id: "preview-mode" }) };
  };

  const { sendTranscriptEmail } = await import("../email/transcriptEmailer.js");
  await sendTranscriptEmail(params);

  // Restore
  globalThis.fetch = originalFetch;
  delete process.env.RESEND_API_KEY;

  // Save files
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const htmlPath = path.join(OUT_DIR, "report-preview.html");
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${capturedSubject}</title>
<style>body{margin:0;padding:20px;background:#f1f5f9;font-family:system-ui,sans-serif;}</style>
</head><body>${capturedHtml}</body></html>`;
  fs.writeFileSync(htmlPath, fullHtml);
  console.log(`✅ HTML email preview: ${htmlPath}`);

  if (capturedPdf) {
    const pdfPath = path.join(OUT_DIR, "Curriculate-Report-WATER-42.pdf");
    fs.writeFileSync(pdfPath, capturedPdf);
    console.log(`✅ PDF attachment:     ${pdfPath}`);
  }

  console.log(`\nTo actually send this email:\n  RESEND_API_KEY=re_xxx node scripts/simulate-report.mjs --send`);
}

main().catch((err) => { console.error(err); process.exit(1); });
