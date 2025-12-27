// backend/reports/sessionReportPdf.js
import PDFDocument from "pdfkit";

/**
 * Render a branded Session Report PDF and return it as a Buffer.
 * The report doc can be a mongoose doc or a plain object.
 */
export async function renderSessionReportPdfBuffer(reportDoc) {
  const report = reportDoc?.toObject ? reportDoc.toObject() : reportDoc;
  if (!report) throw new Error("renderSessionReportPdfBuffer: missing report");

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 54, left: 54, right: 54, bottom: 54 },
    info: {
      Title: `Curriculate Report - ${report.roomCode || "ROOM"}`,
      Author: "Curriculate",
    },
  });

  const buffers = [];
  doc.on("data", (d) => buffers.push(d));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });

  // ---------- Styling helpers ----------
  const brand = {
    name: "Curriculate",
    tagline: "Engage • Learn • Reflect",
  };

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  function header() {
    const y = 18;
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#111111")
      .text(brand.name, 54, y, { continued: true });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#444444")
      .text(`  —  ${brand.tagline}`);

    doc
      .moveTo(54, 44)
      .lineTo(pageWidth - 54, 44)
      .lineWidth(1)
      .strokeColor("#DDDDDD")
      .stroke();

    doc.fillColor("#111111");
    doc.y = 58;
  }

  function footer(pageNum) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#666666")
      .text(
        `Room ${report.roomCode || ""} • Generated ${formatDate(report.generatedAt)} • Page ${pageNum}`,
        54,
        pageHeight - 36,
        { width: pageWidth - 108, align: "center" }
      );
    doc.fillColor("#111111");
  }

  let pageNum = 1;
  header();
  doc.on("pageAdded", () => {
    pageNum += 1;
    header();
  });

  function sectionTitle(t) {
    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(t);
    doc.moveDown(0.35);
  }

  function keyValue(label, value) {
    doc.font("Helvetica-Bold").fontSize(10).text(label, { continued: true });
    doc.font("Helvetica").fontSize(10).text(` ${value || ""}`);
  }

  function bullets(items) {
    const arr = (Array.isArray(items) ? items : []).filter(Boolean);
    if (arr.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#444444").text("—");
      doc.fillColor("#111111");
      return;
    }
    doc.font("Helvetica").fontSize(10).fillColor("#111111");
    for (const it of arr.slice(0, 12)) {
      doc.text(`• ${String(it)}`);
    }
  }

  function ensureSpace(minY = 700) {
    if (doc.y > minY) doc.addPage();
  }

  // ---------- Written response sampler (OpenText / ShortAnswer) ----------
  function coerceTruthyStr(x) {
    if (typeof x === "string") return x.trim();
    if (x == null) return "";
    // common shapes: { text }, { response }, { value }, etc.
    if (typeof x === "object") {
      for (const k of ["answerText", "text", "response", "value", "answer"]) {
        if (typeof x[k] === "string" && x[k].trim()) return x[k].trim();
      }
    }
    return "";
  }

  function normalizeTF(val) {
    if (typeof val === "boolean") return val ? "True" : "False";
    if (typeof val === "number") return val === 0 ? "True" : val === 1 ? "False" : "";
    const s = String(val ?? "").trim().toLowerCase();
    if (s === "true" || s === "t" || s === "yes" || s === "y") return "True";
    if (s === "false" || s === "f" || s === "no" || s === "n") return "False";
    if (s === "0") return "True";
    if (s === "1") return "False";
    return "";
  }

  function deepCollectWrittenSamples(root) {
    const samples = [];
    const seen = new Set();

    const pushSample = (s) => {
      if (!s || !s.text) return;
      const key = `${s.type}|${s.taskTitle}|${s.teamName}|${s.participantName}|${s.text}`;
      if (seen.has(key)) return;
      seen.add(key);
      samples.push(s);
    };

    const visit = (node, path = "") => {
      if (!node || typeof node !== "object") return;

      // common submission-ish node shapes
      const type = String(node.taskType || node.type || node.task_type || "").trim();
      const title = String(node.taskTitle || node.title || node.taskName || "").trim();
      const teamName = String(node.teamName || node.team || node.groupName || "").trim();
      const participantName = String(node.participantName || node.studentName || node.name || "").trim();

      // single answer text
      const directText = coerceTruthyStr(node.answerText || node.answerPayload || node.data || node.response || node.text);
      if (directText) {
        if (type.includes("open-text") || type.includes("open_text") || type.includes("opentext")) {
          pushSample({ type: "open-text", taskTitle: title, teamName, participantName, text: directText });
        } else if (type.includes("short-answer") || type.includes("short_answer") || type.includes("shortanswer")) {
          pushSample({ type: "short-answer", taskTitle: title, teamName, participantName, text: directText });
        }
      }

      // multi answers arrays
      const answersArr =
        (Array.isArray(node.answers) && node.answers) ||
        (Array.isArray(node.subAnswers) && node.subAnswers) ||
        (Array.isArray(node.items) && node.items) ||
        (Array.isArray(node.responses) && node.responses) ||
        null;

      if (answersArr && (type.includes("short") || type.includes("open"))) {
        for (const a of answersArr.slice(0, 12)) {
          const v = coerceTruthyStr(a?.value ?? a?.response ?? a?.text ?? a?.answer ?? a);
          if (!v) continue;
          if (type.includes("open")) {
            pushSample({ type: "open-text", taskTitle: title, teamName, participantName, text: v });
          } else {
            pushSample({ type: "short-answer", taskTitle: title, teamName, participantName, text: v });
          }
        }
      }

      // recurse shallowly with guard
      const keys = Object.keys(node);
      for (const k of keys) {
        const child = node[k];
        if (!child) continue;
        if (typeof child !== "object") continue;
        // avoid cycles / giant blobs
        if (k === "pdf" || k === "html" || k === "raw" || k === "debug") continue;
        visit(child, `${path}.${k}`);
      }
    };

    visit(root, "report");
    return samples;
  }

  function renderWrittenSamplesSection() {
    const rawSamples = deepCollectWrittenSamples(report);

    // Filter and rank
    const openText = rawSamples
      .filter((s) => s.type === "open-text" && s.text && s.text.length >= 20)
      .sort((a, b) => (b.text.length || 0) - (a.text.length || 0))
      .slice(0, 3);

    const shortAns = rawSamples
      .filter((s) => s.type === "short-answer" && s.text && s.text.length >= 1)
      .sort((a, b) => (b.text.length || 0) - (a.text.length || 0))
      .slice(0, 5);

    if (openText.length === 0 && shortAns.length === 0) return;

    doc.addPage();
    sectionTitle("Sample Written Responses");

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#111111")
      .text(
        "A few anonymized examples captured during the session. (Availability depends on what the session stored.)"
      );
    doc.moveDown(0.5);

    const renderSample = (s, idx) => {
      ensureSpace(720);
      const who = [s.teamName, s.participantName].filter(Boolean).join(" • ");
      const headerBits = [];
      if (s.taskTitle) headerBits.push(s.taskTitle);
      if (who) headerBits.push(who);

      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text(`${idx}. ${headerBits.join(" — ") || "Response"}`);
      doc.font("Helvetica").fontSize(10).fillColor("#111111").text(s.text);
      doc.moveDown(0.6);
      doc
        .moveTo(54, doc.y)
        .lineTo(pageWidth - 54, doc.y)
        .lineWidth(0.5)
        .strokeColor("#E6E6E6")
        .stroke();
      doc.moveDown(0.4);
    };

    if (openText.length > 0) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text("📝 Open-text (Top 3)");
      doc.moveDown(0.35);
      openText.forEach((s, i) => renderSample(s, i + 1));
      doc.moveDown(0.2);
    }

    if (shortAns.length > 0) {
      ensureSpace(700);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text("✍️ Short Answer (Top 5)");
      doc.moveDown(0.35);
      shortAns.forEach((s, i) => renderSample(s, i + 1));
    }
  }

  
function taskTypeEmoji(typeRaw) {
  const t = String(typeRaw || "").toLowerCase();
  if (!t) return "🧩";

  // Common objective types
  if (t.includes("matching")) return "🔗";
  if (t.includes("sequence")) return "🔢";
  if (t.includes("timeline")) return "🕰️";
  if (t.includes("sort")) return "🧺";

  // Core question types
  if (t.includes("multiple")) return "✅";
  if (t.includes("true")) return "☑️";
  if (t.includes("short") && t.includes("answer")) return "✍️";
  if (t.includes("open") && t.includes("text")) return "📝";
  if (t.includes("open-text")) return "📝";
  if (t.includes("short")) return "✍️";

  // Games / performance
  if (t.includes("hangman")) return "🪢";
  if (t.includes("flash")) return "🃏";
  if (t.includes("role")) return "🎭";
  if (t.includes("script-play") || t.includes("script_play") || t.includes("scriptplay") || t === "script") return "🎭";
  if (t.includes("narration")) return "🎙️";
  if (t.includes("echo")) return "🔁";
  if (t.includes("mystery")) return "🕵️";
  if (t.includes("debate")) return "🗣️";
  if (t.includes("fake-out") || t.includes("fakeout") || t.includes("balderdash") || t.includes("bluff")) return "🤥";
  if (t.includes("word-weaver") || t.includes("word_weaver") || t.includes("wordweaver")) return "🔤";

  // Paper-based, photographed
  if (t.includes("brain") || t.includes("spark") || t.includes("notes")) return "🧠";
  if (t.includes("mind") || t.includes("mapper") || t.includes("mind-mapper") || t.includes("mind_mapper")) return "🕸️";

  if (t.includes("photo")) return "📷";
  if (t.includes("audio")) return "🎧";

  return "🧩";
}


function formatDate(d) {
    const x = d ? new Date(d) : null;
    if (!x || !Number.isFinite(x.getTime())) return "";
    return x.toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ---------- Page 1: Overview ----------
  sectionTitle("Session Overview");

  keyValue("School:", report.schoolName || "—");
  keyValue("Class:", report.className || "—");
  keyValue("Grade:", report.gradeLevel || "—");
  keyValue("Task Set:", report.taskSetName || "—");
  if (report.subject) keyValue("Subject:", report.subject);

  doc.moveDown(0.5);
  keyValue("Started:", formatDate(report.startedAt) || "—");
  keyValue("Ended:", formatDate(report.endedAt) || "—");

  doc.moveDown(0.8);

  const engagement =
    report.summary?.engagementLevel ||
    report.summary?.engagement ||
    (report.classAverageEngagement != null ? `${report.classAverageEngagement}%` : "—");

  const proficiency =
    report.summary?.proficiencyLevel ||
    report.summary?.proficiency ||
    "—";

  keyValue("Engagement:", engagement);
  keyValue("Overall Proficiency:", proficiency);

  if (report.classAverageScore != null) keyValue("Class Average Score:", `${report.classAverageScore}%`);

  doc.moveDown(0.8);

  sectionTitle("Teacher Summary");
  const teacherSummary =
    report.summary?.teacherSummary ||
    report.summary?.summary ||
    report.summary?.overview ||
    "";
  doc.font("Helvetica").fontSize(10).fillColor("#111111").text(teacherSummary || "—");

  doc.moveDown(0.6);

  sectionTitle("Concepts Covered");
  bullets(report.summary?.conceptsCovered || report.summary?.concepts || []);

  sectionTitle("Activities Completed");
  const activitiesList = report.summary?.activities || report.summary?.activityHighlights || [];
  const fallbackTaskList = Array.isArray(report.summary?.taskList)
    ? report.summary.taskList.map((t) => {
        const type = t?.type || t?.taskType || "";
        const title = t?.title || "";
        return [`${taskTypeEmoji(type)} ${title}`.trim(), type].filter(Boolean).join(" — ");
      })
    : [];
  bullets((Array.isArray(activitiesList) && activitiesList.length ? activitiesList : fallbackTaskList) || []);

  ensureSpace(640);

  sectionTitle("Note to Parents");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text(report.parentNote || "—");

  ensureSpace(620);

  // ---------- Teams table ----------
  sectionTitle("Team Breakdown");

  const teams = Array.isArray(report.teams) ? report.teams : [];

  if (teams.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#444444").text("No teams found.");
    doc.fillColor("#111111");
  } else {
    // Simple table-like rows
    for (const t of teams) {
      ensureSpace(700);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text(t.teamName || "Team");

      doc.font("Helvetica").fontSize(10);
      doc.text(`Members: ${(t.members || []).filter(Boolean).join(", ") || "—"}`);
      doc.text(`Mood (entry): ${formatMood(t.moodEntry)}`);
      doc.text(`Tasks completed: ${t.tasksCompleted ?? 0} / ${Array.isArray(report.summary?.taskList) ? report.summary.taskList.length : "?"}`);
      doc.text(`Engagement: ${t.engagementScore ?? 0}%`);
      doc.text(`Score: ${t.scorePercent ?? 0}%  (Points: ${t.teamPoints ?? 0}/${t.pointsPossible ?? 0})`);

      const fb = t.exitFeedback || {};
      if (fb.highlights || fb.improvements || fb.favoriteTask || fb.rating != null) {
        doc.moveDown(0.15);
        doc.text(`Exit rating: ${fb.rating != null ? fb.rating : "—"}`);
        doc.text(`Highlights: ${fb.highlights || "—"}`);
        doc.text(`Improvements: ${fb.improvements || "—"}`);
        doc.text(`Favorite task: ${fb.favoriteTask || "—"}`);
        doc.text(`Learned: ${fb.learned || "—"}`);

      }

      // Peer-rated / narration-style tasks (optional)
      const narrationRaw =
        t.narrationRatings ||
        t.peerRatings ||
        t.narrationScores ||
        (t.narration && t.narration.ratings) ||
        null;
      const narrationSummary = summarizeRatings(narrationRaw);
      if (narrationSummary) {
        doc.moveDown(0.15);
        doc.text(
          `Narration / peer rating avg: ${narrationSummary.avg.toFixed(1)} (n=${narrationSummary.count})`
        );
      }

      doc.moveDown(0.45);

      doc
        .moveTo(54, doc.y)
        .lineTo(pageWidth - 54, doc.y)
        .lineWidth(0.5)
        .strokeColor("#E6E6E6")
        .stroke();
      doc.moveDown(0.35);
    }
  }

  
  // ---------- Written response samples (optional) ----------
  renderWrittenSamplesSection();

// ---------- Attachments page ----------
  const attachments = Array.isArray(report.attachments) ? report.attachments : [];
  if (attachments.length > 0) {
    doc.addPage();
    sectionTitle("Photo / Recording Submissions");

    doc.font("Helvetica").fontSize(10).fillColor("#111111");
    for (const a of attachments) {
      ensureSpace(720);
      doc.font("Helvetica-Bold").text(a.label || "Submission");
      doc.font("Helvetica").text(`Type: ${a.type || "file"}`);
      if (a.teamName) doc.text(`Team: ${a.teamName}`);
      if (Number.isFinite(a.taskIndex) && a.taskIndex >= 0) doc.text(`Task #: ${a.taskIndex + 1}`);
      doc.text(`URL: ${a.url || ""}`);
      doc.moveDown(0.4);
    }
  }

  // ---------- Optional individual student pages (plan-gated) ----------
  if (report.includeIndividualReports && report.perParticipant && Array.isArray(report.perParticipant)) {
    for (const p of report.perParticipant) {
      doc.addPage();
      sectionTitle("Individual Student Report");

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text(p.name || "Student");
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(10);
      if (p.teamName) doc.text(`Team: ${p.teamName}`);
      if (p.tasksAttempted != null) doc.text(`Tasks attempted: ${p.tasksAttempted}`);
      if (p.correctCount != null) doc.text(`Correct answers: ${p.correctCount}`);
      if (p.accuracyPercent != null) doc.text(`Accuracy: ${p.accuracyPercent}%`);
      if (p.engagementScore != null) doc.text(`Engagement: ${p.engagementScore}%`);

      doc.moveDown(0.8);
      sectionTitle("Notes");
      doc.font("Helvetica").fontSize(10).text(p.notes || "—");
    }
  } else if (!report.includeIndividualReports) {
    // Soft plan tease (subtle)
    doc.addPage();
    sectionTitle("More Reporting (Optional)");
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#111111")
      .text(
        "Individual one-page student reports, advanced scoring breakdowns, and longitudinal progress tracking may be available depending on your plan settings."
      );
  }

  // Footer on each page: easiest is to add at end by iterating pages (PDFKit can’t easily go back).
  // Instead, we write footer right before doc ends for the last page, and for previous pages we rely on header only.
  // If you want footers on every page, we can switch to a page-buffering approach later.

  // At least add footer to last page
  footer(pageNum);

  doc.end();
  return done;
}


function summarizeRatings(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const values = arr
    .map((r) => (typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating)))
    .filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: sum / values.length, count: values.length };
}

function formatMood(moodEntry) {
  if (!moodEntry) return "—";
  const moods = Array.isArray(moodEntry.moods) ? moodEntry.moods : [];
  const excitement = moodEntry.excitement ? String(moodEntry.excitement) : "";
  const parts = [];
  if (moods.length) parts.push(`moods: [${moods.join(", ")}]`);
  if (excitement) parts.push(`note: ${excitement}`);
  return parts.length ? parts.join(" • ") : "—";
}
