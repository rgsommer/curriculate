// ====================================================================
//  transcriptEmailer.js
//  Sends a transcript email with:
//    • Teacher overview
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
    auth: EMAIL_USER
      ? { user: EMAIL_USER, pass: EMAIL_PASS }
      : undefined,
  });
}

// ====================================================================
//  HTML BUILDER
// ====================================================================
function buildTranscriptHtml(
  transcript,
  aiSummary,
  schoolName,
  perspectives
) {
  const { roomCode, tasksetName, tasks, scores, totalPossible } =
    transcript;

  const groupSummary = aiSummary?.groupSummary || "";
  const keyConcepts = aiSummary?.keyConcepts || [];
  const perParticipant = aiSummary?.perParticipant || [];

  const perspectiveText =
    perspectives && perspectives.length
      ? perspectives.join(", ")
      : "";

  // TEAM SCORES
  const teamScoresHtml = Object.entries(scores || {})
    .map(([teamName, pts]) => {
      const pct =
        totalPossible > 0
          ? Math.round((pts / totalPossible) * 100)
          : 0;
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
<div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size:14px; color:#111;">
  <div style="border-bottom:1px solid #ccc; padding-bottom:6px; margin-bottom:12px;">
    ${schoolName ? `<div style="font-weight:600;">${schoolName}</div>` : ""}
    <div style="font-size:12px; color:#555;">
      Produced by <strong>${BRAND_NAME}</strong> — ${BRAND_TAGLINE}
    </div>
    ${
      perspectiveText
        ? `<div style="font-size:11px; color:#444;">Perspective: ${perspectiveText}</div>`
        : ""
    }
  </div>

  <h1 style="font-size:20px; margin:0 0 4px;">Session Transcript</h1>
  <p><strong>Task Set:</strong> ${tasksetName}</p>
  <p><strong>Room:</strong> ${roomCode}</p>

  ${
    groupSummary
      ? `<h2 style="font-size:16px; margin-top:16px;">Session summary</h2><p>${groupSummary}</p>`
      : ""
  }

  ${
    keyConcepts.length
      ? `<h3 style="font-size:15px; margin-top:16px;">Key concepts</h3><ul>${keyConcepts
          .map((k) => `<li>${k}</li>`)
          .join("")}</ul>`
      : ""
  }

  <h3 style="font-size:15px; margin-top:16px;">Tasks in this activity</h3>
  <ul>${tasksHtml}</ul>

  <h3 style="font-size:15px; margin-top:16px;">Team scores</h3>
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; width:100%; border-color:#ddd;">
    <thead style="background:#f3f3f3;">
      <tr><th>Team</th><th>Score</th><th>Out Of</th><th>Percent</th></tr>
    </thead>
    <tbody>
      ${
        teamScoresHtml ||
        `<tr><td colspan="4">No scores recorded.</td></tr>`
      }
    </tbody>
  </table>

  ${
    participantsHtml
      ? `<h3 style="font-size:15px; margin-top:16px;">Individual / Team Summaries</h3>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; width:100%; border-color:#ddd;">
        <thead style="background:#f3f3f3;">
          <tr><th>Team</th><th>Student</th><th>Results & Summary</th></tr>
        </thead>
        <tbody>${participantsHtml}</tbody>
      </table>`
      : ""
  }

  <p style="margin-top:16px; font-size:12px; color:#666;">
    This transcript was generated by ${BRAND_NAME}'s AI assistant.
  </p>
</div>`;
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
}) {
  const doc = new PDFDocument({ margin: 40, size: "LETTER" });
  const stream = new PassThrough();
  const chunks = [];

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
      perspectives && perspectives.length
        ? perspectives.join(", ")
        : "";

    // ----------------------------------------------------------
    // HEADER
    // ----------------------------------------------------------
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

    // ----------------------------------------------------------
    // TEACHER OVERVIEW
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
        totalPossible > 0
          ? Math.round((pts / totalPossible) * 100)
          : 0;
      doc.text(`${teamName}: ${pts}/${totalPossible} (${pct}%)`);
    }
    doc.moveDown();

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
          typeof p.finalPercent === "number"
            ? `${p.finalPercent}%`
            : "—";

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
              typeof c.percent === "number"
                ? `${c.percent}%`
                : "—";
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
}) {
  if (!to) throw new Error("Missing transcript destination email.");

  const html = buildTranscriptHtml(
    transcript,
    aiSummary,
    schoolName,
    perspectives
  );

  const pdfBuffer = await buildTranscriptPdfBuffer({
    transcript,
    aiSummary,
    includeIndividualReports,
    schoolName,
    perspectives,
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
