// ====================================================================
//  transcriptEmailer.js
//  Curriculate - Session Report Emailer
//
//  Sends a teacher-facing report email and attaches a PDF report.
//  Report content mirrors the PDF typography for visual consistency.
//
//  NOTE: This module intentionally does NOT mutate Session records.
//  It renders from an immutable "snapshot" payload you pass in.
// ====================================================================

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendSystemEmail } from "./shareInviteEmailer.js";
import { computeTextQuality, qualityGrade } from "../../shared/textQuality.js";

// Deep-walk the transcript/aiSummary and aggregate every written or dictated
// text response per speaker (participant name; falls back to team for group
// work). Powers the "Speech & Text Quality" report sections. Returns a Map of
// lowercased-name -> { name, isTeam, text, count }.
function collectTextByParticipant(transcript, aiSummary) {
  const byName = new Map();
  const seen = new Set();

  const coerce = (v) => {
    if (typeof v === "string") return v.trim();
    return "";
  };

  const add = (name, isTeam, text) => {
    const t = coerce(text);
    if (!t || t.length < 2) return;
    const key = String(name || "").trim().toLowerCase() || "__unattributed";
    const dedup = `${key}|${t}`;
    if (seen.has(dedup)) return;
    seen.add(dedup);
    if (!byName.has(key)) byName.set(key, { name: String(name || "Unattributed").trim() || "Unattributed", isTeam, text: "", count: 0 });
    const rec = byName.get(key);
    rec.text += (rec.text ? "  " : "") + t;
    rec.count += 1;
  };

  let depth = 0;
  const visit = (node, ctxName, ctxTeam) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    depth += 1;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, ctxName, ctxTeam);
      depth -= 1;
      return;
    }
    const name = String(node.participantName || node.studentName || node.playerName || node.name || ctxName || "").trim();
    const team = String(node.teamName || node.team || node.groupName || ctxTeam || "").trim();
    const speaker = name || team;
    const isTeam = !name && !!team;

    // Text-bearing answer fields (typed or dictated).
    const direct =
      coerce(node.answerText) ||
      coerce(typeof node.answerPayload === "string" ? node.answerPayload : "") ||
      coerce(node.response) ||
      coerce(node.text) ||
      coerce(node.explanation) ||
      coerce(node.transcript);
    if (direct && speaker) add(speaker, isTeam, direct);

    // Arrays of sub-answers.
    for (const arrKey of ["answers", "responses", "subAnswers", "items"]) {
      if (Array.isArray(node[arrKey])) {
        for (const a of node[arrKey]) {
          if (typeof a === "string") { if (speaker) add(speaker, isTeam, a); }
          else if (a && typeof a === "object") {
            const v = coerce(a.value) || coerce(a.response) || coerce(a.text) || coerce(a.answer);
            if (v && speaker) add(speaker, isTeam, v);
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      const child = node[k];
      if (!child || typeof child !== "object") continue;
      if (["pdf", "html", "raw", "debug"].includes(k)) continue;
      visit(child, name || ctxName, team || ctxTeam);
    }
    depth -= 1;
  };

  visit(transcript, "", "");
  visit(aiSummary, "", "");
  return byName;
}

const __emailDir = path.dirname(fileURLToPath(import.meta.url));
let _mascotBuf = null;
function getMascotBuffer() {
  if (!_mascotBuf) {
    try { _mascotBuf = fs.readFileSync(path.join(__emailDir, "mascot-report.png")); } catch { _mascotBuf = null; }
  }
  return _mascotBuf;
}

// --------------------------------------------------------------------
// Branding
// --------------------------------------------------------------------
const BRAND_NAME = "Curriculate";
const BRAND_TAGLINE = "Active learning, live classrooms.";

// --------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------
function clamp(n, lo, hi) {
  const x = typeof n === "number" && Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, x));
}

function pct(num, den) {
  const n = typeof num === "number" ? num : 0;
  const d = typeof den === "number" ? den : 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asList(arr) {
  return Array.isArray(arr) ? arr : [];
}

function formatDateTime(isoOrMs) {
  try {
    const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(String(isoOrMs));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function planTier(planName = "FREE") {
  const p = String(planName || "FREE").toUpperCase();
  if (p.includes("PRO")) return "PRO";
  if (p.includes("PLUS")) return "PLUS";
  return "FREE";
}

function buildSoftUpgradeLine(planName = "FREE") {
  const tier = planTier(planName);
  if (tier === "FREE") {
    return "Tip: PLUS and PRO plans unlock deeper team analytics, richer engagement insights, and optional individual student one-page printouts.";
  }
  if (tier === "PLUS") {
    return "Tip: PRO unlocks advanced reporting, more AI-powered insights, and optional individual student one-page printouts.";
  }
  return ""; // PRO: no upsell
}

// --------------------------------------------------------------------
// Data shaping (tolerant to missing fields)
// --------------------------------------------------------------------
function extractOverview({ transcript, aiSummary }) {
  const roomCode = transcript?.roomCode || transcript?.code || "";
  const tasksetName = transcript?.tasksetName || transcript?.name || "Curriculate Activity";
  const startedAt = transcript?.startedAt || transcript?.createdAt || null;
  const endedAt = transcript?.endedAt || transcript?.completedAt || transcript?.endedAt || null;

  const concepts = asList(aiSummary?.keyConcepts).filter(Boolean).slice(0, 10);

  const activities = asList(aiSummary?.activities || aiSummary?.activityHighlights || transcript?.tasks)
    .map((t) => {
      if (typeof t === "string") return t;
      const title = t?.title || t?.name || t?.taskType || "Activity";
      const points = typeof t?.points === "number" ? `${t.points} pts` : null;
      return points ? `${title} (${points})` : title;
    })
    .filter(Boolean)
    .slice(0, 12);

  const engagementLabel =
    aiSummary?.engagementLabel ||
    aiSummary?.engagementLevel ||
    (typeof aiSummary?.engagementPercent === "number"
      ? `${clamp(aiSummary.engagementPercent, 0, 100)}%`
      : "");

  const proficiencyLabel =
    aiSummary?.proficiencyLabel ||
    aiSummary?.overallProficiency ||
    (typeof aiSummary?.overallPercent === "number"
      ? `${clamp(aiSummary.overallPercent, 0, 100)}%`
      : "");

  const brief = aiSummary?.groupSummary || aiSummary?.summary || "";

  return {
    roomCode,
    tasksetName,
    startedAt,
    endedAt,
    concepts,
    activities,
    engagementLabel,
    proficiencyLabel,
    brief,
  };
}

function extractTeams(transcript, aiSummary) {
  const detailed = asList(transcript?.teamsDetailed);
  if (detailed.length) return detailed;

  const teamsFromSummary = asList(aiSummary?.teams || aiSummary?.teamSummaries);
  if (teamsFromSummary.length) return teamsFromSummary;

  const scores = transcript?.scores && typeof transcript.scores === "object" ? transcript.scores : {};
  const totalPossible = typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null;

  return Object.entries(scores).map(([teamName, pts]) => ({
    teamName,
    members: [],
    moodsIn: [],
    tasksCompleted: typeof transcript?.tasks?.length === "number" ? transcript.tasks.length : null,
    engagementLabel: "",
    score: pts,
    totalPossible,
    exitFeedback: "",
    submissions: [],
  }));
}

function extractMediaSubmissions(transcript, aiSummary) {
  const items = asList(transcript?.submissions).concat(asList(aiSummary?.submissions));
  return items
    .map((s) => {
      const kind = s?.kind || s?.type || s?.taskType || "";
      const url = s?.url || s?.downloadUrl || s?.fileUrl || "";
      const filename = s?.filename || s?.name || "";
      const teamName = s?.teamName || s?.team || "";
      const taskTitle = s?.taskTitle || s?.taskName || s?.task || "";
      const createdAt = s?.createdAt || s?.timestamp || null;

      const k = String(kind).toLowerCase();
      const isMedia =
        k.includes("photo") || k.includes("image") || k.includes("record") || k.includes("audio") || k.includes("video");

      if (!isMedia && !url && !filename) return null;

      return { kind, teamName, taskTitle, filename, url, createdAt };
    })
    .filter(Boolean);
}

function shouldIncludeIndividualReports(planName, includeIndividualReports) {
  if (!includeIndividualReports) return false;
  // Match sessionReportController.planAllowsStudentDetail — PLUS and above
  const t = String(planName || "FREE").toUpperCase();
  if (["FREE", "BASIC", "TRIAL", "DEMO", "NONE"].includes(t)) return false;
  return (
    t.startsWith("PLUS") ||
    t.startsWith("PRO") ||
    t.startsWith("SCHOOL") ||
    t.startsWith("DISTRICT") ||
    t.startsWith("ENTERPRISE") ||
    t.startsWith("PREMIUM")
  );
}

// --------------------------------------------------------------------
// HTML Email Builder
// --------------------------------------------------------------------
// Tier helper — mirrors backend/utils/tierGate.js. Trend / improvement
// indicator is gated to PRO. PLUS and FREE see no Trend column at all
// (cleaner than a column of em-dashes).
function isPlanAtLeastPro(planName = "FREE") {
  const t = String(planName || "").toUpperCase();
  return t.includes("PRO");
}

// Build the conditional CSV-import instructions block
// for the report email. Rendered just under the Brief Overview.
function buildCsvImportBlockHtml({ csvInfo, classBound }) {
  if (!csvInfo) return "";

  if (csvInfo.hasAnyId && classBound) {
    // Mode B: full Edsby-ready CSV
    return `
      <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#eff6ff; border:1px solid #93c5fd;">
        <div style="font-weight:900; margin-bottom:6px;">📄 Edsby Import CSV Attached</div>
        <div style="font-size:13px; line-height:1.5; color:#1e3a8a;">
          A gradebook CSV is attached, ready to import into Edsby. To import:
          Edsby → Gradebook → click your assessment → <strong>Import</strong> → upload the attached CSV.
          Verify the column mapping (Student ID, First Name, Last Name, Grade) and confirm.
        </div>
      </div>`;
  }

  if (csvInfo.hasAnyId && !classBound) {
    // Some matches happened post-hoc (rosters present but session wasn't class-bound)
    return `
      <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#eff6ff; border:1px solid #93c5fd;">
        <div style="font-weight:900; margin-bottom:6px;">📄 Edsby Import CSV Attached</div>
        <div style="font-size:13px; line-height:1.5; color:#1e3a8a;">
          A gradebook CSV is attached using your uploaded class roster. To import into Edsby:
          Edsby → Gradebook → your assessment → <strong>Import</strong> → upload the CSV.
          Tip: launching with a class selected (or sending sub-teacher links bound to a class)
          gives the cleanest match rate.
        </div>
      </div>`;
  }

  // No matches — generic CSV
  return `
    <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#fffbeb; border:1px solid #fde68a;">
      <div style="font-weight:900; margin-bottom:6px;">📄 Grades CSV Attached</div>
      <div style="font-size:13px; line-height:1.5; color:#78350f;">
        A generic gradebook CSV is attached with each completed student's score.
        Want one-click import into <strong>Edsby</strong>? Upload your class roster in your
        Profile → Class Rosters; we'll auto-match students next time and produce an
        Edsby-ready file. Use a different LMS?
        <a href="https://curriculate.net/profile?platform_request=1" style="color:#92400e; text-decoration:underline;">Request support for it</a>.
      </div>
    </div>`;
}

function buildOverlayHtmlBlock(overlay) {
  if (!overlay || !overlay.active) return "";
  const parts = [];
  if (overlay.escapeRoom?.enabled) {
    const teamRows = (overlay.escapeRoom.teams || [])
      .map((t) => {
        const status = t.escaped
          ? `escaped${t.escapeTimeMs ? ` in ${Math.round(t.escapeTimeMs / 60000)}m` : ""}`
          : `${t.locksOpened || 0} lock(s) opened · ${t.keysEarned || 0} key(s) earned`;
        const hints = t.hintsUsed ? ` · ${t.hintsUsed} hint(s)` : "";
        return `<li><strong>${escHtml(t.teamName)}</strong>: ${escHtml(status)}${escHtml(hints)}</li>`;
      })
      .join("");
    const theme = overlay.escapeRoom.themeName ? ` — ${escHtml(overlay.escapeRoom.themeName)}` : "";
    parts.push(`
      <div style="margin-top:6px;">
        <div style="font-weight:800;">🔐 Escape Room${theme}</div>
        ${teamRows ? `<ul style="margin:6px 0 0; padding-left:18px;">${teamRows}</ul>` : ""}
      </div>`);
  }
  if (overlay.whodunnit?.enabled && overlay.whodunnit.suspectName) {
    const c = overlay.whodunnit.accusations?.correct || [];
    const w = overlay.whodunnit.accusations?.incorrect || [];
    const subRows = [];
    if (c.length) subRows.push(`<li>Correct accusations: ${escHtml(c.join(", "))}</li>`);
    if (w.length) subRows.push(`<li>Incorrect accusations: ${escHtml(w.join(", "))}</li>`);
    if (!c.length && !w.length) subRows.push(`<li>No team made a final accusation.</li>`);
    if (overlay.whodunnit.totalClues) subRows.push(`<li>Total clues released: ${overlay.whodunnit.totalClues}</li>`);
    parts.push(`
      <div style="margin-top:10px;">
        <div style="font-weight:800;">🕵 Whodunnit — Suspect: ${escHtml(overlay.whodunnit.suspectName)}</div>
        <ul style="margin:6px 0 0; padding-left:18px;">${subRows.join("")}</ul>
      </div>`);
  }
  if (overlay.quest?.enabled) {
    const teamRows = (overlay.quest.teams || [])
      .map((t) => `<li><strong>${escHtml(t.teamName)}</strong>: ${t.coinsEarned} coin(s) earned · ${t.unlockedBonus} bonus + ${t.unlockedHidden} hidden unlocked</li>`)
      .join("");
    parts.push(`
      <div style="margin-top:10px;">
        <div style="font-weight:800;">⚔ Quest Mode</div>
        <div style="font-size:13px; color:#334155;">Class total: ${overlay.quest.totalBonusUnlocked} bonus + ${overlay.quest.totalHiddenUnlocked} hidden tasks unlocked.</div>
        ${teamRows ? `<ul style="margin:6px 0 0; padding-left:18px;">${teamRows}</ul>` : ""}
      </div>`);
  }
  if (overlay.levelUp?.enabled) {
    const teamRows = (overlay.levelUp.teams || [])
      .map((t) => {
        const ups = (t.upgrades || [])
          .map((u) =>
            u.improved
              ? `Task ${u.originalTaskIndex + 1}: ${u.originalScore} → ${u.retryScore} <strong>(+${u.masteryBonus} mastery)</strong>`
              : `Task ${u.originalTaskIndex + 1}: ${u.originalScore} → ${u.retryScore}, kept ${u.kept}`,
          )
          .join("; ");
        return `<li><strong>${escHtml(t.teamName)}</strong>: ${ups}</li>`;
      })
      .join("");
    parts.push(`
      <div style="margin-top:10px;">
        <div style="font-weight:800;">⬆ LevelUp Activity</div>
        <div style="font-size:13px; color:#334155;">${overlay.levelUp.totalImproved} of ${overlay.levelUp.totalAttempts} retries improved on the original score.</div>
        ${teamRows ? `<ul style="margin:6px 0 0; padding-left:18px;">${teamRows}</ul>` : ""}
      </div>`);
  }
  if (!parts.length) return "";
  return `
    <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#fef3c7; border:1px solid #fcd34d;">
      <div style="font-weight:900; margin-bottom:6px;">Special Mode Summary</div>
      ${parts.join("")}
    </div>`;
}

function buildEmailHtml({
  transcript,
  aiSummary,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
  includeIndividualReports,
  studentGrades,
  gradingConfig,
  bloomsTaxonomy,
  csvInfo,
  classBound,
  overlayModeSummary,
}) {
  const tier = planTier(planName);
  const overview = extractOverview({ transcript, aiSummary });
  const teams = extractTeams(transcript, aiSummary);
  const media = extractMediaSubmissions(transcript, aiSummary);
  const upgradeLine = buildSoftUpgradeLine(planName);

  const perspectiveText = asList(perspectives).filter(Boolean).join(", ");
  const whenText = [formatDateTime(overview.startedAt), formatDateTime(overview.endedAt)].filter(Boolean).join(" — ");

  const conceptsHtml = overview.concepts.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">${overview.concepts.map((c) => `<li>${escHtml(c)}</li>`).join("")}</ul>`
    : `<div style="opacity:.8;">(No concepts detected.)</div>`;

  const activitiesHtml = overview.activities.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">${overview.activities.map((a) => `<li>${escHtml(a)}</li>`).join("")}</ul>`
    : `<div style="opacity:.8;">(No activities detected.)</div>`;

  const noteToParents = (() => {
    const cls = className ? escHtml(className) : "class";
    const grade = gradeLevel != null && String(gradeLevel).trim() ? ` (Grade ${escHtml(gradeLevel)})` : "";
    const conceptLine = overview.concepts.length ? escHtml(overview.concepts.slice(0, 3).join(", ")) : "key concepts";
    const actLine = overview.activities.length ? escHtml(overview.activities.slice(0, 3).join(", ")) : "interactive activities";
    const eng = overview.engagementLabel ? escHtml(overview.engagementLabel) : "strong";
    const prof = overview.proficiencyLabel ? escHtml(overview.proficiencyLabel) : "a developing level of proficiency";

    return `Today in ${cls}${grade}, we completed a Curriculate activity wherein students were actively involved in exploring/reviewing ${conceptLine}. ` +
      `They completed activities such as ${actLine}. The level of engagement was ${eng}. Overall, students achieved ${prof}.`;
  })();

  const teamRows = teams
    .map((t) => {
      const members = asList(t.members).filter(Boolean).join(", ");
      const moods = asList(t.moodsIn || t.moods || t.moodIn).filter(Boolean).join(", ");
      const tasksCompleted = t.tasksCompleted != null ? String(t.tasksCompleted) : (t.tasksDone != null ? String(t.tasksDone) : "—");

      const engagement =
        t.engagementLabel || t.engagement || (typeof t.engagementPercent === "number" ? `${t.engagementPercent}%` : "—");

      const score = t.teamScore != null ? t.teamScore : (t.score != null ? t.score : "—");
      const outOf =
        t.totalPossible != null ? t.totalPossible : (typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null);
      const percent = outOf != null && typeof score === "number" ? `${pct(score, outOf)}%` : "—";
      const exit = t.exitFeedback || t.exit || "";

      return `
        <tr>
          <td style="padding:8px; border-top:1px solid #e5e7eb;"><strong>${escHtml(t.teamName || "Team")}</strong></td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(members || "—")}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(moods || "—")}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(tasksCompleted)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(engagement)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(String(score))}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(percent)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(exit || "—")}</td>
        </tr>
      `;
    })
    .join("");

  const mediaHtml = media.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">
        ${media
          .slice(0, 30)
          .map((m) => {
            const labelParts = [
              m.taskTitle ? `Activity: ${m.taskTitle}` : null,
              m.teamName ? `Team: ${m.teamName}` : null,
              m.filename ? `File: ${m.filename}` : null,
              m.url ? `Link: ${m.url}` : null,
            ].filter(Boolean);
            return `<li>${escHtml(labelParts.join(" • "))}</li>`;
          })
          .join("")}
      </ul>`
    : `<div style="opacity:.8;">(No photo/recording submissions were attached to this session.)</div>`;

  const categoriesHtml = (() => {
    const cats = asList(assessmentCategories).filter(Boolean);
    if (!cats.length) return "";
    return `<div style="margin-top:8px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb;">
      <div style="font-weight:800; margin-bottom:6px;">Assessment Categories</div>
      <div style="font-size:13px; opacity:.9;">
        ${cats
          .map((c) => `<span style="display:inline-block; margin:0 8px 6px 0; padding:4px 10px; border-radius:999px; border:1px solid #e5e7eb; background:#fff;">${escHtml(c.label || c.name || String(c))}</span>`)
          .join("")}
      </div>
    </div>`;
  })();

  const indivNote = shouldIncludeIndividualReports(planName, includeIndividualReports)
    ? `<div style="margin-top:10px; font-size:13px; opacity:.9;">Individual one-page student reports are included in the PDF attachment (print-ready).</div>`
    : (tier !== "PRO" && includeIndividualReports
        ? `<div style="margin-top:10px; font-size:13px; opacity:.9;">Individual student printouts are available on PLUS plans and above.</div>`
        : "");

  return `
  <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size:14px; color:#0f172a;">
    <div style="border:1px solid #e5e7eb; border-radius:16px; overflow:hidden;">
      <div style="background:#0f172a; color:#fff; padding:14px 16px; display:flex; align-items:center; gap:12px;">
        <img src="https://curriculate.net/images/mascot/email-results/1.png" alt="" style="width:48px; height:48px; border-radius:50%; object-fit:cover; flex-shrink:0;" />
        <div>
          <div style="font-size:16px; font-weight:900; letter-spacing:0.2px;">${BRAND_NAME} Report Ready</div>
          <div style="font-size:12px; opacity:.85;">${escHtml(BRAND_TAGLINE)}</div>
        </div>
      </div>

      <div style="padding:16px;">
        ${schoolName ? `<div style="font-weight:800; font-size:13px; margin-bottom:4px;">${escHtml(schoolName)}</div>` : ""}
        <div style="font-size:12px; color:#475569;">
          <strong>Task Set:</strong> ${escHtml(overview.tasksetName)} &nbsp;•&nbsp;
          <strong>Room:</strong> ${escHtml(overview.roomCode)}
          ${whenText ? ` &nbsp;•&nbsp; <strong>When:</strong> ${escHtml(whenText)}` : ""}
        </div>
        ${perspectiveText ? `<div style="font-size:12px; color:#64748b; margin-top:4px;"><strong>Perspective:</strong> ${escHtml(perspectiveText)}</div>` : ""}

        <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#f8fafc; border:1px solid #e5e7eb;">
          <div style="font-weight:900; margin-bottom:6px;">Brief Overview</div>
          ${overview.brief ? `<div style="line-height:1.45;">${escHtml(overview.brief)}</div>` : `<div style="opacity:.8;">(No AI summary text provided.)</div>`}
          <div style="margin-top:8px; font-size:13px; color:#334155;">
            <strong>Engagement:</strong> ${escHtml(overview.engagementLabel || "—")} &nbsp;•&nbsp;
            <strong>Overall proficiency:</strong> ${escHtml(overview.proficiencyLabel || "—")}
          </div>
        </div>

        ${buildOverlayHtmlBlock(overlayModeSummary)}

        ${buildCsvImportBlockHtml({ csvInfo, classBound })}

        ${(() => {
          const blurb = aiSummary?.classChatBlurb || "";
          if (!blurb) return "";
          return `
            <div style="margin-top:16px; padding:14px 16px; border-radius:14px; background:#ecfdf5; border:1px solid #6ee7b7;">
              <div style="font-weight:900; margin-bottom:6px;">
                📋 Class Chat Blurb
                <span style="font-weight:400; font-size:12px; color:#6b7280; margin-left:6px;">(copy &amp; paste into your class chat or newsletter)</span>
              </div>
              <div style="line-height:1.55; font-size:14px; color:#064e3b;">${escHtml(blurb)}</div>
            </div>
          `;
        })()}

        ${(() => {
          const skills = asList(aiSummary?.skillsDeveloped).filter(Boolean);
          if (!skills.length) return "";
          return `
            <div style="margin-top:14px;">
              <div style="font-weight:900; margin-bottom:4px;">Skills Developed</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${skills.map((s) => `<span style="display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid #c7d2fe; background:#eef2ff; font-size:12px; color:#3730a3; font-weight:600;">${escHtml(s)}</span>`).join("")}
              </div>
            </div>
          `;
        })()}

        ${(() => {
          if (!bloomsTaxonomy || !bloomsTaxonomy.levels) return "";
          const bt = bloomsTaxonomy;
          const activeLevels = bt.levels.filter(l => l.totalCount > 0);
          if (!activeLevels.length) return "";

          const maxCount = Math.max(...bt.levels.map(l => l.primaryCount), 1);
          const bars = bt.levels.map(l => {
            const pct = Math.round((l.primaryCount / maxCount) * 100);
            const opacity = l.primaryCount > 0 ? 1 : 0.3;
            return `
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; opacity:${opacity};">
                <div style="width:80px; font-size:11px; font-weight:700; color:${l.color}; text-align:right;">${escHtml(l.label)}</div>
                <div style="flex:1; height:18px; background:#f1f5f9; border-radius:9px; overflow:hidden;">
                  <div style="width:${pct}%; min-width:${l.primaryCount > 0 ? '8px' : '0'}; height:100%; background:${l.color}; border-radius:9px; transition:width 0.3s;"></div>
                </div>
                <div style="width:28px; font-size:11px; color:#64748b; text-align:left;">${l.primaryCount}</div>
              </div>`;
          }).join("");

          const cogProfile = aiSummary?.cognitiveProfile || "";
          const profileHtml = cogProfile ? `<div style="margin-top:8px; font-size:13px; line-height:1.5; color:#334155;">${escHtml(cogProfile)}</div>` : "";

          return `
            <div style="margin-top:16px; padding:14px 16px; border-radius:14px; background:#faf5ff; border:1px solid #d8b4fe;">
              <div style="font-weight:900; margin-bottom:2px;">
                🧠 Cognitive Profile — Bloom's Taxonomy
              </div>
              <div style="font-size:12px; color:#6b7280; margin-bottom:10px;">
                ${bt.cognitiveTaskCount} of ${bt.totalTaskCount} tasks mapped • Highest level: ${escHtml(bt.highestLevel)} • Dominant: ${escHtml(bt.dominantLevel)}
              </div>
              ${bars}
              ${profileHtml}
              <div style="margin-top:8px; font-size:12px; color:#64748b; line-height:1.45;">${escHtml(bt.summary)}</div>
            </div>
          `;
        })()}

        ${(() => {
          const standards = asList(aiSummary?.standardsAlignment).filter(Boolean);
          if (!standards.length) return "";
          return `
            <div style="margin-top:16px; padding:14px 16px; border-radius:14px; background:#eff6ff; border:1px solid #93c5fd;">
              <div style="font-weight:900; margin-bottom:8px;">
                📐 Standards Alignment
              </div>
              ${standards.map((s) => `
                <div style="margin-bottom:8px; padding:8px 10px; background:#ffffff; border-radius:8px; border:1px solid #dbeafe;">
                  <div style="font-weight:700; font-size:13px; color:#1e40af;">
                    ${s.code ? `<span style="font-family:monospace; background:#dbeafe; padding:1px 6px; border-radius:4px; font-size:11px; margin-right:6px;">${escHtml(s.code)}</span>` : ""}
                    ${escHtml(s.standard)}
                  </div>
                  <div style="font-size:12px; color:#475569; margin-top:3px; line-height:1.4;">${escHtml(s.connection)}</div>
                </div>
              `).join("")}
            </div>
          `;
        })()}

        <div style="margin-top:14px;">
          <div style="font-weight:900;">Concepts Covered</div>
          ${conceptsHtml}
        </div>

        <div style="margin-top:14px;">
          <div style="font-weight:900;">Activities Completed</div>
          ${activitiesHtml}
        </div>

        ${categoriesHtml}

        <div style="margin-top:16px; padding:12px 14px; border-radius:14px; background:#fff7ed; border:1px solid #fed7aa;">
          <div style="font-weight:900; margin-bottom:6px;">Note to Parents</div>
          <div style="line-height:1.45;">${noteToParents}</div>
        </div>

        ${(() => {
          const grades = asList(studentGrades).filter(Boolean);
          if (!grades.length) return "";
          const gc = gradingConfig && typeof gradingConfig === "object" ? gradingConfig : {};
          const maxGradeLabel = gc.maxGrade ? ` (out of ${gc.maxGrade})` : "";
          const sorted = [...grades].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
          // Trend column is PRO-only. PLUS/FREE skip the column entirely.
          const showTrend = isPlanAtLeastPro(planName);

          // Improvement / trend cell helper (Mode B only). Renders as a
          // colored arrow + delta vs. last session, or "first time" for
          // brand-new players, or em-dash when no edsbyId is present.
          const trendCellHtml = (g) => {
            const imp = g?.improvement;
            if (!imp) {
              return `<td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:center; color:#9ca3af;">—</td>`;
            }
            if (imp.priorCount === 0 || imp.trend === "first") {
              return `<td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:center; font-size:11px; color:#6b7280;">first time</td>`;
            }
            const v = Number(imp.vsLast || 0);
            const sign = v > 0 ? "+" : "";
            const arrow = imp.trend === "up" ? "▲" : imp.trend === "down" ? "▼" : "▬";
            const bg = imp.trend === "up" ? "#dcfce7" : imp.trend === "down" ? "#fee2e2" : "#f3f4f6";
            const fg = imp.trend === "up" ? "#15803d" : imp.trend === "down" ? "#dc2626" : "#4b5563";
            return `<td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:center;">
              <span style="display:inline-block; padding:2px 8px; border-radius:999px; font-weight:700; font-size:11px; background:${bg}; color:${fg};">${arrow} ${sign}${v}%</span>
            </td>`;
          };

          const gradeRows = sorted.map((g) => `
            <tr>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb;">${escHtml(g.studentName || "—")}</td>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb;">${escHtml(g.teamName || "—")}</td>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:right;">${g.pointsEarned ?? 0}/${g.pointsPossible ?? 0}</td>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:right; font-weight:700;">${g.percent ?? 0}%</td>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:right;">${g.scaledGrade ?? 0}/${g.maxGrade ?? 100}</td>
              <td style="padding:6px 8px; border-top:1px solid #e5e7eb; text-align:center;">
                <span style="display:inline-block; padding:2px 8px; border-radius:999px; font-weight:800; font-size:11px; background:${
                  g.letterGrade === "A" ? "#dcfce7" : g.letterGrade === "B" ? "#dbeafe" : g.letterGrade === "C" ? "#fef9c3" : g.letterGrade === "D" ? "#ffedd5" : "#fecaca"
                }; color:${
                  g.letterGrade === "A" ? "#15803d" : g.letterGrade === "B" ? "#1d4ed8" : g.letterGrade === "C" ? "#a16207" : g.letterGrade === "D" ? "#c2410c" : "#dc2626"
                };">${escHtml(g.letterGrade || "—")}</span>
              </td>
              ${showTrend ? trendCellHtml(g) : ""}
            </tr>
          `).join("");

          const avgPct = sorted.length > 1
            ? Math.round(sorted.reduce((s, g) => s + (g.percent ?? 0), 0) / sorted.length)
            : null;

          // Class-level improvement: average vsLast across students with prior history
          const withPrior = sorted.filter((g) => g.improvement && g.improvement.priorCount > 0);
          const avgVsLast = withPrior.length
            ? Math.round(
                (withPrior.reduce((s, g) => s + (Number(g.improvement.vsLast) || 0), 0) /
                  withPrior.length) * 10
              ) / 10
            : null;

          const avgRow = avgPct != null ? `
            <tr style="background:#e0e7ff;">
              <td style="padding:6px 8px; border-top:2px solid #6366f1; font-weight:700;" colspan="3">Class Average</td>
              <td style="padding:6px 8px; border-top:2px solid #6366f1; text-align:right; font-weight:700;">${avgPct}%</td>
              <td style="padding:6px 8px; border-top:2px solid #6366f1; text-align:right; font-weight:700;">${(sorted.reduce((s, g) => s + (g.scaledGrade ?? 0), 0) / sorted.length).toFixed(1)}/${sorted[0]?.maxGrade ?? 100}</td>
              <td style="padding:6px 8px; border-top:2px solid #6366f1;"></td>
              ${showTrend ? `<td style="padding:6px 8px; border-top:2px solid #6366f1; text-align:center; font-weight:700;">${
                avgVsLast == null ? "—" :
                `<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; background:${avgVsLast > 0 ? "#dcfce7" : avgVsLast < 0 ? "#fee2e2" : "#f3f4f6"}; color:${avgVsLast > 0 ? "#15803d" : avgVsLast < 0 ? "#dc2626" : "#4b5563"};">${avgVsLast > 0 ? "▲ +" : avgVsLast < 0 ? "▼ " : "▬ "}${avgVsLast}%</span>`
              }</td>` : ""}
            </tr>
          ` : "";

          return `
            <div style="margin-top:18px;">
              <div style="font-weight:900; margin-bottom:6px;">Student Grades${escHtml(maxGradeLabel)}</div>
              <div style="overflow:auto; border:1px solid #e5e7eb; border-radius:14px;">
                <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; min-width:600px; font-size:13px;">
                  <thead style="background:#3b82f6; color:#ffffff;">
                    <tr>
                      <th style="text-align:left; padding:8px;">Student</th>
                      <th style="text-align:left; padding:8px;">Team</th>
                      <th style="text-align:right; padding:8px;">Points</th>
                      <th style="text-align:right; padding:8px;">%</th>
                      <th style="text-align:right; padding:8px;">Grade</th>
                      <th style="text-align:center; padding:8px;">Letter</th>
                      ${showTrend ? `<th style="text-align:center; padding:8px;">Trend</th>` : ""}
                    </tr>
                  </thead>
                  <tbody>
                    ${gradeRows}
                    ${avgRow}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        })()}

        <div style="margin-top:18px;">
          <div style="font-weight:900; margin-bottom:6px;">Teams</div>
          <div style="overflow:auto; border:1px solid #e5e7eb; border-radius:14px;">
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; min-width:860px; font-size:13px;">
              <thead style="background:#f1f5f9; color:#0f172a;">
                <tr>
                  <th style="text-align:left; padding:10px;">Team</th>
                  <th style="text-align:left; padding:10px;">Members</th>
                  <th style="text-align:left; padding:10px;">Mood (entry)</th>
                  <th style="text-align:right; padding:10px;">Tasks</th>
                  <th style="text-align:left; padding:10px;">Engagement</th>
                  <th style="text-align:right; padding:10px;">Score</th>
                  <th style="text-align:right; padding:10px;">%</th>
                  <th style="text-align:left; padding:10px;">Exit feedback</th>
                </tr>
              </thead>
              <tbody>
                ${teamRows || `<tr><td colspan="8" style="padding:10px;">No team data recorded.</td></tr>`}
              </tbody>
            </table>
          </div>
          ${indivNote}
        </div>

        <div style="margin-top:18px;">
          <div style="font-weight:900;">Photo / Recording Submissions</div>
          ${mediaHtml}
        </div>

        ${upgradeLine ? `<div style="margin-top:16px; font-size:12px; color:#64748b;">${escHtml(upgradeLine)}</div>` : ""}

        <div style="margin-top:18px; font-size:12px; color:#64748b;">
          The full printable report is attached as a PDF and is also available in your Curriculate <strong>Reports</strong> sidebar.
        </div>

        <div style="margin-top:16px; font-size:11px; color:#94a3b8;">
          Automated message from ${BRAND_NAME}. Replies may not be monitored.
        </div>
      </div>
    </div>
  </div>`;
}

// --------------------------------------------------------------------
// PDF Builder (typography aligned with email)
// --------------------------------------------------------------------
async function buildReportPdfBuffer({
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
  studentGrades,
  gradingConfig,
  bloomsTaxonomy,
  overlayModeSummary = null,
}) {
  const overview = extractOverview({ transcript, aiSummary });
  const teams = extractTeams(transcript, aiSummary);
  const media = extractMediaSubmissions(transcript, aiSummary);
  const perspectiveText = asList(perspectives).filter(Boolean).join(", ");
  const whenText = [formatDateTime(overview.startedAt), formatDateTime(overview.endedAt)].filter(Boolean).join(" — ");
  const wantIndividualPages = shouldIncludeIndividualReports(planName, includeIndividualReports);

  const doc = new PDFDocument({ size: "LETTER", margin: 44, compress: true });
  const chunks = [];

  const mascotImg = getMascotBuffer();

  function header() {
    const top = doc.y;
    const barW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const barH = 40;
    doc.save();
    doc.rect(doc.page.margins.left, top, barW, barH).fill("#0f172a");

    // Mascot avatar (circular crop via clipping)
    const mascotSize = 28;
    const mascotX = doc.page.margins.left + 10;
    const mascotY = top + (barH - mascotSize) / 2;
    const textLeft = mascotImg ? mascotX + mascotSize + 8 : doc.page.margins.left + 12;

    if (mascotImg) {
      doc.save();
      doc.circle(mascotX + mascotSize / 2, mascotY + mascotSize / 2, mascotSize / 2).clip();
      doc.image(mascotImg, mascotX, mascotY, { width: mascotSize, height: mascotSize });
      doc.restore();
    }

    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(`${BRAND_NAME} Report`, textLeft, top + 10, { lineBreak: false });
    doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9).text(BRAND_TAGLINE, textLeft, top + 26, { lineBreak: false });
    doc.restore();
    doc.y = top + barH + 8;
  }

  function footer() {
    const text = `${BRAND_NAME} • Room ${overview.roomCode || "—"} • ${overview.tasksetName || "—"}`;
    doc.save();
    // Temporarily remove bottom margin to prevent auto-pagination when drawing below content area
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8");
    doc.text(text, doc.page.margins.left, doc.page.height - savedBottom + 8, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });
    doc.page.margins.bottom = savedBottom;
    doc.restore();
  }

  function sectionTitle(t) {
    doc.moveDown(0.4);
    doc.x = doc.page.margins.left; // ensure we're at left margin
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(t);
    doc.moveDown(0.25);
  }

  function pill(text) {
    const padX = 10;
    const x = doc.page.margins.left;
    const y = doc.y;
    const w = doc.widthOfString(text) + padX * 2;
    const h = 22;
    doc.save();
    doc.roundedRect(x, y, w, h, 11).fill("#f1f5f9");
    doc.fillColor("#0f172a").font("Helvetica").fontSize(9).text(text, x + padX, y + 6);
    doc.restore();
    doc.moveDown(1.1);
  }

  function pageStart() {
    header();
    doc.x = doc.page.margins.left; // reset x after header image
    if (schoolName) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(schoolName);
      doc.moveDown(0.2);
    }
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(
      `Task Set: ${overview.tasksetName}  •  Room: ${overview.roomCode}${whenText ? `  •  When: ${whenText}` : ""}`
    );
    if (perspectiveText) doc.text(`Perspective: ${perspectiveText}`);
    doc.fillColor("#0f172a");
    doc.moveDown(0.6);
  }

  function drawNoteBox(title, body, bg = "#fff7ed", border = "#fed7aa") {
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startY = doc.y;

    const titleH = doc.heightOfString(title, { width: width - 24 });
    const bodyH = doc.heightOfString(body, { width: width - 24 });
    const boxH = 14 + titleH + 8 + bodyH + 14;

    doc.save();
    doc.roundedRect(x, startY, width, boxH, 12).fill(bg).stroke(border);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(title, x + 12, startY + 12, { width: width - 24 });
    doc.fillColor("#0f172a").font("Helvetica").fontSize(10).text(body, x + 12, startY + 12 + titleH + 8, { width: width - 24, lineGap: 2 });
    doc.restore();
    doc.y = startY + boxH + 8;
  }

  function ensureSpace(minHeight) {
    const bottomY = doc.page.height - doc.page.margins.bottom - 30;
    if (doc.y + minHeight > bottomY) {
      footer();
      doc.addPage();
      pageStart();
    }
  }

  return await new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Page 1
    pageStart();

    sectionTitle("Brief Overview");
    const brief = aiSummary?.groupSummary || aiSummary?.summary || "";
    const eng = overview.engagementLabel || "—";
    const prof = overview.proficiencyLabel || "—";
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(brief || "(No AI summary text provided.)", { lineGap: 2 });
    doc.moveDown(0.4);
    pill(`Engagement: ${eng}   •   Overall proficiency: ${prof}`);

    // Class Chat Blurb (copy-pasteable box)
    const chatBlurb = aiSummary?.classChatBlurb || "";
    if (chatBlurb) {
      ensureSpace(100);
      drawNoteBox("Class Chat Blurb  (copy & paste)", chatBlurb, "#ecfdf5", "#6ee7b7");
    }

    // Overlay Mode Summary (Escape Room / Whodunnit / Quest)
    if (overlayModeSummary && overlayModeSummary.active) {
      ensureSpace(140);
      sectionTitle("Special Mode Summary");
      const o = overlayModeSummary;
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      if (o.escapeRoom?.enabled) {
        const theme = o.escapeRoom.themeName ? ` — ${o.escapeRoom.themeName}` : "";
        doc.font("Helvetica-Bold").text(`Escape Room${theme}`);
        doc.font("Helvetica");
        (o.escapeRoom.teams || []).forEach((t) => {
          const status = t.escaped
            ? `escaped${t.escapeTimeMs ? ` in ${Math.round(t.escapeTimeMs / 60000)}m` : ""}`
            : `${t.locksOpened || 0} lock(s) opened, ${t.keysEarned || 0} key(s) earned`;
          doc.text(`  • ${t.teamName}: ${status}${t.hintsUsed ? ` · ${t.hintsUsed} hint(s)` : ""}`);
        });
        doc.moveDown(0.3);
      }
      if (o.whodunnit?.enabled && o.whodunnit.suspectName) {
        doc.font("Helvetica-Bold").text(`Whodunnit — Suspect: ${o.whodunnit.suspectName}`);
        doc.font("Helvetica");
        const c = o.whodunnit.accusations?.correct || [];
        const w = o.whodunnit.accusations?.incorrect || [];
        if (c.length) doc.text(`  • Correct accusations: ${c.join(", ")}`);
        if (w.length) doc.text(`  • Incorrect accusations: ${w.join(", ")}`);
        if (!c.length && !w.length) doc.text("  • No team made a final accusation.");
        if (o.whodunnit.totalClues) doc.text(`  • Total clues released: ${o.whodunnit.totalClues}`);
        doc.moveDown(0.3);
      }
      if (o.quest?.enabled) {
        doc.font("Helvetica-Bold").text(`Quest Mode`);
        doc.font("Helvetica").text(
          `  Across the class: ${o.quest.totalBonusUnlocked} bonus + ${o.quest.totalHiddenUnlocked} hidden task(s) unlocked.`
        );
        (o.quest.teams || []).forEach((t) => {
          doc.text(`  • ${t.teamName}: ${t.coinsEarned} coins earned, ${t.unlockedBonus} bonus + ${t.unlockedHidden} hidden unlocked${t.trades ? `, ${t.trades} trade(s)` : ""}`);
        });
        doc.moveDown(0.3);
      }
      if (o.levelUp?.enabled) {
        doc.font("Helvetica-Bold").text(`LevelUp Activity`);
        doc.font("Helvetica").text(
          `  ${o.levelUp.totalImproved} of ${o.levelUp.totalAttempts} retries improved on the original score.`
        );
        (o.levelUp.teams || []).forEach((t) => {
          const ups = (t.upgrades || [])
            .map((u) => {
              if (u.improved) return `task ${u.originalTaskIndex + 1}: ${u.originalScore} → ${u.retryScore} (+${u.masteryBonus} mastery)`;
              return `task ${u.originalTaskIndex + 1}: ${u.originalScore} → ${u.retryScore}, kept ${u.kept}`;
            })
            .join("; ");
          doc.text(`  • ${t.teamName}: ${ups}`);
        });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.3);
    }

    // Skills Developed
    const skills = asList(aiSummary?.skillsDeveloped).filter(Boolean);
    if (skills.length) {
      ensureSpace(60);
      sectionTitle("Skills Developed");
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      skills.forEach((s) => doc.text(`• ${s}`, { lineGap: 1 }));
      doc.moveDown(0.4);
    }

    // Bloom's Taxonomy Cognitive Profile
    if (bloomsTaxonomy && bloomsTaxonomy.levels) {
      const bt = bloomsTaxonomy;
      const activeLevels = bt.levels.filter(l => l.totalCount > 0);
      if (activeLevels.length) {
        ensureSpace(160);
        sectionTitle("Cognitive Profile — Bloom's Taxonomy");

        const subline = `${bt.cognitiveTaskCount} of ${bt.totalTaskCount} tasks mapped  •  Highest: ${bt.highestLevel}  •  Dominant: ${bt.dominantLevel}`;
        doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(subline);
        doc.moveDown(0.3);

        // Draw horizontal bar chart
        const barLeft = doc.x;
        const barMaxW = 260;
        const maxCount = Math.max(...bt.levels.map(l => l.primaryCount), 1);
        const rowH = 16;
        const labelW = 70;

        for (const lvl of bt.levels) {
          const y = doc.y;
          const barW = Math.max(lvl.primaryCount > 0 ? 6 : 0, Math.round((lvl.primaryCount / maxCount) * barMaxW));
          const alpha = lvl.primaryCount > 0 ? 1 : 0.25;

          doc.save();
          doc.opacity(alpha);
          // Label (right-aligned)
          doc.font("Helvetica-Bold").fontSize(9).fillColor(lvl.color);
          doc.text(lvl.label, barLeft, y + 2, { width: labelW, align: "right", lineBreak: false });

          // Bar background
          doc.rect(barLeft + labelW + 8, y + 1, barMaxW, rowH - 2).fill("#f1f5f9");
          // Bar fill
          if (barW > 0) {
            doc.rect(barLeft + labelW + 8, y + 1, barW, rowH - 2).fill(lvl.color);
          }

          // Count label
          doc.font("Helvetica").fontSize(9).fillColor("#64748b");
          doc.text(String(lvl.primaryCount), barLeft + labelW + barMaxW + 14, y + 2, { width: 40, lineBreak: false });
          doc.restore();

          doc.y = y + rowH + 1;
        }

        // Reset x back to left margin after bar chart drawing
        doc.x = doc.page.margins.left;
        doc.moveDown(0.3);

        // Cognitive profile narrative from AI
        const cogProfile = aiSummary?.cognitiveProfile || "";
        if (cogProfile) {
          const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.font("Helvetica").fontSize(10).fillColor("#334155").text(cogProfile, doc.page.margins.left, doc.y, { width: contentW, lineGap: 2 });
          doc.moveDown(0.2);
        }

        // Deterministic summary
        const contentW2 = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(bt.summary, doc.page.margins.left, doc.y, { width: contentW2, lineGap: 1 });
        doc.moveDown(0.4);
      }
    }

    // Helper: full-width text to avoid x-drift from previous sections
    const fullW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    function fullText(str, opts = {}) {
      doc.text(str, doc.page.margins.left, doc.y, { width: fullW, ...opts });
    }

    // Standards Alignment
    const standards = asList(aiSummary?.standardsAlignment).filter(Boolean);
    if (standards.length) {
      ensureSpace(100);
      sectionTitle("Standards Alignment");
      standards.forEach((s) => {
        const prefix = s.code ? `[${s.code}] ` : "";
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e40af");
        fullText(`${prefix}${s.standard || ""}`, { lineGap: 1 });
        if (s.connection) {
          doc.font("Helvetica").fontSize(9).fillColor("#475569");
          fullText(`  ${s.connection}`, { lineGap: 1 });
        }
        doc.moveDown(0.15);
      });
      doc.moveDown(0.3);
    }

    sectionTitle("Concepts Covered");
    if (overview.concepts.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      overview.concepts.forEach((c) => fullText(`• ${c}`, { lineGap: 1 }));
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569");
      fullText("(No concepts detected.)");
    }
    doc.moveDown(0.4);

    sectionTitle("Activities Completed");
    if (overview.activities.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      overview.activities.forEach((a) => fullText(`• ${a}`, { lineGap: 1 }));
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569");
      fullText("(No activities detected.)");
    }
    doc.moveDown(0.4);

    const cats = asList(assessmentCategories).filter(Boolean);
    if (cats.length) {
      sectionTitle("Assessment Categories");
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      cats.forEach((c) => fullText(`• ${c.label || c.name || String(c)}`));
      doc.moveDown(0.4);
    }

    const cls = className || "class";
    const grade = gradeLevel != null && String(gradeLevel).trim() ? ` (Grade ${gradeLevel})` : "";
    const conceptLine = overview.concepts.length ? overview.concepts.slice(0, 3).join(", ") : "key concepts";
    const actLine = overview.activities.length ? overview.activities.slice(0, 3).join(", ") : "interactive activities";
    const noteToParents =
      `Today in ${cls}${grade}, we completed a Curriculate activity wherein students were actively involved in exploring/reviewing ${conceptLine}. ` +
      `They completed activities such as ${actLine}. The level of engagement was ${eng}. Overall, students achieved ${prof}.`;

    ensureSpace(120);
    drawNoteBox("Note to Parents", noteToParents);

    // Student Grades table (gradebook)
    const gradesList = asList(studentGrades).filter(Boolean);
    if (gradesList.length) {
      ensureSpace(180);
      sectionTitle("Student Grades");

      const gc = gradingConfig && typeof gradingConfig === "object" ? gradingConfig : {};
      if (gc.maxGrade) {
        doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`Out of ${gc.maxGrade}`);
        doc.moveDown(0.2);
      }

      // Trend column is PRO-only (matches the email-HTML rendering above).
      const showTrendPdf = isPlanAtLeastPro(planName);
      const gColW = showTrendPdf
        ? [0.20, 0.14, 0.14, 0.10, 0.16, 0.12, 0.14]
        : [0.22, 0.16, 0.16, 0.12, 0.18, 0.16];
      const gColLabels = showTrendPdf
        ? ["Student", "Team", "Points", "%", "Grade", "Letter", "Trend"]
        : ["Student", "Team", "Points", "%", "Grade", "Letter"];
      const gTableX = doc.page.margins.left;
      const gTableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Header
      const gHeaderY = doc.y;
      doc.save();
      doc.rect(gTableX, gHeaderY, gTableW, 20).fill("#3b82f6");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      let gxCur = gTableX;
      gColLabels.forEach((label, i) => {
        doc.text(label, gxCur + 4, gHeaderY + 6, { width: gTableW * gColW[i] - 8, lineBreak: false });
        gxCur += gTableW * gColW[i];
      });
      doc.restore();
      doc.y = gHeaderY + 22;

      const sortedG = [...gradesList].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
      doc.font("Helvetica").fontSize(8).fillColor("#0f172a");

      for (let ri = 0; ri < sortedG.length; ri++) {
        const g = sortedG[ri];
        ensureSpace(18);

        if (ri % 2 === 1) {
          doc.save();
          doc.rect(gTableX, doc.y - 2, gTableW, 16).fill("#f8fafc");
          doc.restore();
          doc.fillColor("#0f172a");
        }

        // Improvement / trend value (Mode B only) — rendered as a colored
        // arrow + delta. Falls back to "—" when no edsbyId, "1st" for
        // brand-new players.
        const imp = g?.improvement;
        let trendStr = "—";
        let trendColor = null;
        if (imp) {
          if (imp.priorCount === 0 || imp.trend === "first") {
            trendStr = "1st";
            trendColor = "#6b7280";
          } else {
            const v = Number(imp.vsLast || 0);
            const sign = v > 0 ? "+" : "";
            const arrow = imp.trend === "up" ? "▲" : imp.trend === "down" ? "▼" : "—";
            trendStr = `${arrow} ${sign}${v}%`;
            trendColor =
              imp.trend === "up" ? "#15803d" :
              imp.trend === "down" ? "#dc2626" : "#4b5563";
          }
        }

        const baseVals = [
          g.studentName || "—",
          g.teamName || "—",
          `${g.pointsEarned ?? 0}/${g.pointsPossible ?? 0}`,
          `${g.percent ?? 0}%`,
          `${g.scaledGrade ?? 0}/${g.maxGrade ?? 100}`,
          g.letterGrade || "—",
        ];
        const vals = showTrendPdf ? [...baseVals, trendStr] : baseVals;

        gxCur = gTableX;
        const rowY = doc.y;
        vals.forEach((v, i) => {
          if (i === vals.length - 1 && trendColor) {
            doc.save();
            doc.fillColor(trendColor).font("Helvetica-Bold");
            doc.text(v, gxCur + 4, rowY, { width: gTableW * gColW[i] - 8, lineBreak: false });
            doc.restore();
            doc.fillColor("#0f172a").font("Helvetica");
          } else {
            doc.text(v, gxCur + 4, rowY, { width: gTableW * gColW[i] - 8, lineBreak: false });
          }
          gxCur += gTableW * gColW[i];
        });
        doc.y = rowY + 14;
      }

      // Class average
      if (sortedG.length > 1) {
        const avgPct = Math.round(sortedG.reduce((s, g) => s + (g.percent ?? 0), 0) / sortedG.length);
        const avgScaled = (sortedG.reduce((s, g) => s + (g.scaledGrade ?? 0), 0) / sortedG.length).toFixed(1);
        const avgY = doc.y;
        doc.save();
        doc.rect(gTableX, avgY - 2, gTableW, 18).fill("#e0e7ff");
        doc.restore();
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a");
        doc.text("Class Average", gTableX + 4, avgY, { width: gTableW * 0.54 - 8, lineBreak: false });
        doc.text(`${avgPct}%`, gTableX + gTableW * 0.54 + 4, avgY, { width: gTableW * 0.12 - 8, lineBreak: false });
        doc.text(`${avgScaled}/${sortedG[0]?.maxGrade ?? 100}`, gTableX + gTableW * 0.66 + 4, avgY, { width: gTableW * 0.18 - 8, lineBreak: false });
        doc.y = avgY + 18;
      }

      doc.moveDown(0.6);
    }

    ensureSpace(80);
    sectionTitle("Teams");

    const tableX = doc.page.margins.left;
    const tableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cols = [
      { label: "Team", w: 0.14 },
      { label: "Members", w: 0.20 },
      { label: "Mood", w: 0.12 },
      { label: "Tasks", w: 0.07 },
      { label: "Engagement", w: 0.12 },
      { label: "Score", w: 0.10 },
      { label: "%", w: 0.06 },
      { label: "Exit feedback", w: 0.19 },
    ];
    const colXs = [];
    let xCursor = tableX;
    cols.forEach((c) => {
      colXs.push(xCursor);
      xCursor += tableW * c.w;
    });

    // Header row
    const teamHeaderY = doc.y;
    doc.save();
    doc.rect(tableX, teamHeaderY, tableW, 22).fill("#f1f5f9");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9);
    cols.forEach((c, i) => {
      doc.text(c.label, colXs[i] + 4, teamHeaderY + 6, { width: tableW * c.w - 8, lineBreak: false });
    });
    doc.restore();
    doc.y = teamHeaderY + 24;
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");

    function rowHeightFor(values) {
      const lineH = 11.5;
      let maxLines = 1;
      values.forEach((v, i) => {
        const w = tableW * cols[i].w - 8;
        const h = doc.heightOfString(v, { width: w });
        maxLines = Math.max(maxLines, Math.ceil(h / lineH));
      });
      return maxLines * lineH + 10;
    }

    for (const t of teams) {
      const members = asList(t.members).filter(Boolean).join(", ") || "—";
      const moods = asList(t.moodsIn || t.moods || t.moodIn).filter(Boolean).join(", ") || "—";
      const tasksCompleted = t.tasksCompleted != null ? String(t.tasksCompleted) : (t.tasksDone != null ? String(t.tasksDone) : "—");
      const engagement =
        t.engagementLabel || t.engagement || (typeof t.engagementPercent === "number" ? `${t.engagementPercent}%` : "—");
      const scoreVal = t.teamScore != null ? t.teamScore : (t.score != null ? t.score : "—");
      const outOf =
        t.totalPossible != null ? t.totalPossible : (typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null);
      const percent = outOf != null && typeof scoreVal === "number" ? `${pct(scoreVal, outOf)}%` : "—";
      const exit = t.exitFeedback || t.exit || "—";

      const vals = [
        String(t.teamName || "Team"),
        members,
        moods,
        tasksCompleted,
        engagement,
        String(scoreVal),
        percent,
        exit,
      ];

      const rh = rowHeightFor(vals);
      ensureSpace(rh + 20);

      const teamRowY = doc.y;
      doc.save();
      doc.rect(tableX, teamRowY - 2, tableW, rh).stroke("#e5e7eb");
      doc.restore();

      cols.forEach((c, i) => {
        const w = tableW * c.w - 8;
        doc.text(vals[i], colXs[i] + 4, teamRowY + 4, { width: w });
      });

      doc.y = teamRowY + rh;
    }

    doc.moveDown(0.6);

    ensureSpace(60);
    sectionTitle("Photo / Recording Submissions");
    if (media.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      media.slice(0, 60).forEach((m) => {
        const parts = [
          m.taskTitle ? `Activity: ${m.taskTitle}` : null,
          m.teamName ? `Team: ${m.teamName}` : null,
          m.filename ? `File: ${m.filename}` : null,
          m.url ? `Link: ${m.url}` : null,
        ].filter(Boolean);
        doc.text(`• ${parts.join(" • ")}`, { lineGap: 1 });
      });
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("(No photo/recording submissions were attached to this session.)");
    }

    // ---- Speech & text quality by speaker ----
    const qualityMap = collectTextByParticipant(transcript, aiSummary);
    const qualityRows = [];
    for (const rec of qualityMap.values()) {
      const q = computeTextQuality(rec.text);
      if (q.words < 3) continue;
      qualityRows.push({
        name: rec.name,
        isTeam: rec.isTeam,
        responses: rec.count,
        words: q.words,
        fillers: q.fillers,
        score: q.score,
        grade: qualityGrade(q.score),
        fillerExamples: q.fillerExamples,
      });
    }
    if (qualityRows.length) {
      qualityRows.sort((a, b) => b.score - a.score);
      doc.moveDown(0.6);
      ensureSpace(120);
      sectionTitle("Speech & Text Quality by Speaker");
      doc.font("Helvetica").fontSize(9).fillColor("#475569").text(
        "A 0–100 read on each speaker's written and spoken (dictated) responses: higher = more sustained, varied, " +
          "substantive language; lower = very short or filler-heavy (“um”, “uh”, “like”, “you know”). " +
          "Gauges expression, not correctness.",
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
      );
      doc.moveDown(0.4);

      const qx = doc.page.margins.left;
      const c = { name: qx, resp: qx + 220, words: qx + 290, fill: qx + 360, qual: qx + 440 };
      let hy = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#64748b");
      doc.text("SPEAKER", c.name, hy);
      doc.text("RESP.", c.resp, hy);
      doc.text("WORDS", c.words, hy);
      doc.text("FILLERS", c.fill, hy);
      doc.text("QUALITY", c.qual, hy);
      doc.moveTo(qx, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
      doc.moveDown(0.5);

      for (const r of qualityRows) {
        ensureSpace(34);
        const ry = doc.y;
        const qc = r.score >= 80 ? "#16a34a" : r.score >= 60 ? "#22c55e" : r.score >= 40 ? "#b45309" : r.score >= 20 ? "#ea580c" : "#dc2626";
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
          .text(r.name + (r.isTeam ? " (team)" : ""), c.name, ry, { width: 210, ellipsis: true });
        doc.font("Helvetica").fontSize(10).fillColor("#334155");
        doc.text(String(r.responses), c.resp, ry);
        doc.text(String(r.words), c.words, ry);
        doc.text(String(r.fillers), c.fill, ry);
        doc.font("Helvetica-Bold").fillColor(qc).text(`${r.score} · ${r.grade}`, c.qual, ry);
        doc.y = ry + 16;
      }
      doc.fillColor("#0f172a");
    }

    const upgradeLine = buildSoftUpgradeLine(planName);
    if (upgradeLine) {
      doc.moveDown(0.8);
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(upgradeLine, { align: "center" });
      doc.fillColor("#0f172a");
    }

    footer();

    // Optional individual pages
    const perParticipant = asList(aiSummary?.perParticipant).filter(Boolean);
    if (wantIndividualPages && perParticipant.length) {
      // Build a name-keyed lookup of grade row -> improvement so the
      // per-student page can show a trend line under the headline pills.
      const gradeByName = new Map();
      for (const g of asList(studentGrades)) {
        if (!g) continue;
        gradeByName.set(String(g.studentName || "").toLowerCase(), g);
      }

      for (const p of perParticipant) {
        doc.addPage();
        pageStart();
        sectionTitle("Student Session Report");

        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(p.studentName || "Student");
        doc.font("Helvetica").fontSize(10).fillColor("#475569").text(`Team: ${p.teamName || "—"}`);
        doc.moveDown(0.6);

        const engP = typeof p.engagementPercent === "number" ? `${clamp(p.engagementPercent, 0, 100)}%` : "—";
        const finalP = typeof p.finalPercent === "number" ? `${clamp(p.finalPercent, 0, 100)}%` : "—";
        pill(`Engagement: ${engP}   •   Overall mark: ${finalP}`);

        // Mode B: show improvement vs. prior sessions (PRO-only).
        const gradeRow = gradeByName.get(String(p.studentName || "").toLowerCase());
        const imp = isPlanAtLeastPro(planName) ? gradeRow?.improvement : null;
        if (imp) {
          let line = "";
          let color = "#475569";
          if (imp.priorCount === 0 || imp.trend === "first") {
            line = "First time playing — this score sets the baseline.";
            color = "#1d4ed8";
          } else {
            const v = Number(imp.vsLast || 0);
            const sign = v > 0 ? "+" : "";
            const va = Number(imp.vsAvg || 0);
            const signA = va > 0 ? "+" : "";
            const verb = imp.trend === "up" ? "Improved" : imp.trend === "down" ? "Slipped" : "Held steady";
            line = `${verb}: ${sign}${v}% vs. last session, ${signA}${va}% vs. ${imp.priorCount}-session average.`;
            color = imp.trend === "up" ? "#15803d" : imp.trend === "down" ? "#dc2626" : "#4b5563";
          }
          doc.font("Helvetica-Bold").fontSize(10).fillColor(color).text(line);
          doc.fillColor("#0f172a");
          doc.moveDown(0.4);
        }

        const catsP = asList(p.categories);
        if (catsP.length) {
          sectionTitle("Category Breakdown");
          doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
          catsP.forEach((c) => {
            const pText = typeof c.percent === "number" ? `${clamp(c.percent, 0, 100)}%` : "—";
            const label = c.label || c.name || "Category";
            const comment = c.comment ? ` — ${c.comment}` : "";
            doc.text(`• ${label}: ${pText}${comment}`, { lineGap: 1 });
          });
          doc.moveDown(0.4);
        }

        // Speech & text quality for this student (from their captured
        // written/dictated responses). Falls back to the team bucket for
        // group work where individual text wasn't attributed.
        const qRec =
          qualityMap.get(String(p.studentName || "").toLowerCase()) ||
          (p.teamName ? qualityMap.get(String(p.teamName).toLowerCase()) : null);
        if (qRec) {
          const q = computeTextQuality(qRec.text);
          if (q.words >= 3) {
            const qc = q.score >= 80 ? "#16a34a" : q.score >= 60 ? "#22c55e" : q.score >= 40 ? "#b45309" : q.score >= 20 ? "#ea580c" : "#dc2626";
            sectionTitle("Speech & Text Quality");
            doc.font("Helvetica-Bold").fontSize(11).fillColor(qc).text(`${q.score} / 100 — ${qualityGrade(q.score)}`);
            doc.font("Helvetica").fontSize(9).fillColor("#475569").text(
              `${q.words} words across ${qRec.count} response${qRec.count === 1 ? "" : "s"}` +
                (q.fillers > 0 ? ` · ${q.fillers} filler word${q.fillers === 1 ? "" : "s"}${q.fillerExamples.length ? ` (${q.fillerExamples.slice(0, 3).join(", ")})` : ""}` : " · no filler words — nicely done")
            );
            doc.fillColor("#0f172a");
            doc.moveDown(0.4);
          }
        }

        sectionTitle("Teacher Comment");
        doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(p.summary || "—", { lineGap: 2 });

        footer();
      }
    }

    doc.end();
  });
}

// --------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------
export async function sendTranscriptEmail({
  to,
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
  studentGrades,
  gradingConfig,
  bloomsTaxonomy,
  // NEW: optional CSV attachment + metadata for the email body block
  csvAttachment, // { csv: string, anyMatched, hasAnyId, completedCount, totalCount }
  classBound = false, // true if this session was launched with a class binding
  // NEW: overlay-mode (Escape Room / Whodunnit / Quest) summary for the email body + subject
  overlayModeSummary = null,
  overlayHeadline: overlayHeadlineText = "",
}) {
  if (!to) throw new Error("Missing destination email.");
  if (!transcript) throw new Error("Missing transcript payload.");

  const csvInfo = csvAttachment && csvAttachment.csv ? csvAttachment : null;

  const html = buildEmailHtml({
    transcript,
    aiSummary,
    schoolName,
    perspectives,
    planName,
    className,
    gradeLevel,
    assessmentCategories,
    includeIndividualReports,
    studentGrades,
    gradingConfig,
    bloomsTaxonomy,
    csvInfo,
    classBound,
    overlayModeSummary,
  });

  const pdfBuffer = await buildReportPdfBuffer({
    transcript,
    aiSummary,
    includeIndividualReports,
    schoolName,
    perspectives,
    planName,
    className,
    gradeLevel,
    assessmentCategories,
    studentGrades,
    gradingConfig,
    bloomsTaxonomy,
    overlayModeSummary,
  });

  const roomCode = transcript?.roomCode || transcript?.code || "";
  const tasksetName = transcript?.tasksetName || transcript?.name || "Curriculate Activity";

  // Prepend an overlay-mode prefix like "[Escape Room] " or "[Whodunnit] "
  // so teachers can spot themed sessions in their inbox at a glance.
  const overlayPrefix = (() => {
    const o = overlayModeSummary;
    if (!o || !o.active) return "";
    if (o.escapeRoom?.enabled && o.whodunnit?.enabled) return "[Escape Room × Whodunnit] ";
    if (o.escapeRoom?.enabled) return "[Escape Room] ";
    if (o.whodunnit?.enabled) return "[Whodunnit] ";
    if (o.quest?.enabled) return "[Quest Mode] ";
    return "";
  })();
  const subject = process.env.EMAIL_SUBJECT_PREFIX
    ? `${process.env.EMAIL_SUBJECT_PREFIX} ${overlayPrefix}${tasksetName} (Room ${roomCode})`
    : `${overlayPrefix}Curriculate Report Ready — ${tasksetName} (Room ${roomCode})`;

    // Build the attachments array. PDF is always present.
    // CSV is appended only if a non-empty csvInfo was passed in and at
    // least one student completed (csv body has more than just the header).
    const attachments = [
      {
        filename: `Curriculate-Report-${roomCode || "session"}.pdf`,
        content: pdfBuffer,
      },
    ];

    if (csvInfo && csvInfo.completedCount > 0 && csvInfo.csv) {
      const safeName = String(tasksetName || "Curriculate")
        .replace(/[^A-Za-z0-9_\- ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60) || "Curriculate";
      const csvFilename =
        (csvInfo.hasAnyId
          ? `${safeName}-edsby-import.csv`
          : `${safeName}-grades.csv`);
      attachments.push({
        filename: csvFilename,
        content: Buffer.from(csvInfo.csv, "utf8"),
        contentType: "text/csv; charset=utf-8",
      });
    }

    await sendSystemEmail({
      to,
      subject,
      html,
      attachments,
    });

}
