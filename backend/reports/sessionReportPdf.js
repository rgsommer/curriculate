// backend/reports/sessionReportPdf.js
import PDFDocument from "pdfkit";

/**
 * Fetch an image as a pdfkit-embeddable Buffer (PNG or JPEG only — pdfkit does
 * not support SVG/WebP). Accepts http(s) URLs and data: URIs. Best-effort with
 * an 8s timeout; returns null on any failure or unsupported format.
 */
async function fetchImageBytes(url) {
  try {
    if (!url || typeof url !== "string") return null;
    let buf, ct;
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      ct = m[1];
      buf = Buffer.from(m[2], "base64");
    } else if (/^https?:\/\//i.test(url)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      ct = res.headers.get("content-type") || "";
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      return null;
    }
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (isPng || isJpeg || /png|jpe?g/i.test(ct)) return buf;
    return null; // svg/webp/etc — pdfkit can't embed
  } catch {
    return null;
  }
}

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
        } else if (type.includes("letter")) {
          pushSample({ type: "letter", taskTitle: title, teamName, participantName, text: directText });
        } else if (type.includes("case") && type.includes("study") || type.includes("casestudy")) {
          pushSample({ type: "case-study", taskTitle: title, teamName, participantName, text: directText });
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

    const letterSamples = rawSamples
      .filter((s) => s.type === "letter" && s.text && s.text.length >= 20)
      .sort((a, b) => (b.text.length || 0) - (a.text.length || 0))
      .slice(0, 3);

    const caseSamples = rawSamples
      .filter((s) => s.type === "case-study" && s.text && s.text.length >= 20)
      .sort((a, b) => (b.text.length || 0) - (a.text.length || 0))
      .slice(0, 3);

    if (openText.length === 0 && shortAns.length === 0 && letterSamples.length === 0 && caseSamples.length === 0) return;

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

    if (letterSamples.length > 0) {
      ensureSpace(700);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text("✉️ Letter Writing (Top 3)");
      doc.moveDown(0.35);
      letterSamples.forEach((s, i) => renderSample(s, i + 1));
      doc.moveDown(0.2);
    }

    if (caseSamples.length > 0) {
      ensureSpace(700);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text("🔬 Case Study (Top 3)");
      doc.moveDown(0.35);
      caseSamples.forEach((s, i) => renderSample(s, i + 1));
      doc.moveDown(0.2);
    }

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

  // Collect every student-submitted image artifact (photos of paper work,
  // handwriting/drawing snaps, photo challenges, team selfies). Targets
  // SUBMISSION fields only — never the task's own prompt diagram.
  function deepCollectSubmittedImages(root) {
    const out = [];
    const seen = new Set();
    const FIELDS = ["photoUrl", "photoDataUrl", "handwritingPhotoUrl", "drawingDataUrl", "imageDataUrl", "selfieUrl", "snapshotUrl"];
    const ARRAYS = ["playerPhotos", "paperPhotos", "photos", "attachments", "submissions"];
    const isImg = (s) =>
      typeof s === "string" &&
      (s.startsWith("data:image/") ||
        (/^https?:\/\//i.test(s) && (/\.(png|jpe?g|webp)(\?|$)/i.test(s) || /amazonaws\.com|s3[.-]/i.test(s))));
    const add = (src, label) => { if (isImg(src) && !seen.has(src)) { seen.add(src); out.push({ src, label: String(label || "Submission").slice(0, 80) }); } };
    const visit = (node, ctx) => {
      if (!node || typeof node !== "object" || out.length >= 24) return;
      if (Array.isArray(node)) { node.forEach((n) => visit(n, ctx)); return; }
      const label = node.playerName || node.studentName || node.participantName || node.teamName || node.title || node.taskTitle || node.taskType || node.type || ctx;
      for (const f of FIELDS) add(node[f], label);
      for (const key of ARRAYS) {
        if (Array.isArray(node[key])) for (const p of node[key]) add(p?.url || p?.photoUrl || p?.photoDataUrl || p?.src, p?.name || label);
      }
      for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") visit(node[k], label);
    };
    visit(root, "");
    return out;
  }

  async function renderSubmittedWorkSection() {
    const imgs = deepCollectSubmittedImages(report);
    if (!imgs.length) return;
    ensureSpace(80);
    sectionTitle("Submitted Student Work");
    doc.font("Helvetica").fontSize(9).fillColor("#6b7280")
      .text("Artifacts students submitted during the session (paper photos, drawings, snapshots).");
    doc.moveDown(0.4);
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    for (const it of imgs) {
      const buf = await fetchImageBytes(it.src);
      if (!buf) continue;
      ensureSpace(230);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(it.label, { width: w });
      const y = doc.y + 2;
      try {
        doc.image(buf, doc.page.margins.left, y, { fit: [w, 210], align: "left", valign: "top" });
        doc.y = y + 210 + 10;
      } catch (_) { /* skip corrupt image */ }
    }
  }


function taskTypeEmoji(typeRaw) {
  const t = String(typeRaw || "").toLowerCase();
  if (!t) return "🧩";

  // Common objective types
  if (t.includes("labelme") || t.includes("label-me")) return "🏷️";
  if (t.includes("matching")) return "🔗";
  if (t.includes("sequence")) return "🔢";
  if (t.includes("timeline")) return "🕰️";
  if (t.includes("sort")) return "🧺";

  // Venn / compare / spot-the-diff
  if (t.includes("venn")) return "⭕";
  if (t.includes("diff")) return "🔍";

  // Quick draw / charades
  if (t.includes("speed-draw") || t.includes("speeddraw") || t.includes("speed_draw")) return "⚡️";
  if (t.includes("draw-mime") || t.includes("drawmime") || t.includes("draw_mime")) return "🎭";
  if (t.includes("mad-dash") || t.includes("mad_dash") || t.includes("maddash")) return "🏃‍♂️⚡";

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
  if (t.includes("brainstorm")) return "💡";
  if (t.includes("collaboration") || t.includes("collab")) return "🤝";
  if (t.includes("pet") && (t.includes("feed") || t.includes("feeding") || t.includes("pet-feeding") || t.includes("pet_feeding"))) return "🐾";

  // Paper-based, photographed
  if (t.includes("brain") || t.includes("spark") || t.includes("notes")) return "🧠";
  if (t.includes("mind") || t.includes("mapper") || t.includes("mind-mapper") || t.includes("mind_mapper")) return "🕸️";

  // Written / AI-feedback types
  if (t.includes("letter")) return "✉️";
  if (t.includes("case") && t.includes("study")) return "🔬";
  if (t.includes("case-study") || t.includes("casestudy") || t.includes("case_study")) return "🔬";

  // Reading comp & vocabulary
  if (t.includes("reading") && (t.includes("comp") || t.includes("comprehension"))) return "📖";
  if (t.includes("vocab")) return "📚";

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

  

  // Task-aware summary card (simple PDF "card" block)
  async function renderTaskSummaryCards(tasks) {
    const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
    if (!list.length) return;

    sectionTitle("Task Summary Cards");

    const cardPad = 8;
    const cardGap = 10;

    for (const t of list) {
      ensureSpace(160);

      const type = String(t.taskType || t.type || "").trim();
      const title = String(t.title || "").trim() || "Task";
      const prompt = String(t.prompt || "").trim();
      const emoji = taskTypeEmoji(type);

      // Card background
      const x = doc.page.margins.left;
      const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const y0 = doc.y;

      // We'll measure dynamically by rendering into an estimated height; then draw border.
      const startY = y0;
      const innerX = x + cardPad;
      const innerW = w - cardPad * 2;

      doc.save();
      doc.roundedRect(x, startY, w, 1, 10).strokeColor("#e5e7eb").lineWidth(1).stroke();
      doc.restore();

      doc.x = innerX;
      doc.y = startY + cardPad;

      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text(`${emoji} ${title}`, {
        width: innerW,
      });

      if (prompt) {
        doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(10).fillColor("#111111").text(prompt, { width: innerW });
      }

      // Type-specific bullets
      const bulletsLines = [];
      const norm = type;

      if (norm === "mad-dash" || norm === "mad_dash" || norm === "maddash" || norm === "mad-dash-sequence" || norm === "mad_dash_sequence" || norm === "maddashsequence") {
        const cfg = t.config && typeof t.config === "object" ? t.config : {};
        const route = (Array.isArray(t.sequence) ? t.sequence : null) || (Array.isArray(cfg.sequence) ? cfg.sequence : null) || null;
        const scans = route ? route.length : (Number.isFinite(Number(cfg.length)) ? Number(cfg.length) : null);
        bulletsLines.push(scans != null ? `Route: ${scans} scans` : "Route: 3–5 scans");
        bulletsLines.push("Wrong scan resets the route");
        bulletsLines.push("Scoring: completion + best-time bonus");
        bulletsLines.push("Play: intra-team turns + inter-team ranking");
      }

      if (norm === "diff-detective") {
        const original = String(t.original || "").trim();
        const modified = String(t.modified || "").trim();
        const diffCount = Array.isArray(t.differences) ? t.differences.length : null;
        if (original) bulletsLines.push(`Original provided (${Math.min(original.length, 240)} chars shown in app).`);
        if (modified) bulletsLines.push(`Modified provided (${Math.min(modified.length, 240)} chars shown in app).`);
        if (diffCount != null) bulletsLines.push(`Expected differences: ${diffCount}.`);
        bulletsLines.push("Skill focus: close reading, error detection, careful comparison.");
      } else if (norm === "physical-mystery-clues") {
        const clues = Array.isArray(t.clues) ? t.clues : [];
        if (clues.length) bulletsLines.push(`Clues: ${clues.length} item(s).`);
        const sol = String(t.solution || t.answer || "").trim();
        if (sol) bulletsLines.push("Includes a teacher-defined solution/check.");
        bulletsLines.push("Skill focus: observation + reasoning, remembering details while moving.");
      } else if (norm === "vennsort") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const circles = Array.isArray(cfg.circles) ? cfg.circles : Array.isArray(t.circles) ? t.circles : [];
        const items = Array.isArray(cfg.items) ? cfg.items : Array.isArray(t.items) ? t.items : [];
        if (circles.length) bulletsLines.push(`Circles: ${circles.map((c) => c.label || c.name || c).join(" / ")}`);
        if (items.length) bulletsLines.push(`Items: ${items.length}. Drag into correct Venn region(s).`);
        bulletsLines.push("Skill focus: nuanced classification + intersections.");
      } else if (norm === "draw-mime") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : Array.isArray(t.prompts) ? t.prompts : [];
        const mode = String(cfg.mode || t.mode || "choose");
        if (mode) bulletsLines.push(`Mode: ${mode}.`);
        if (prompts.length) bulletsLines.push(`Prompt bank: ${prompts.length}.`);
        bulletsLines.push("Skill focus: multimodal encoding + teamwork guessing.");
      } else if (norm === "speed-draw") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : Array.isArray(t.prompts) ? t.prompts : [];
        if (prompts.length) bulletsLines.push(`Prompt bank: ${prompts.length}.`);
        bulletsLines.push("Skill focus: rapid retrieval + concept visualization.");
      }

      if (norm === "brainstorm-battle") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const seed = String(cfg.seedTopic || t.seedTopic || "").trim();
        const slots = Number.isFinite(Number(cfg.ideaSlots)) ? Number(cfg.ideaSlots) : Number.isFinite(Number(t.ideaSlots)) ? Number(t.ideaSlots) : null;
        const voting = typeof cfg.enableVoting === "boolean" ? cfg.enableVoting : typeof t.enableVoting === "boolean" ? t.enableVoting : null;
        if (seed) bulletsLines.push(`Seed topic: ${seed.length > 80 ? seed.slice(0, 80) + "…" : seed}`);
        if (slots != null) bulletsLines.push(`Idea slots: ${slots}.`);
        if (voting != null) bulletsLines.push(`Voting: ${voting ? "enabled" : "off"}.`);
        bulletsLines.push("Open-ended brainstorm: divergent thinking + collaboration.");
      }

      if (norm === "collaboration") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const minWords = Number.isFinite(Number(cfg.minWords)) ? Number(cfg.minWords) : null;
        const bonus = typeof cfg.bonusComparisonEnabled === "boolean" ? cfg.bonusComparisonEnabled : null;
        const critCount = Array.isArray(cfg.rubric?.criteria) ? cfg.rubric.criteria.length : Array.isArray(cfg.criteria) ? cfg.criteria.length : null;
        if (minWords != null) bulletsLines.push(`Minimum length: ~${minWords} words.`);
        if (bonus != null) bulletsLines.push(`Bonus comparison: ${bonus ? "on" : "off"}.`);
        if (critCount != null) bulletsLines.push(`Rubric criteria: ${critCount}.`);
        bulletsLines.push("Inter-team: write → read another team → reply/extend.");
      }

      if (norm === "live-debate") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const topics = Array.isArray(cfg.topics) ? cfg.topics : Array.isArray(t.topics) ? t.topics : [];
        const prep = Number.isFinite(Number(cfg.prepSeconds)) ? Number(cfg.prepSeconds) : null;
        const max = Number.isFinite(Number(cfg.maxSeconds)) ? Number(cfg.maxSeconds) : null;
        const roles = Array.isArray(cfg.roles) ? cfg.roles : null;
        if (topics.length) bulletsLines.push(`Topic choices: ${topics.length}.`);
        if (prep != null) bulletsLines.push(`Prep time: ${Math.round(prep)}s.`);
        if (max != null) bulletsLines.push(`Speaking cap: ${Math.round(max)}s per turn.`);
        if (roles && roles.length) bulletsLines.push(`Role slots: ${roles.length}.`);
        bulletsLines.push("Timed speaking turns + rebuttals; AI-scored reasoning.");
      }

      if (norm === "pet-feeding") {
        const cfg = (t.config && typeof t.config === "object" && t.config) || {};
        const pet = String(cfg.petName || t.petName || "").trim();
        const pack = String(cfg.pack || t.pack || cfg.theme || t.theme || "").trim();
        const pts = Number.isFinite(Number(cfg.pointsAwarded)) ? Number(cfg.pointsAwarded) : Number.isFinite(Number(t.pointsAwarded)) ? Number(t.pointsAwarded) : null;
        if (pet) bulletsLines.push(`Pet: ${pet}.`);
        if (pack) bulletsLines.push(`Pack/theme: ${pack}.`);
        if (pts != null) bulletsLines.push(`Points: ${pts}.`);
        bulletsLines.push("Motivation loop: correct work powers up your pet.");
      }

      if (norm === "treasure-runner") {
        bulletsLines.push("Arcade sprint: dodge obstacles, grab coins, and finish strong before time runs out.");
        bulletsLines.push("Skill focus: attention control, quick decision-making, and perseverance under pressure.");
      }

      if (norm === "letter") {
        const cfg = t.config && typeof t.config === "object" ? t.config : {};
        const recipient = String(cfg.recipientName || cfg.recipient || "").trim();
        const era = String(cfg.era || cfg.timePeriod || "").trim();
        if (recipient) bulletsLines.push(`Recipient: ${recipient}${era ? ` (${era})` : ""}.`);
        bulletsLines.push("Write a letter to a historical/fictional character; receive an AI-generated reply.");
        bulletsLines.push("Skill focus: perspective-taking, creative writing, vocabulary in context.");
      }

      if (norm === "case-study") {
        const cfg = t.config && typeof t.config === "object" ? t.config : {};
        const expertRole = String(cfg.expertRole || "Subject Expert").trim();
        const concepts = Array.isArray(cfg.relevantConcepts) ? cfg.relevantConcepts : [];
        bulletsLines.push(`Expert reviewer: ${expertRole}.`);
        if (concepts.length) bulletsLines.push(`Key concepts: ${concepts.slice(0, 6).join(", ")}${concepts.length > 6 ? "…" : ""}.`);
        bulletsLines.push("Analyze a real-world scenario; receive AI expert feedback on your solution.");
        bulletsLines.push("Skill focus: critical thinking, applied reasoning, vocabulary usage.");
      }

      if (norm === "labelme") {
        const labels = Array.isArray(t.labels) ? t.labels : Array.isArray(t.config?.labels) ? t.config.labels : [];
        labels.forEach((l) => { if (l?.id && l?.correct) bulletsLines.push(`${l.id} → ${l.correct}`); });
        bulletsLines.push("Students match each marker A–E to the correct term on the diagram.");
      }

      if (bulletsLines.length) {
        doc.moveDown(0.25);
        doc.font("Helvetica").fontSize(10).fillColor("#111111");
        bullets(bulletsLines);
      }

      // Label Me: embed the diagram/map itself so the report shows what was
      // labelled (pdfkit handles PNG/JPEG; SVG/failed fetch is skipped).
      if (norm === "labelme") {
        const imgUrl = t.imageUrl || t.config?.imageUrl || "";
        const imgBuf = await fetchImageBytes(imgUrl);
        if (imgBuf) {
          ensureSpace(250);
          doc.moveDown(0.3);
          const imgY = doc.y;
          const imgH = 220;
          try {
            doc.image(imgBuf, innerX, imgY, { fit: [innerW, imgH], align: "center", valign: "top" });
            doc.y = imgY + imgH + 6;
          } catch (_) { /* corrupt image — skip */ }
        } else if (imgUrl) {
          doc.moveDown(0.2);
          doc.font("Helvetica-Oblique").fontSize(9).fillColor("#6b7280").text("Diagram available in the live activity.", { width: innerW });
          doc.font("Helvetica").fontSize(10).fillColor("#111111");
        }
      }

      // Compute card height and redraw border correctly (quick trick: draw border after we know end y)
      const endY = doc.y + cardPad;
      const cardH = Math.max(90, endY - startY);

      // Redraw border with correct height
      doc.save();
      doc.roundedRect(x, startY, w, cardH, 10).strokeColor("#e5e7eb").lineWidth(1).stroke();
      doc.restore();

      // Move cursor to below the card
      doc.y = startY + cardH + cardGap;
      doc.x = x;
    }
  }
// ---------- Page 1: Overview ----------
  sectionTitle("Session Overview");

  keyValue("School:", report.schoolName || "—");
  keyValue("Class:", report.className || "—");
  keyValue("Grade:", report.gradeLevel || "—");
  keyValue("Task Set:", report.taskSetName || "—");
  if (report.runByPresenterName) keyValue("Presented by:", report.runByPresenterName);
  if (report.sharedFromTeacherName || report.sharedFromTeacherEmail) {
    keyValue("TaskSet from:", report.sharedFromTeacherName || report.sharedFromTeacherEmail);
  }
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

  // Reading Comp (optional)
  const rcSum = report.readingCompSummary && typeof report.readingCompSummary === "object" ? report.readingCompSummary : null;
  if (rcSum && rcSum.enabled) {
    const g = rcSum.gradeLevel != null ? `Grade ${rcSum.gradeLevel}` : "Grade (unknown)";
    const totals = rcSum.totals || {};
    const line = `Below: ${totals.below || 0} • At: ${totals.at || 0} • Above: ${totals.above || 0}` + ((totals.unknown || 0) ? ` • Unknown: ${totals.unknown}` : "");
    keyValue(`Reading Comp (${g}):`, line);
  }

  // Noise (class-level)
  const noiseLabel = formatNoiseSummary(report.noiseSummary || report.summary?.noiseSummary);
  if (noiseLabel) keyValue("Noise & Focus:", noiseLabel);


  doc.moveDown(0.8);

  sectionTitle("Teacher Summary");
  const teacherSummary =
    report.summary?.teacherSummary ||
    report.summary?.summary ||
    report.summary?.overview ||
    "";
  doc.font("Helvetica").fontSize(10).fillColor("#111111").text(teacherSummary || "—");

  doc.moveDown(0.6);

  // Class Chat Blurb (copy-pasteable block)
  const chatBlurb = report.summary?.classChatBlurb || "";
  if (chatBlurb) {
    ensureSpace(120);
    sectionTitle("Class Chat Blurb");
    doc.font("Helvetica").fontSize(9).fillColor("#444444").text("(Copy and paste into your class chat, Google Classroom, or parent newsletter.)");
    doc.moveDown(0.2);

    const blurbX = doc.page.margins.left;
    const blurbW = pageWidth - doc.page.margins.left - doc.page.margins.right;
    const blurbStartY = doc.y;
    const blurbTextH = doc.heightOfString(chatBlurb, { width: blurbW - 24 });
    const blurbBoxH = blurbTextH + 24;

    doc.save();
    doc.roundedRect(blurbX, blurbStartY, blurbW, blurbBoxH, 10).fill("#ecfdf5").stroke("#6ee7b7");
    doc.fillColor("#064e3b").font("Helvetica").fontSize(10).text(chatBlurb, blurbX + 12, blurbStartY + 12, { width: blurbW - 24, lineGap: 2 });
    doc.restore();
    doc.y = blurbStartY + blurbBoxH + 8;
    doc.fillColor("#111111");
  }

  // Skills Developed
  const skillsList = Array.isArray(report.summary?.skillsDeveloped)
    ? report.summary.skillsDeveloped.filter(Boolean)
    : [];
  if (skillsList.length > 0) {
    ensureSpace(80);
    sectionTitle("Skills Developed");
    bullets(skillsList);
  }

  sectionTitle("Concepts Covered");
  bullets(report.summary?.conceptsCovered || report.summary?.concepts || report.summary?.keyConcepts || []);

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

  // Task-aware cards (from summary taskList or other common locations)
  const taskCardsSource =
    report.tasks ||
    report.taskList ||
    report.summary?.taskList ||
    report.summary?.tasks ||
    report.transcript?.tasks ||
    [];
  await renderTaskSummaryCards(taskCardsSource);

  // ---------- Overlay Mode Summary (Escape Room / Whodunnit / Quest) ----------
  const overlay = report.overlayModeSummary;
  if (overlay && overlay.active) {
    ensureSpace(620);
    sectionTitle("Special Mode Summary");

    if (overlay.escapeRoom?.enabled) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1f2937").text("🔐 Escape Room");
      doc.moveDown(0.2);
      const theme = overlay.escapeRoom.themeName ? ` — ${overlay.escapeRoom.themeName}` : "";
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`This session ran in Escape Room mode${theme}.`);
      doc.moveDown(0.2);
      const teamRows = Array.isArray(overlay.escapeRoom.teams) ? overlay.escapeRoom.teams : [];
      teamRows.forEach((t) => {
        const status = t.escaped
          ? `escaped${t.escapeTimeMs ? ` in ${Math.round(t.escapeTimeMs / 60000)}m` : ""}`
          : `${t.locksOpened || 0} lock(s) opened, ${t.keysEarned || 0} key(s) earned`;
        doc.text(`  • ${t.teamName}: ${status}${t.hintsUsed ? ` · ${t.hintsUsed} hint(s)` : ""}`);
      });
      doc.moveDown(0.5);
    }

    if (overlay.whodunnit?.enabled && overlay.whodunnit.suspectName) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1f2937").text("🕵 Whodunnit");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`Suspect (${overlay.whodunnit.themeRole}, ${overlay.whodunnit.difficulty}): ${overlay.whodunnit.suspectName}.`);
      const correct = overlay.whodunnit.accusations?.correct || [];
      const incorrect = overlay.whodunnit.accusations?.incorrect || [];
      if (correct.length) doc.text(`  • Correct accusations: ${correct.join(", ")}`);
      if (incorrect.length) doc.text(`  • Incorrect accusations: ${incorrect.join(", ")}`);
      if (!correct.length && !incorrect.length) doc.text("  • No team made a final accusation.");
      if (overlay.whodunnit.totalClues) {
        doc.text(`  • Total clues released: ${overlay.whodunnit.totalClues}`);
      }
      doc.moveDown(0.5);
    }

    if (overlay.quest?.enabled) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1f2937").text("⚔ Quest Mode");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`Across the class: ${overlay.quest.totalBonusUnlocked} bonus task(s) unlocked, ${overlay.quest.totalHiddenUnlocked} hidden task(s) unlocked.`);
      const qTeams = Array.isArray(overlay.quest.teams) ? overlay.quest.teams : [];
      qTeams.forEach((t) => {
        doc.text(`  • ${t.teamName}: ${t.coinsEarned} coin(s) earned, ${t.coinsSpent} spent, ${t.unlockedBonus} bonus + ${t.unlockedHidden} hidden unlocked${t.trades ? `, ${t.trades} trade(s)` : ""}`);
      });
      doc.moveDown(0.5);
    }

    if (overlay.levelUp?.enabled) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1f2937").text("⬆ LevelUp Activity");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`${overlay.levelUp.totalImproved} of ${overlay.levelUp.totalAttempts} retries improved on the original score.`);
      (overlay.levelUp.teams || []).forEach((t) => {
        const ups = (t.upgrades || []).map((u) => {
          const arrow = u.improved ? `${u.originalScore} → ${u.retryScore} (+${u.masteryBonus} mastery)` : `${u.originalScore} → ${u.retryScore}, kept ${u.kept}`;
          return `task ${u.originalTaskIndex + 1}: ${arrow}`;
        }).join("; ");
        doc.text(`  • ${t.teamName}: ${ups}`);
      });
      doc.moveDown(0.5);
    }
  }

  ensureSpace(640);

  sectionTitle("Note to Parents");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text(report.parentNote || "—");

  ensureSpace(620);

  // ---------- Student Grades (Gradebook) ----------
  const studentGrades = Array.isArray(report.studentGrades) ? report.studentGrades.filter(Boolean) : [];
  if (studentGrades.length > 0) {
    doc.addPage();
    sectionTitle("Student Grades");

    const gc = report.gradingConfig || {};
    const maxGradeLabel = gc.maxGrade ? `Out of ${gc.maxGrade}` : "";
    if (maxGradeLabel) {
      doc.font("Helvetica").fontSize(10).fillColor("#444444").text(maxGradeLabel);
      doc.moveDown(0.3);
    }

    // Table header
    const gColW = [0.22, 0.16, 0.16, 0.12, 0.18, 0.16];
    const gColLabels = ["Student", "Team", "Points", "%", "Grade", "Letter"];
    const gTableX = doc.page.margins.left;
    const gTableW = pageWidth - doc.page.margins.left - doc.page.margins.right;

    doc.save();
    doc.rect(gTableX, doc.y, gTableW, 20).fill("#3b82f6");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    let gxCur = gTableX;
    gColLabels.forEach((label, i) => {
      doc.text(label, gxCur + 4, doc.y + 5, { width: gTableW * gColW[i] - 8 });
      gxCur += gTableW * gColW[i];
    });
    doc.restore();
    doc.y += 22;

    // Data rows
    const sortedGrades = [...studentGrades].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    doc.font("Helvetica").fontSize(9).fillColor("#111111");

    for (let ri = 0; ri < sortedGrades.length; ri++) {
      const g = sortedGrades[ri];
      ensureSpace(20);

      if (ri % 2 === 1) {
        doc.save();
        doc.rect(gTableX, doc.y - 2, gTableW, 18).fill("#f8fafc");
        doc.restore();
        doc.fillColor("#111111");
      }

      const vals = [
        g.studentName || "—",
        g.teamName || "—",
        `${g.pointsEarned ?? 0}/${g.pointsPossible ?? 0}`,
        `${g.percent ?? 0}%`,
        `${g.scaledGrade ?? 0}/${g.maxGrade ?? 100}`,
        g.letterGrade || "—",
      ];

      gxCur = gTableX;
      const rowY = doc.y;
      vals.forEach((v, i) => {
        doc.text(v, gxCur + 4, rowY, { width: gTableW * gColW[i] - 8 });
        gxCur += gTableW * gColW[i];
      });
      doc.y = rowY + 16;
    }

    // Class average row
    if (sortedGrades.length > 1) {
      const avgPct = Math.round(sortedGrades.reduce((s, g) => s + (g.percent ?? 0), 0) / sortedGrades.length);
      const avgScaled = (sortedGrades.reduce((s, g) => s + (g.scaledGrade ?? 0), 0) / sortedGrades.length).toFixed(1);
      const maxG = sortedGrades[0]?.maxGrade ?? 100;

      doc.save();
      doc.rect(gTableX, doc.y - 2, gTableW, 20).fill("#e0e7ff");
      doc.restore();

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111");
      gxCur = gTableX;
      const avgVals = ["Class Average", "", "", `${avgPct}%`, `${avgScaled}/${maxG}`, ""];
      const avgRowY = doc.y;
      avgVals.forEach((v, i) => {
        doc.text(v, gxCur + 4, avgRowY, { width: gTableW * gColW[i] - 8 });
        gxCur += gTableW * gColW[i];
      });
      doc.y = avgRowY + 20;
    }

    doc.moveDown(0.5);
  }

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

  // ---------- Submitted student work (photos / paper snapshots / drawings) ----------
  // Always surface the artifacts students submitted (paper-photo answers,
  // handwriting snaps, drawings, photo challenges, team selfies) so the teacher
  // report mirrors what's in the students' own reports.
  await renderSubmittedWorkSection();

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

      // Reading Comp (optional)
      if (p.readingCompLevel && String(p.readingCompLevel) !== "unknown") {
        doc.moveDown(0.8);
        sectionTitle("Reading Comprehension");
        const lvl = String(p.readingCompLevel || "unknown");
        const gradeLabel =
          report.readingCompSummary && report.readingCompSummary.gradeLevel != null
            ? ` (vs Grade ${report.readingCompSummary.gradeLevel})`
            : "";
        doc.font("Helvetica").fontSize(10).fillColor("#111111").text(`Level: ${lvl}${gradeLabel}`);
        if (p.readingComp && p.readingComp.avgScore != null) doc.text(`Avg score: ${p.readingComp.avgScore}%`);
        if (p.readingComp && p.readingComp.sampleFeedback) {
          doc.moveDown(0.2);
          doc.font("Helvetica-Oblique").text(p.readingComp.sampleFeedback);
        }
      }

      // Assessment categories (from AI summary)
      const cats = Array.isArray(p.categories) ? p.categories.filter(Boolean) : [];
      if (cats.length > 0) {
        doc.moveDown(0.8);
        sectionTitle("Assessment Categories");
        doc.font("Helvetica").fontSize(10).fillColor("#111111");
        for (const c of cats) {
          const pctLabel = typeof c.percent === "number" ? `${c.percent}%` : "—";
          const comment = c.comment ? ` — ${c.comment}` : "";
          doc.text(`${c.label || c.key || "Category"}: ${pctLabel}${comment}`);
        }
      }

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

  // Footer on each page: easiest is to add at end by iterating pages (PDFKit can't easily go back).
  // Instead, we write footer right before doc ends for the last page, and for previous pages we rely on header only.
  // If you want footers on every page, we can switch to a page-buffering approach later.

  // At least add footer to last page
  footer(pageNum);

  doc.end();
  return done;
}

  function formatNoiseSummary(ns) {
    if (!ns || typeof ns !== "object") return null;
    const enabled = !!ns.enabled;
    const thr = Number.isFinite(Number(ns.threshold)) ? Number(ns.threshold) : null;
    const avg = Number.isFinite(Number(ns.avgLevel)) ? Number(ns.avgLevel) : null;
    const peak = Number.isFinite(Number(ns.peakLevel)) ? Number(ns.peakLevel) : null;
    const pctOver = Number.isFinite(Number(ns.pctOverThreshold)) ? Number(ns.pctOverThreshold) : null;
    const samples = Number.isFinite(Number(ns.samplesCount)) ? Number(ns.samplesCount) : null;

    const parts = [];
    if (avg != null) parts.push(`avg ${Math.round(avg)}/100`);
    if (peak != null) parts.push(`peak ${Math.round(peak)}/100`);
    if (thr != null && thr > 0) parts.push(`thr ${Math.round(thr)}/100`);
    if (pctOver != null && thr != null && thr > 0) parts.push(`${pctOver}% over thr`);
    if (samples != null && samples > 0) parts.push(`${samples} samples`);
    if (!parts.length && enabled === false) return "Off";
    return parts.join(" • ") || (enabled ? "On" : "Off");
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