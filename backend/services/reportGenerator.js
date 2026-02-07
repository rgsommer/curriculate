// services/reportGenerator.js
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

async function generateSessionReportPDF({ session, sessionAnalytics, studentAnalyticsList }) {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const resultPromise = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header
  doc.fontSize(18).text("Curriculate Session Report", { align: "center" });
  doc.moveDown();
  doc
    .fontSize(12)
    .text(`Teacher: ${session.teacherName || ""}`)
    .text(`Class: ${session.classroomName || ""}`)
    .text(`Task Set: ${session.taskSetName || ""}`)
    .text(`Date: ${new Date(session.startedAt).toLocaleString()}`);
  doc.moveDown();

  // Class summary
  doc.fontSize(14).text("Class Summary", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Class Average Score: ${sessionAnalytics.classAverageScore}%`);
  doc.text(`Class Average Accuracy: ${sessionAnalytics.classAverageAccuracy}%`);
  doc.moveDown();

  // Per-task summary
  doc.fontSize(14).text("Task Breakdown", { underline: true });
  doc.moveDown(0.5);
  sessionAnalytics.tasks.forEach((t, idx) => {
    doc
      .fontSize(12)
      .text(
        `${idx + 1}. [${t.type}] ${t.prompt.slice(0, 80)}...`,
        { continued: false }
      );
    doc.text(`   Avg Score: ${t.avgScore}% | Avg Accuracy: ${t.avgCorrectPct}%`);
    doc.moveDown(0.3);
  });
  doc.addPage();

  // Per-student transcript
  doc.fontSize(16).text("Student Transcripts", { align: "center", underline: true });
  doc.moveDown();
  studentAnalyticsList.forEach((sa, index) => {
    doc.fontSize(14).text(`${sa.studentName} – ${sa.accuracyPct}%`, { underline: true });
    doc
      .fontSize(12)
      .text(
        `Total Points: ${sa.totalPoints}/${sa.maxPoints} | Tasks: ${sa.tasksCompleted}/${sa.tasksAssigned}`
      );
    doc.text(`Average Response Time: ${Math.round(sa.avgLatencyMs)} ms`);
    doc.moveDown(0.5);

    sa.perTask.forEach((pt, i) => {
      doc.text(
        `  ${i + 1}. [${pt.type}] ${pt.prompt.slice(0, 70)}... – ${
          pt.isCorrect ? "Correct" : "Incorrect"
        } (${pt.points} pts)`
      );
    });

    if (index < studentAnalyticsList.length - 1) {
      doc.addPage();
    }
  });

  doc.end();
  return resultPromise; // Buffer
}

module.exports = { generateSessionReportPDF };
