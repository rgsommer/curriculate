// ====================================================================
//  transcriptEmailer.js
//  Sends a transcript email with:
//    • Presenter overview
//    • Group summary
//    • Key concepts
//    • Team scores
//    • Per-participant summaries
//    • OPTIONAL one-page student reports
//
//  Uses:
//    schoolName
//    perspectives[]
//    includeIndividualReports
//
//  Generates both HTML and PDF attachments.
// ====================================================================

import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

// Branding
const BRAND_NAME = "Curriculate";
const BRAND_TAGLINE = "Active learning, live classrooms.";

// ====================================================================
//  TRANSPORT
// ====================================================================
function createTransporter() {
  const {
    EMAIL_HOST,
    EMAIL_PORT,
    EMAIL_USER,
    EMAIL_PASS,
    EMAIL_SECURE,
  } = process.env;

  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT),
    secure: EMAIL_SECURE === "true",
    auth: EMAIL_USER ? { user: EMAIL_USER, pass: EMAIL_PASS } : undefined,
  });
}

// Small helper to pick an upgrade line based on plan
function buildUpgradeLine(planName = "FREE") {
  if (planName === "FREE") {
    return "This transcript shows a session-level overview. PLUS and PRO plans unlock deeper team and student analytics, as well as richer reporting options.";
  }
  if (planName === "PLUS") {
    return "Looking for individual student PDFs and even deeper analytics? The PRO plan unlocks advanced reporting and higher AI limits.";
  }
  // PRO or unknown – keep it very soft or empty
  return "";
}

// ====================================================================
//  HTML BUILDER
// ====================================================================
function buildTranscriptHtml(
  transcript,
  aiSummary,
  schoolName,
  perspectives,
  planName = "FREE"
) {
  const { roomCode, tasksetName, tasks, scores, totalPossible } = transcript;

  const groupSummary = aiSummary?.groupSummary || "";
  const keyConcepts = aiSummary?.keyConcepts || [];
  const perParticipant = aiSummary?.perParticipant || [];

  const perspectiveText =
    perspectives && perspectives.length ? perspectives.join(", ") : "";

  const upgradeLine = buildUpgradeLine(planName);

  const mailOptions = {
    from: '"Curriculate Reports" <noreply@curriculate.net>',
    replyTo: 'noreply@curriculate.net',
    to: teacherEmail,
    subject: subjectLine,
    html: htmlBody,
    attachments, // your PDF report attachment
  };

  // TEAM SCORES
  const teamScoresHtml = Object.entries(scores || {})
    .map(([teamName, pts]) => {
      const pct =
        totalPossible > 0 ? Math.round((pts / totalPossible) * 100) : 0;
      return `
      <tr>
        <td>${teamName}</td>
        <td align="right">${pts}</td>
        <td align="right">${totalPossible}</td>
        <td align="right">${pct}%</td>
      </tr>`;
    })
    .join("");

  // TASK LIST
  const tasksHtml = (tasks || [])
    .map(
      (t) =>
        `<li><strong>Task ${t.index + 1} (${t.points} pts):</strong> ${
          t.title || t.taskType
        }</li>`
    )
    .join("");

  // PER PARTICIPANT
  const participantsHtml = perParticipant
    .map((p) => {
      const catsHtml = (p.categories || [])
        .map(
          (c) =>
            `<div><strong>${c.label}:</strong> ${
              typeof c.percent === "number"
                ? `${c.percent.toFixed(0)}%`
                : "—"
            } – ${c.comment || ""}</div>`
        )
        .join("");

      const eng =
        typeof p.engagementPercent === "number"
          ? `${p.engagementPercent.toFixed(0)}%`
          : "—";
      const final =
        typeof p.finalPercent === "number"
          ? `${p.finalPercent.toFixed(0)}%`
          : "—";

      return `
      <tr>
        <td>${p.teamName}</td>
        <td>${p.studentName}</td>
        <td>
          <div><strong>Final:</strong> ${final}</div>
          <div><strong>Engagement:</strong> ${eng}</div>
          ${catsHtml ? `<div style="margin-top:4px;">${catsHtml}</div>` : ""}
          <div style="margin-top:6px;"><strong>Summary:</strong> ${
            p.summary
          }</div>
        </td>
      </tr>`;
    })
    .join("");

  return `
<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size:14px; color:#111;">

  <h2 style="margin-bottom:4px;">
    Curriculate Session Report Ready
  </h2>

  <p>
    Your session report for <strong>${tasksetName}</strong> (Room ${roomCode}) is ready.
    The full printable report is attached as a PDF.
  </p>

  <hr />

  <h3>Session Overview</h3>
  <p>${aiSummary?.groupSummary || "Students actively participated in this learning session."}</p>

  <p>
    <strong>Concepts covered:</strong>
    ${keyConcepts.length ? keyConcepts.join(", ") : "—"}
  </p>

  <p>
    <strong>Overall engagement:</strong>
    ${aiSummary?.engagementLevel || "Moderate to High"}
  </p>

  <hr />

  <h3>Note for Parents</h3>
  <p style="font-style:italic;">
    Today in ${className || "class"}${gradeLevel ? ` (Grade ${gradeLevel})` : ""},
    students completed a Curriculate activity in which they explored
    ${keyConcepts.length ? keyConcepts.join(", ") : "key concepts"}.
    They worked collaboratively through activities such as
    ${tasks?.map(t => t.title || t.taskType).slice(0,3).join(", ")}.
    Overall engagement was ${aiSummary?.engagementLevel || "strong"}, and students
    demonstrated ${aiSummary?.overallProficiency || "growing proficiency"}.
  </p>

  ${
    upgradeLine
      ? `<p style="font-size:12px; color:#666;">${upgradeLine}</p>`
      : ""
  }

  <p style="font-size:12px; color:#666; margin-top:24px;">
    This is an automated message from Curriculate. Replies to this address are not monitored.
  </p>
</div>
`;
}

// ====================================================================
//  PDF BUILDER
// ====================================================================
async function buildTranscriptPdfBuffer({
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
}) {
  const doc = new PDFDocument({ margin: 40, size: "LETTER" });
  const stream = new PassThrough();
  const chunks = [];

  const upgradeLine = buildUpgradeLine(planName);

  return await new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    doc.pipe(stream);

    const { roomCode, tasksetName, tasks, scores, totalPossible } =
      transcript;
    const groupSummary = aiSummary?.groupSummary || "";
    const keyConcepts = aiSummary?.keyConcepts || [];
    const perParticipant = aiSummary?.perParticipant || [];
    const perspectiveText =
      perspectives && perspectives.length ? perspectives.join(", ") : "";

    // ----------------------------------------------------------
    // HEADER
    // ----------------------------------------------------------
    if (schoolName) doc.fontSize(13).text(schoolName);
    doc.fontSize(11).fillColor("#555").text(`${BRAND_NAME} — ${BRAND_TAGLINE}`);
    if (perspectiveText) {
      doc.fontSize(10).text(`Perspective: ${perspectiveText}`);
    }
    doc.fillColor("#000");
    doc.moveDown();

    // ----------------------------------------------------------
    // PRESENTER OVERVIEW
    // ----------------------------------------------------------
    doc.fontSize(18).text("Session Transcript");
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Task Set: ${tasksetName}`);
    doc.text(`Room: ${roomCode}`);
    doc.moveDown();

    if (groupSummary) {
      doc.fontSize(14).text("Session Summary");
      doc.moveDown(0.3);
      doc.fontSize(11).text(groupSummary);
      doc.moveDown();
    }

    if (keyConcepts.length) {
      doc.fontSize(14).text("Key Concepts");
      doc.moveDown(0.3);
      doc.fontSize(11);
      keyConcepts.forEach((k) => doc.text(`• ${k}`));
      doc.moveDown();
    }

    doc.fontSize(14).text("Tasks in this Activity");
    doc.moveDown(0.3);
    doc.fontSize(11);
    (tasks || []).forEach((t) => {
      doc.text(`• Task ${t.index + 1} (${t.points} pts): ${t.title}`);
    });
    doc.moveDown();

    doc.fontSize(14).text("Team Scores");
    doc.moveDown(0.3);
    doc.fontSize(11);
    for (const [teamName, pts] of Object.entries(scores || {})) {
      const pct =
        totalPossible > 0 ? Math.round((pts / totalPossible) * 100) : 0;
      doc.text(`${teamName}: ${pts}/${totalPossible} (${pct}%)`);
    }
    doc.moveDown();

    if (upgradeLine) {
      doc
        .fontSize(9)
        .fillColor("#666")
        .text(upgradeLine, { align: "center" });
      doc.moveDown();
      doc.fillColor("#000");
    }

    // ----------------------------------------------------------
    // OPTIONAL INDIVIDUAL REPORTS
    // ----------------------------------------------------------
    if (includeIndividualReports && perParticipant.length) {
      for (const p of perParticipant) {
        doc.addPage();

        // Header repeated
        if (schoolName) doc.fontSize(13).text(schoolName);
        doc
          .fontSize(11)
          .fillColor("#555")
          .text(`${BRAND_NAME} — ${BRAND_TAGLINE}`);
        if (perspectiveText) {
          doc.fontSize(10).text(`Perspective: ${perspectiveText}`);
        }
        doc.fillColor("#000");
        doc.moveDown();

        doc.fontSize(18).text("Student Session Report");
        doc.moveDown(0.5);

        doc.fontSize(12).text(`Task Set: ${tasksetName}`);
        doc.text(`Room: ${roomCode}`);
        doc.moveDown(0.5);
        doc.text(`Team: ${p.teamName}`);
        doc.text(`Student: ${p.studentName}`);
        doc.moveDown();

        const eng =
          typeof p.engagementPercent === "number"
            ? `${p.engagementPercent}%`
            : "—";
        const final =
          typeof p.finalPercent === "number" ? `${p.finalPercent}%` : "—";

        doc.fontSize(13).text("Overview");
        doc.moveDown(0.3);
        doc.fontSize(11).text(`Engagement: ${eng}`);
        doc.text(`Overall Mark: ${final}`);
        doc.moveDown(0.5);

        if (p.categories?.length) {
          doc.fontSize(13).text("Category Breakdown");
          doc.moveDown(0.3);
          doc.fontSize(11);
          for (const c of p.categories) {
            const pct =
              typeof c.percent === "number" ? `${c.percent}%` : "—";
            doc.text(`${c.label}: ${pct} — ${c.comment}`);
          }
          doc.moveDown();
        }

        doc.fontSize(13).text("Teacher Comment");
        doc.moveDown(0.3);
        doc.fontSize(11).text(p.summary);
      }
    }

    doc.end();
  });
}

// ====================================================================
//  SEND EMAIL
// ====================================================================
export async function sendTranscriptEmail({
  to,
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
}) {
  if (!to) throw new Error("Missing transcript destination email.");

  const html = buildTranscriptHtml(
    transcript,
    aiSummary,
    schoolName,
    perspectives,
    planName
  );

  const pdfBuffer = await buildTranscriptPdfBuffer({
    transcript,
    aiSummary,
    includeIndividualReports,
    schoolName,
    perspectives,
    planName,
  });

  const transporter = createTransporter();

  await transporter.sendMail({
    from:
      process.env.EMAIL_FROM ||
      process.env.EMAIL_USER ||
      "no-reply@curriculate.net",
    to,
    subject: `Curriculate Transcript — ${transcript.tasksetName} (Room ${transcript.roomCode})`,
    html,
    attachments: [
      {
        filename: "curriculate-transcript.pdf",
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}
