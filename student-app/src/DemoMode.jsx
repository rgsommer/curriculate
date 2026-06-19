// student-app/src/DemoMode.jsx
//
// Conference Demo / Classroom Practice Mode — standalone task showcase.
// Visitors or students enter name + email, rotate through sample tasks,
// earn points per completed task. Results are captured per-user and
// emailed as a report.
//
// Props (set via route):
//   source="conference" → conference branding + promo code
//   source="classroom"  → classroom branding + leaderboard

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import DEMO_TASKS_RAW from "./demoTasks.js";
import { API_BASE_URL } from "./config.js";

// Task types that fundamentally need MULTIPLE live people (debate opponents,
// a pass-around chain, peer teach-back/rating, mime guessers, a team selfie,
// a duel). They technically "complete" via the simulated demo socket, but a
// lone practicer just finds them pointless — tester (Michael) skipped each with
// "im solo" / "solo". We hide them from the solo practice queue. They remain in
// the full catalog (features page) and in real, multi-student sessions.
const SOLO_UNFRIENDLY_TYPES = new Set([
  "ai-debate-judge",
  "live-debate",
  "echo-chain",
  "collaboration",
  "narration-synthesize",
  "brainstorm-battle",
  "draw-mime",
  "mime",
  "script-play",
  "team-selfie",
  "hangman-duel",
  "musical-chairs",
]);

// The queue every solo practice run draws from (multiplayer-only types removed).
const DEMO_TASKS = DEMO_TASKS_RAW.filter(
  (t) => !SOLO_UNFRIENDLY_TYPES.has(String(t?.taskType || t?.type || ""))
);

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// Practice idle behaviour (changed per tester request):
//
//   1. After IDLE_PROMPT_MS of no activity → show a "Done practicing?"
//      modal asking the player whether to keep going on this task or
//      finish the whole practice session.
//   2. If they don't answer the modal AND remain idle for another
//      IDLE_AUTO_END_MS, we auto-finish the entire practice session
//      (not just skip the current task) — same outcome as tapping
//      "I'm done".  Any activity dismisses the modal and resets the
//      clock.
//
// This replaces the old "silent auto-skip after 60s" which testers
// hated (lost their place / typed feedback).
const IDLE_PROMPT_MS    = 10 * 60 * 1000;  // 10 min → "Done practicing?"
const IDLE_AUTO_END_MS  =  5 * 60 * 1000;  // + 5 min → auto end session

// Conference mode is much shorter.  Booth visitors might scan ONE QR
// code and then get pulled away by another exhibitor — we still want
// to capture their activity (with a final report email) instead of
// leaving the session open forever.  No modal, no warning: 30s of
// inactivity = session ends, report goes out.  Per Richard: "even if
// it is their first one, this captures their activity no matter what
// their intentions were in case they get distracted."
const CONFERENCE_IDLE_END_MS = 30 * 1000;

// ---- Mascot images & videos (served from frontend/public/images/mascot/) ----
const MASCOT_BASE = "https://curriculate.net/images/mascot";
const MASCOT_COUNTS = {
  "practice-signin": 3, "demo-signin": 4, "celebrate": 4,
  "recommend": 4, "treat": 4, "ambassador": 4, "feedback": 2,
  "streak": 4, "promo": 4, "thinking": 4,
};
// Categories that have a looping video (1.mp4); prefer video when available
const MASCOT_VIDEO = new Set(["celebrate", "streak", "treat"]);

/** Pick a random mascot image URL for a given category */
function mascotSrc(category) {
  const count = MASCOT_COUNTS[category] || 1;
  const n = Math.floor(Math.random() * count) + 1;
  return `${MASCOT_BASE}/${category}/${n}.png`;
}
/** Mascot element — renders <video> loop for animated categories, <img> for static.
 *  Applies a soft radial fade so edges blend naturally into any background.
 *  drop-shadow is applied to the wrapper so it isn't clipped by the mask. */
function Mascot({ category, size = 120, style = {} }) {
  const [imgSrc] = useState(() => mascotSrc(category));
  // Separate filter (drop-shadow) from the rest so shadow lives on wrapper, mask on media
  const { filter, ...restStyle } = style;
  const softEdge = {
    WebkitMaskImage: "radial-gradient(circle, #000 60%, transparent 100%)",
    maskImage: "radial-gradient(circle, #000 60%, transparent 100%)",
  };
  const mediaStyle = { width: size, height: size, objectFit: "contain", ...softEdge, ...restStyle };
  const wrapStyle = { display: "inline-block", ...(filter ? { filter } : {}) };

  const media = MASCOT_VIDEO.has(category) ? (
    <video
      src={`${MASCOT_BASE}/${category}/1.mp4`}
      autoPlay loop muted playsInline
      poster={imgSrc}
      style={{ ...mediaStyle, background: "transparent" }}
    />
  ) : (
    <img src={imgSrc} alt="Curriculate mascot" style={mediaStyle} />
  );

  return <span style={wrapStyle}>{media}</span>;
}
// (Legacy ACTIVITY_EXTEND_MS / TEXT_HEAVY_TYPES removed — the new
// document-wide activity-based timer makes per-task-type extensions
// unnecessary; ANY keystroke / pointer event resets the idle clock
// for ANY task.)

// Default points per task type (backend is source of truth; these are fallback)
const DEFAULT_TASK_POINTS = {
  "multiple-choice": 10, "physical-multiple-choice": 10, "true-false": 10,
  "short-answer": 15, "reading-comp": 20, "open-text": 15,
  sort: 15, sequence: 15, matching: 15, timeline: 15, vennsort: 20,
  draw: 20, mime: 15, photo: 15, "make-and-snap": 20, "photo-journal": 20,
  "speed-draw": 25, "draw-mime": 20,
  "body-break": 10, "musical-chairs": 15, "motion-mission": 15,
  "mad-dash": 15, "mad-dash-sequence": 15,
  "mood-checkin": 5, "team-selfie": 10, "treasure-runner": 15,
  "brain-blitz": 25, "true-false-tictactoe": 20, "true-false-connect-four": 20,
  "tower-builder": 20, flashcards: 10, "flashcards-race": 20,
  "pet-feeding": 15, "diff-detective": 20, "hangman-duel": 20,
  "word-weaver-duel": 20, "guess-who": 20, "echo-chain": 15,
  spinner: 10, trivia: 15, riddle: 20,
  collaboration: 15, "live-debate": 25, "ai-debate-judge": 25,
  "brainstorm-battle": 20, "mystery-clues": 15, "fake-out": 20,
  "brain-spark-notes": 20, "mind-mapper": 20, "narration-synthesize": 20,
  "role-play": 20, "role-play-deck": 20, "script-play": 20,
  pronunciation: 15, "speech-recognition": 15, "record-audio": 15,
  letter: 20, "case-study": 25, "art-view": 20, "historical-doc": 20,
  hidenseek: 15, storytelling: 25, "peer-editing": 20, interview: 25,
  cloze: 15, "teach-back": 20,
};
const DEFAULT_PTS = 10;

// NEW-type bonus multiplier / repeat penalty
const NEW_TYPE_MULTIPLIER = 1.5;  // 1.5× for first encounter of a task type
const REPEAT_MULTIPLIER = 0.5;    // 0.5× for types already completed

function getBaseTaskPts(taskType, pointsMap) {
  return (pointsMap || DEFAULT_TASK_POINTS)[taskType] || DEFAULT_PTS;
}

/** Adaptive points: bonus for new types, penalty for repeats */
function getAdaptivePts(taskType, pointsMap, completedTypes) {
  const base = getBaseTaskPts(taskType, pointsMap);
  if (!completedTypes || completedTypes.size === 0) return { pts: Math.round(base * NEW_TYPE_MULTIPLIER), isNew: true };
  if (!completedTypes.has(taskType)) return { pts: Math.round(base * NEW_TYPE_MULTIPLIER), isNew: true };
  return { pts: Math.round(base * REPEAT_MULTIPLIER), isNew: false };
}

/** Shuffle array (Fisher-Yates) */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a smart task order: one task per type first (shuffled), then
 * remaining duplicates (shuffled) at the end. Students see every type
 * before encountering repeats.
 */
// Task types changed recently — prioritize them in practice so fixes get
// re-verified in the field. Keep this list fresh as fixes land.
// Tester (2026-05-31): "practice mode was supposed to prioritize less-
// practiced/new tasks. I was surprised MapIt did not come up" → mapit
// added; also pulled in the other recently-shipped types that needed
// field-verification in the latest waves.
const RECENTLY_UPDATED_TASK_TYPES = new Set([
  "upvote",                   // new task type (just shipped)
  "mapit",                    // new task type (just shipped)
  "make-and-snap",            // over-stuffing guard
  "collaboration",            // over-stuffing guard
  "true-false", "legends", "diff-detective", "historical-doc", "art-view",
  "echo-chain", "what-am-i", "narration-synthesize", "ai-debate-judge",
  "word-weaver-duel", "mystery-clues", "body-break", "open-text", "teach-back",
]);

// Order practice tasks (one per type) for maximum coverage of new task
// types each session. Priority ladder:
//   1. Types THIS tester has never tried (covers the 6/68-only gap —
//      owner concern 2026-06-04: most testers only hit a small slice
//      of the catalog).
//   2. Recently-fixed types (so fresh fixes get re-verified).
//   3. Least globally-practiced types (so every type gets field data).
// `counts` is the global { taskType: completedCount } from practice-stats.
// `triedSet` is this tester's personal Set<taskType> from /exhausted-types.
function buildSmartTaskOrder(tasks, counts = {}, triedSet = new Set()) {
  const seen = new Set();
  const firstPass = [];
  const extras = [];
  // Shuffle first so ties (same count) are randomized rather than fixed-order.
  const shuffled = shuffleArray(tasks);
  for (const t of shuffled) {
    if (!seen.has(t.taskType)) {
      seen.add(t.taskType);
      firstPass.push(t);
    } else {
      extras.push(t);
    }
  }
  // Rank the one-per-type pass.
  firstPass.sort((a, b) => {
    // 1. Personally untried beats personally tried. Without this, a
    //    returning tester re-cycles the same handful of types they
    //    happened to start with.
    const aTried = triedSet.has(a.taskType) ? 1 : 0;
    const bTried = triedSet.has(b.taskType) ? 1 : 0;
    if (aTried !== bTried) return aTried - bTried;
    // 2. Recently-fixed first (verify fresh fixes).
    const aFixed = RECENTLY_UPDATED_TASK_TYPES.has(a.taskType) ? 0 : 1;
    const bFixed = RECENTLY_UPDATED_TASK_TYPES.has(b.taskType) ? 0 : 1;
    if (aFixed !== bFixed) return aFixed - bFixed;
    // 3. Least globally-practiced.
    const aCount = counts[a.taskType] ?? 0;
    const bCount = counts[b.taskType] ?? 0;
    return aCount - bCount;
  });
  return [...firstPass, ...shuffleArray(extras)];
}

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ----------------------------------------------------------------
// Phase: Email Capture
// ----------------------------------------------------------------

function EmailCapture({ onStart, source, classroom, promoCode, conferenceName, conferenceLocation, conferenceDate }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isClassroom = source === "classroom";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email.");
    setError("");
    setSubmitting(true);

    let taskPoints = null;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/conference/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: role.trim() || undefined,
          source,
          classroom: classroom || "",
          conference: conferenceName || "general",
          promoCode: promoCode || "CONFERENCE2025",
        }),
      });
      const data = await resp.json();
      if (data.taskPoints) taskPoints = data.taskPoints;
    } catch (err) {
      console.warn("[demo] registration fetch failed:", err);
    }

    setSubmitting(false);
    onStart({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: role.trim(),
      taskPoints: taskPoints || DEFAULT_TASK_POINTS,
    });
  };

  return (
    <div style={styles.captureOuter}>
      <div style={styles.captureCard}>
        <Mascot
          category={isClassroom ? "practice-signin" : "demo-signin"}
          size={140}
          style={{ marginBottom: -8, filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.15))" }}
        />
        <h1 style={styles.captureTitle}>
          {isClassroom ? "Curriculate Practice Mode" : "Try Curriculate"}
        </h1>
        {/* Conference info banner */}
        {!isClassroom && conferenceName && (
          <div style={{
            background: "linear-gradient(135deg, #eff6ff, #f0f9ff)",
            border: "1px solid #93c5fd",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 12,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e40af" }}>{conferenceName}</div>
            {conferenceLocation && <div style={{ fontSize: 12, color: "#3b82f6" }}>{conferenceLocation}</div>}
            {conferenceDate && <div style={{ fontSize: 12, color: "#3b82f6" }}>{conferenceDate}</div>}
          </div>
        )}

        <p style={styles.captureSubtitle}>
          {isClassroom
            ? "Try 60+ interactive task types and earn points! Your teacher can see your progress."
            : "Experience 60+ interactive task types used in classrooms worldwide. Takes about 5 minutes — or skip around!"}
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <label style={styles.label}>Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isClassroom ? "e.g. Sarah J." : "e.g. Sarah"}
            style={styles.input}
            autoFocus
          />

          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isClassroom ? "your school email" : "you@school.edu"}
            style={styles.input}
          />

          {!isClassroom && (
            <>
              <label style={styles.label}>Role (optional)</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Grade 5 Teacher, VP, IT Lead"
                style={styles.input}
              />
            </>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={submitting} style={styles.startBtn}>
            {submitting ? "Loading…" : isClassroom ? "Start Practicing →" : "Start Demo →"}
          </button>
        </form>

        <p style={{ fontSize: 11, opacity: 0.5, marginTop: 16, textAlign: "center" }}>
          {isClassroom
            ? "We'll email you a report of your results and points earned."
            : "We'll email you a report of your results + a free 1-month credit."}
        </p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Task Feedback Popup (shown after each completed task)
// ----------------------------------------------------------------

// ── Two-phase feedback (ratings + comment) ──────────────────────
// Phase 1: two emoji rows (fun + clarity) — tap one in each row.
// Phase 2: comment / suggestion box. ALWAYS shown after the user picks
// ratings, so the student gets a chance to explain or suggest. The
// dialog only dismisses on Submit (no auto-dismiss timer, no
// auto-submit on high ratings).
//
// Required-feedback rule: if either rating is ≤ 2 ("low" — Boring/Meh
// for fun, or Lost/Confusing for clarity), Submit is disabled until
// the student has typed at least a few words. We treat low ratings as
// the most important moment to capture what went wrong.

const EMOJI_FUN = [
  { val: 1, face: "😴", label: "Boring" },
  { val: 2, face: "😐", label: "Meh" },
  { val: 3, face: "🙂", label: "OK" },
  { val: 4, face: "😄", label: "Fun!" },
  { val: 5, face: "🤩", label: "Loved it!" },
];
const EMOJI_CLARITY = [
  { val: 1, face: "😵", label: "Lost" },
  { val: 2, face: "🤔", label: "Confusing" },
  { val: 3, face: "😊", label: "Mostly clear" },
  { val: 4, face: "👍", label: "Clear" },
  { val: 5, face: "💡", label: "Crystal clear" },
];

const MIN_REQUIRED_FEEDBACK_CHARS = 8;

// ── Vague-comment detector (low-rating only) ─────────────────────────
// When a tester rates fun/clarity ≤ 2 and leaves a comment that's
// effectively content-free ("it didn't work", "broken", "stupid",
// pure keysmash like "asdfgh"), we want to gently prompt them for
// specifics rather than letting that go straight to the feedback log
// where it's not actionable.  Pattern list is intentionally narrow —
// any half-decent description (e.g. "the buttons wouldn't click")
// passes through immediately.
const VAGUE_COMMENT_PATTERNS = [
  /^\s*(?:it\s+)?(?:did\s*n[o']?t|does\s*n[o']?t|didnt|doesnt|don[o']?t)\s+work\s*\.?\s*$/i,
  /^\s*(?:it\s+)?(?:is|was|s|wasnt|isnt|aint)\s*(?:broken|bad|stupid|dumb|ugly|terrible|awful|garbage|trash|boring|lame)\s*\.?\s*$/i,
  /^\s*(?:broken|stupid|bad|dumb|trash|garbage|lame|boring|ugly|terrible|awful|nope|nothing|nothings|n\/a|na|none|nada|huh|idk)\s*\.?\s*$/i,
  /^\s*nothing\s+(?:happened|works|worked)\s*\.?\s*$/i,
  /^\s*(?:hate|hated|hates)\s+it\s*\.?\s*$/i,
];
function looksTooVague(rawComment) {
  const c = String(rawComment || "").trim().toLowerCase();
  if (!c) return false;
  if (VAGUE_COMMENT_PATTERNS.some((re) => re.test(c))) return true;
  // Keysmash heuristic: ≥ 6 chars, no word with a vowel + ≥ 3 letters
  // (real words almost always have one).  Catches "fb tegr", "qefffff",
  // "wggggg", "asdfgh".  Bypassed for short content (so a clipped
  // "fine" or "ok" isn't flagged).
  if (c.length >= 6) {
    const words = c.split(/\s+/);
    const realLike = words.filter(
      (w) => /^[a-z]{3,}$/i.test(w) && /[aeiouy]/i.test(w)
    );
    if (realLike.length === 0) return true;
  }
  return false;
}

// localStorage key namespace for in-progress practice feedback drafts.
// Keyed per (email, taskType) so a refresh mid-typing doesn't blow
// away what the user has written.  Cleared on submit or explicit skip.
const FB_DRAFT_NS = "cw_practice_fb_v1";
function fbDraftKey(email, taskType) {
  const e = String(email || "anon").toLowerCase().trim();
  const t = String(taskType || "unknown");
  return `${FB_DRAFT_NS}:${e}:${t}`;
}
function loadFbDraft(email, taskType) {
  try {
    const raw = localStorage.getItem(fbDraftKey(email, taskType));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return {
      fun: Number(obj.fun) || 0,
      clarity: Number(obj.clarity) || 0,
      comment: typeof obj.comment === "string" ? obj.comment : "",
    };
  } catch {
    return null;
  }
}
function saveFbDraft(email, taskType, draft) {
  try {
    localStorage.setItem(fbDraftKey(email, taskType), JSON.stringify(draft));
  } catch {}
}
function clearFbDraft(email, taskType) {
  try {
    localStorage.removeItem(fbDraftKey(email, taskType));
  } catch {}
}

function TaskFeedback({ taskType, taskTitle, onSubmit, onSkip, userEmail }) {
  // ─── BEHAVIOR FIX (May 2026 feedback report: 8 testers / 56 task types /
  //     0 ratings) ────────────────────────────────────────────────────────
  //
  // The prior design required tapping Fun → tapping Clarity → advancing to
  // a comment phase → clicking Submit. Four+ actions per task, and the
  // dismiss-X was always one click away. Testers grinded through dozens of
  // tasks without leaving a single rating.
  //
  // New design — single-tap auto-submit:
  //   1. ONE emoji row ("How was that?"). A single tap records the rating
  //      and submits 700ms later (just long enough for the tap to register
  //      visually). Both `fun` and `clarity` are stored equal to the tap;
  //      backend export already tolerates that and the data is what it is.
  //   2. Optional "+ Add a comment" reveal beneath the row — opt-in, not
  //      blocking. Only shows the textarea if the user expands it.
  //   3. Low-rating (1-2) jumps straight into the comment textarea WITH
  //      a placeholder explaining what we need to hear — this is the most
  //      valuable feedback so we surface the request inline rather than
  //      shipping the user away.
  //   4. Skip option is still available but visually demoted to a small
  //      ghosted link, well below the emoji row. The dismiss X is removed
  //      from the rate phase entirely — it returns only after a tap.
  //
  // Net result: tapping ANY emoji = guaranteed rating in the export.
  // The friction floor for leaving a rating is now ~1 second / 1 tap.

  // Hydrate from localStorage so an accidental refresh doesn't lose work.
  const draft = loadFbDraft(userEmail, taskType);
  const [rating, setRating] = useState(draft?.fun || 0);
  const [comment, setComment] = useState(draft?.comment || "");
  // Vague-comment follow-up: one-shot per dialog. See looksTooVague().
  const [vagueFollowupShown, setVagueFollowupShown] = useState(false);

  // Mirror rating into both legacy fields (fun + clarity) so existing
  // export reports continue to function. fun is the rating; clarity is
  // copied through.
  const fun = rating;
  const clarity = rating;

  // Persist every change so a refresh keeps everything typed so far.
  useEffect(() => {
    saveFbDraft(userEmail, taskType, { fun, clarity, comment });
  }, [fun, clarity, comment, userEmail, taskType]);

  const isLowRating = rating > 0 && rating <= 2;
  const trimmedComment = comment.trim();
  const commentMeetsMinimum = trimmedComment.length >= MIN_REQUIRED_FEEDBACK_CHARS;

  const doSubmit = () => {
    if (rating <= 0) return; // safety — never submit a 0 rating
    // Vague low-rating comment? Stop, prompt for specifics, let them edit.
    if (
      !vagueFollowupShown &&
      isLowRating &&
      commentMeetsMinimum &&
      looksTooVague(trimmedComment)
    ) {
      setVagueFollowupShown(true);
      return;
    }
    let bonus = 1;
    if (commentMeetsMinimum) bonus = isLowRating ? 5 : 4;
    clearFbDraft(userEmail, taskType);
    onSubmit({
      fun,
      clarity,
      confusing: isLowRating ? trimmedComment : "",
      suggestion: !isLowRating && trimmedComment ? trimmedComment : "",
      feedbackBonus: bonus,
    });
  };

  // No auto-submit. Tester report (May 2026): the prior 1.2s auto-submit
  // for high ratings stole the dialog away before users could type a
  // comment — exactly the data we need most. The comment box now stays
  // open until the user explicitly submits.

  // Skip — always available; clears the draft and dismisses the popup.
  const handleSkip = () => {
    clearFbDraft(userEmail, taskType);
    onSkip?.();
  };

  const EmojiRow = ({ label, items, selected, onSelect }) => (
    <div style={{ marginBottom: 10 }}>
      {label && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 6, textAlign: "center" }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
        {items.map((e) => (
          <button
            key={e.val}
            onClick={() => onSelect(e.val)}
            style={{
              width: 52, height: 52,
              borderRadius: 14,
              border: selected === e.val ? "2px solid #f59e0b" : "2px solid rgba(255,255,255,0.08)",
              background: selected === e.val ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
              fontSize: 26,
              cursor: "pointer",
              transition: "all 0.15s",
              transform: selected === e.val ? "scale(1.15)" : "scale(1)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 0,
            }}
          >
            <span>{e.face}</span>
            <span style={{ fontSize: 8, color: selected === e.val ? "#fbbf24" : "#64748b", fontWeight: 700, marginTop: -2 }}>
              {e.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  const hasRated = rating > 0;
  const submitDisabled = !hasRated || (isLowRating && !commentMeetsMinimum);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      zIndex: 10000, padding: "0 12px 24px",
      animation: "feedbackFadeIn 0.2s ease-out",
    }}>
      <div style={{
        position: "relative",
        width: "100%", maxWidth: 380,
        padding: "18px 18px 16px",
        borderRadius: 20,
        background: "rgba(30,41,59,0.97)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "#f8fafc",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
      }}>
        {/* Always-available close. We never auto-submit any more — the
            tester report ("user no longer has enough time to complete the
            rating, much less put in a comment") killed that. */}
        <button
          type="button"
          onClick={handleSkip}
          aria-label="Close feedback"
          title="Close — skip rating (no points)"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "#94a3b8",
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 1,
          }}
        >
          ×
        </button>

        <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 2 }}>
          How was that task?
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: "#64748b", marginBottom: 12 }}>
          {taskTitle || taskType}
        </div>

        {/* Single emoji row. Any tap = recorded rating. */}
        <EmojiRow label="" items={EMOJI_FUN} selected={rating} onSelect={setRating} />

        {/* Comment box is ALWAYS visible — restored after tester feedback
            that the prior opt-in flow + auto-submit stole the dialog
            before they could write what mattered. */}
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>
          {isLowRating ? (
            <span style={{ color: "#fbbf24" }}>
              What didn't land? <span style={{ color: "#94a3b8", fontWeight: 600 }}>(+5 pts — required)</span>
            </span>
          ) : (
            <span style={{ color: "#e2e8f0" }}>
              Comment <span style={{ color: "#94a3b8", fontWeight: 600 }}>(optional, +4 pts)</span>
            </span>
          )}
        </div>

        {vagueFollowupShown && (
          <div
            style={{
              marginBottom: 8,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.45)",
              color: "#fde68a",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontWeight: 800, color: "#fbbf24", marginBottom: 4 }}>
              One more thing — what specifically?
            </div>
            <div>
              Add a sentence with what you tried and what happened — e.g.{" "}
              <i>"tapped the colour tiles, nothing reacted"</i> or{" "}
              <i>"I couldn't tell whose turn it was"</i>.
            </div>
            <div style={{ marginTop: 4, opacity: 0.85, fontStyle: "italic" }}>
              (Submit again to send anyway.)
            </div>
          </div>
        )}

        <textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter submits; plain Enter inserts newline for
            // multi-sentence suggestions.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitDisabled) {
              e.preventDefault();
              doSubmit();
            }
          }}
          placeholder={isLowRating
            ? "What was confusing or boring? What would have helped?"
            : "What worked well? What would make it even better?"}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: isLowRating
              ? `1px solid ${commentMeetsMinimum ? "rgba(34,197,94,0.4)" : "rgba(245,158,11,0.45)"}`
              : "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.07)",
            color: "#f8fafc",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
            marginBottom: 6,
            resize: "vertical",
            minHeight: 64,
            fontFamily: "inherit",
          }}
        />
        {isLowRating && hasRated && (
          <div style={{ fontSize: 11, color: commentMeetsMinimum ? "#22c55e" : "#94a3b8", marginBottom: 8, textAlign: "right" }}>
            {commentMeetsMinimum
              ? "Thanks — that helps."
              : `${Math.max(0, MIN_REQUIRED_FEEDBACK_CHARS - trimmedComment.length)} more character${MIN_REQUIRED_FEEDBACK_CHARS - trimmedComment.length === 1 ? "" : "s"} to send`}
          </div>
        )}

        <button
          type="button"
          onClick={doSubmit}
          disabled={submitDisabled}
          style={{
            width: "100%",
            padding: 11,
            borderRadius: 10,
            border: "none",
            background: submitDisabled
              ? "rgba(100,116,139,0.5)"
              : (commentMeetsMinimum
                  ? "linear-gradient(135deg, #22c55e, #16a34a)"
                  : "linear-gradient(135deg, #3b82f6, #1d4ed8)"),
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            cursor: submitDisabled ? "not-allowed" : "pointer",
            opacity: submitDisabled ? 0.7 : 1,
            marginTop: 4,
          }}
        >
          {!hasRated
            ? "Pick an emoji to rate"
            : isLowRating && !commentMeetsMinimum
              ? "Add a few words to send"
              : commentMeetsMinimum
                ? (isLowRating ? "Send (+5)" : "Send (+4)")
                : "Send rating (+1)"}
        </button>

        {/* Skip — always present, demoted visually. */}
        <button
          type="button"
          onClick={handleSkip}
          style={{
            display: "block",
            margin: "10px auto 0",
            padding: "4px 10px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "#64748b",
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            textDecoration: "underline",
            opacity: 0.7,
          }}
        >
          Skip rating (no points)
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Points Pop Animation
// ----------------------------------------------------------------

function PointsPop({ points }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible || !points) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: 48,
        fontWeight: 900,
        color: "#f59e0b",
        textShadow: "0 2px 12px rgba(245,158,11,0.5)",
        animation: "pointsPop 1.2s ease-out forwards",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      +{points}
    </div>
  );
}

// ----------------------------------------------------------------
// Streak Banner
// ----------------------------------------------------------------

function StreakBanner({ streak }) {
  if (streak < 3) return null;
  const labels = { 3: "🔥 3-streak!", 5: "🔥🔥 5-streak!", 10: "🔥🔥🔥 ON FIRE!" };
  const label = labels[streak] || (streak >= 10 ? labels[10] : `🔥 ${streak}-streak!`);

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "6px 18px",
        borderRadius: 20,
        background: "linear-gradient(135deg, #f59e0b, #ef4444)",
        color: "#fff",
        fontWeight: 900,
        fontSize: 14,
        zIndex: 9999,
        boxShadow: "0 4px 16px rgba(245,158,11,0.4)",
        animation: "streakSlide 0.4s ease-out",
      }}
    >
      {label}
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Playing Tasks
// ----------------------------------------------------------------

function TreatToast({ onDismiss }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); if (onDismiss) onDismiss(); }, 6000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: 340,
        width: "90%",
        padding: "14px 18px",
        borderRadius: 16,
        background: "linear-gradient(135deg, #fef3c7, #fffbeb)",
        border: "2px solid #fbbf24",
        boxShadow: "0 8px 32px rgba(245,158,11,0.25)",
        zIndex: 10000,
        animation: "treatSlideUp 0.5s ease-out",
        cursor: "pointer",
      }}
      onClick={() => { setVisible(false); if (onDismiss) onDismiss(); }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Mascot category="treat" size={52} style={{ flexShrink: 0, filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.1))" }} />
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#92400e" }}>
            Nice work — you've earned a treat!
          </div>
          <div style={{ fontSize: 12, color: "#a16207", marginTop: 2 }}>
            Swing by our booth to pick one up.
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoPlayer({
  user,
  onFinish,
  source,
  target = null,
  bonus = 0,
  isConference = false,
}) {
  // Whether the player set a commitment (3/5/10 tasks) on entry.
  // When set, finishing the Nth completion triggers an auto-end with
  // the bonus.  Skipped tasks don't count toward the target.
  const hasCommitment = typeof target === "number" && target > 0;
  const bonusAwardedRef = useRef(false);

  // Per-type practice counts → prioritize least-practiced + recently-fixed.
  const [practiceCounts, setPracticeCounts] = useState(null);
  // Task types this player has "exhausted" (2 consecutive positive-only
  // ratings).  Null until the fetch resolves so we don't accidentally
  // freeze the order with an empty set and then re-freeze a second time.
  const [exhaustedTypes, setExhaustedTypes] = useState(null);
  // Task types this player has any history with (completed or rated).
  // Used by buildSmartTaskOrder to surface NEW types first so every
  // tester actually samples the catalog instead of cycling the same
  // handful (owner concern 2026-06-04).
  const [triedTypes, setTriedTypes] = useState(null);
  const orderFrozenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/conference/practice-stats`);
        const data = await resp.json();
        if (!cancelled) setPracticeCounts(data?.counts && typeof data.counts === "object" ? data.counts : {});
      } catch {
        if (!cancelled) setPracticeCounts({}); // fall back to random order
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Per-player exhausted-types + tried-types fetch.  Needs the player's
  // email, so it can only run after login.  If the fetch fails or there's
  // no lead yet (first session), both default to empty sets.
  useEffect(() => {
    if (!user?.email) {
      setExhaustedTypes(new Set());
      setTriedTypes(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          email: String(user.email).toLowerCase().trim(),
          conference: "general",
        });
        const resp = await fetch(`${API_BASE_URL}/api/conference/exhausted-types?${params.toString()}`);
        const data = await resp.json();
        const ex = Array.isArray(data?.exhaustedTypes) ? data.exhaustedTypes : [];
        const tried = Array.isArray(data?.triedTypes) ? data.triedTypes : [];
        if (!cancelled) {
          setExhaustedTypes(new Set(ex));
          setTriedTypes(new Set(tried));
        }
      } catch {
        if (!cancelled) {
          setExhaustedTypes(new Set());
          setTriedTypes(new Set());
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  // Build a smart task order: personally untried first, then recently-fixed,
  // then least-practiced.  Drop any types this player has exhausted (2x
  // consecutive positive-only ratings).  Freeze once all three signals
  // have loaded so the order never reshuffles mid-session.
  const taskOrder = useMemo(() => {
    if (orderFrozenRef.current) return orderFrozenRef.current;
    const exhausted = exhaustedTypes || new Set();
    const tried = triedTypes || new Set();
    const eligible = exhausted.size > 0
      ? DEMO_TASKS.filter((t) => !exhausted.has(t.taskType))
      : DEMO_TASKS;
    const order = buildSmartTaskOrder(eligible, practiceCounts || {}, tried);
    if (
      practiceCounts !== null &&
      exhaustedTypes !== null &&
      triedTypes !== null
    ) {
      orderFrozenRef.current = order;
    }
    return order;
  }, [practiceCounts, exhaustedTypes, triedTypes]);

  // ── Orphan-feedback recovery ───────────────────────────────────────
  // Drafts the user typed in TaskFeedback but never submitted (e.g.
  // they tapped "I'm done" mid-feedback or closed the browser) live in
  // localStorage keyed by FB_DRAFT_NS:<email>:<taskType>.  On session
  // start, scan for any non-empty drafts for THIS email, POST them to
  // /orphan-feedback so they make it into the lead's feedbackEntries
  // log, then clear the keys.  Runs once per mount.
  const [recoveredDrafts, setRecoveredDrafts] = useState(null);
  useEffect(() => {
    if (!user?.email) return;
    const meKey = String(user.email).toLowerCase().trim();
    const prefix = `${FB_DRAFT_NS}:${meKey}:`;
    let drafts;
    try {
      drafts = Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => {
          let v;
          try { v = JSON.parse(localStorage.getItem(k) || "null"); } catch { v = null; }
          if (!v || typeof v !== "object") return null;
          const trimmedComment = String(v.comment || "").trim();
          const fun = Number(v.fun) || 0;
          const clarity = Number(v.clarity) || 0;
          if (!trimmedComment && !fun && !clarity) return null;
          const taskType = k.slice(prefix.length);
          // Reuse the same low/high split as the live feedback flow:
          // low rating → "confusing"; otherwise → "suggestion".
          const isLow = (fun > 0 && fun <= 2) || (clarity > 0 && clarity <= 2);
          return {
            _key: k,
            taskType,
            fun, clarity,
            confusing: isLow ? trimmedComment : "",
            suggestion: !isLow ? trimmedComment : "",
          };
        })
        .filter(Boolean);
    } catch {
      return;
    }
    if (!drafts || drafts.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/conference/orphan-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: meKey,
            conference: "general",
            entries: drafts.map(({ _key, ...rest }) => rest), // strip local-only field
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (data?.ok && data.savedCount > 0) {
          drafts.forEach((d) => {
            try { localStorage.removeItem(d._key); } catch {}
          });
          setRecoveredDrafts(data.savedCount);
        }
      } catch (err) {
        console.warn("[demo] orphan-feedback recovery failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const [taskIdx, setTaskIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [completedTypes, setCompletedTypes] = useState(new Set());
  // null while the player is active or still in the grace window.
  // A number once the warning countdown is running.
  // (legacy remainingMs kept null — the old inactivity countdown UI was
  // removed in favour of the IDLE_PROMPT_MS "Done practicing?" modal.)
  const remainingMs = null;
  const [paused, setPaused] = useState(false);
  const [totalPoints, setTotalPoints] = useState(0);
  const [lastEarned, setLastEarned] = useState(null); // for pop animation
  const [streak, setStreak] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false); // feedback popup
  const feedbackDelayTimerRef = useRef(null); // for OVERLAY_TYPES delayed popup
  const [pendingEntry, setPendingEntry] = useState(null); // entry awaiting feedback
  const [showTreat, setShowTreat] = useState(false);
  const treatShownRef = useRef(false);
  const timerRef = useRef(null);
  const startedRef = useRef(Date.now());
  const lastActivityRef = useRef(Date.now());
  const taskAreaRef = useRef(null);
  const popKeyRef = useRef(0);
  const isClassroom = source === "classroom";

  // Append a synthetic commitment-bonus entry when the player hits
  // their committed target.  Single-shot via bonusAwardedRef so the
  // bonus can never be doubled even if multiple end-paths fire.
  const finishWithBonus = useCallback(
    (entries) => {
      let outEntries = entries;
      if (hasCommitment && !bonusAwardedRef.current && bonus > 0) {
        bonusAwardedRef.current = true;
        outEntries = [
          ...entries,
          {
            taskType: "commitment-bonus",
            title: `Commitment bonus (${target} tasks)`,
            answer: null,
            skipped: false,
            points: bonus,
            commitmentBonus: bonus,
            completedAt: new Date().toISOString(),
          },
        ];
        // Pop a celebratory indicator so the bonus award is visible on
        // screen before the results screen appears.
        popKeyRef.current += 1;
        setLastEarned({ pts: bonus, key: popKeyRef.current, label: "commitment" });
        setTotalPoints((p) => p + bonus);
      }
      onFinish(outEntries);
    },
    [hasCommitment, bonus, target, onFinish]
  );

  // Smart demo socket — simulates server responses for team task types
  const demoSocket = useMemo(() => {
    const listeners = {};

    return {
      connected: true,
      on: (event, fn) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
      },
      off: (event, fn) => {
        if (listeners[event]) {
          listeners[event] = fn
            ? listeners[event].filter((f) => f !== fn)
            : [];
        }
      },
      emit: (event, payload, ack) => {
        // Default acknowledgment
        if (typeof ack === "function") ack({ ok: true, demo: true });

        // Simulate AI Debate Judge verdict
        if (event === "ai-judge:request") {
          setTimeout(() => {
            const fns = listeners["ai-judge:verdict"] || [];
            fns.forEach((fn) =>
              fn({
                winner: "affirmative",
                scores: { affirmative: 82, negative: 74 },
                feedback:
                  "Both sides made compelling arguments! The affirmative team edges ahead with stronger evidence and clearer structure. Great debate!",
              })
            );
          }, 2500);
        }

        // Simulate Musical Chairs scan acknowledgment
        if (event === "musical-chairs-scan") {
          // The component auto-advances after emit — no listener needed
        }
      },
    };
  }, []
  );

  const task = taskOrder[taskIdx] || null;
  const total = taskOrder.length;
  const { pts: nextTaskPts, isNew: nextIsNew } = task
    ? getAdaptivePts(task.taskType, user.taskPoints, completedTypes)
    : { pts: 0, isNew: false };

  // Global activity listener — captures every pointer / key / touch /
  // scroll / wheel / input event document-wide and bumps the idle
  // clock.  Replaces the old "text-heavy task" extension hack: now
  // ANY activity counts, on every task type, so an active player is
  // never auto-skipped.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
      "input",
    ];
    events.forEach((e) =>
      document.addEventListener(e, bump, { passive: true, capture: true })
    );
    return () => {
      events.forEach((e) =>
        document.removeEventListener(e, bump, { capture: true })
      );
    };
  }, []);

  // Track whether the user is actively typing in any input/textarea
  // anywhere on the page.  Auto-advance has to pause while they're
  // mid-sentence — testers were repeatedly losing their typed skip
  // reasons and feedback comments to the 90-second auto-skip.
  const [typingActive, setTypingActive] = useState(false);
  useEffect(() => {
    const evaluate = () => {
      const ae = typeof document !== "undefined" ? document.activeElement : null;
      const tag = (ae?.tagName || "").toUpperCase();
      const typing =
        !!ae && (tag === "TEXTAREA" || tag === "INPUT" || ae.isContentEditable);
      setTypingActive(typing);
    };
    const onFocusIn = () => evaluate();
    // focusout fires before activeElement updates — defer one tick.
    const onFocusOut = () => setTimeout(evaluate, 50);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Effective pause = explicit pause || feedback popup || typing.
  // Memoised so the auto-advance effect only re-subscribes when this
  // boolean actually flips.
  const timerEffectivelyPaused = paused || showFeedback || typingActive;

  // Inactivity-driven session end.
  //
  // Practice / classroom mode:
  //   Idle ≥ IDLE_PROMPT_MS    → show the modal (player can choose to
  //                               keep going or finish the session).
  //   Idle ≥ IDLE_PROMPT_MS + IDLE_AUTO_END_MS  → auto-finish session.
  //
  // Conference mode (booth visitor):
  //   Idle ≥ CONFERENCE_IDLE_END_MS  → silently auto-finish.  No modal,
  //   no warning — the visitor probably walked off to another booth and
  //   we still want the report email to go out so we capture whatever
  //   they did do.
  //
  // ANY activity bumps lastActivityRef and (in practice) dismisses the
  // modal.  No task is ever silently skipped any more.
  const [showDoneModal, setShowDoneModal] = useState(false);
  // At the hard idle limit we no longer silently end — we surface a
  // "Need more time?" prompt and wait for the player, so a present-but-idle
  // student (e.g. mid-read on a long task) is never kicked out.
  const [needMoreTime, setNeedMoreTime] = useState(false);
  const [idleResumeKey, setIdleResumeKey] = useState(0);
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setShowDoneModal(false);

    if (timerEffectivelyPaused) {
      lastActivityRef.current = Date.now();
      return;
    }

    timerRef.current = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;

      if (isConference) {
        if (idleFor >= CONFERENCE_IDLE_END_MS) {
          clearInterval(timerRef.current);
          onFinish(results);
        }
        return;
      }

      if (idleFor >= IDLE_PROMPT_MS + IDLE_AUTO_END_MS) {
        // 15 minutes of nothing → don't silently end. Surface a "Need more
        // time?" prompt (works on ANY task) and pause the idle timer until the
        // player answers. They stay in the session unless they choose to end.
        clearInterval(timerRef.current);
        setShowDoneModal(false);
        setNeedMoreTime(true);
        return;
      }
      if (idleFor >= IDLE_PROMPT_MS) {
        setShowDoneModal((prev) => prev || true);
      } else {
        setShowDoneModal((prev) => (prev ? false : prev));
      }
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [taskIdx, timerEffectivelyPaused, results, onFinish, isConference, idleResumeKey]);

  // Modal handlers.  "Keep going" just bumps activity so the popup goes
  // away; "I'm done" finishes the session immediately.
  const handleStillPracticing = () => {
    lastActivityRef.current = Date.now();
    setShowDoneModal(false);
  };
  const handleEndPractice = () => {
    setShowDoneModal(false);
    onFinish(results);
  };

  // "Need more time?" prompt (shown at the hard idle limit instead of
  // auto-ending). "Keep practicing" resets the idle clock and re-arms the
  // timer; "I'm done" ends the session.
  const handleNeedMoreTime = () => {
    lastActivityRef.current = Date.now();
    setNeedMoreTime(false);
    setShowDoneModal(false);
    setIdleResumeKey((k) => k + 1); // re-arm the idle timer effect
  };
  const handleEndFromIdle = () => {
    setNeedMoreTime(false);
    onFinish(results);
  };

  // If the "Need more time?" prompt goes unanswered for 1 minute, the player
  // has truly left — silently end so the session + results finalize.
  useEffect(() => {
    if (!needMoreTime) return;
    const t = setTimeout(() => {
      setNeedMoreTime(false);
      onFinish(results);
    }, 60 * 1000);
    return () => clearTimeout(t);
  }, [needMoreTime, onFinish, results]);

  // Submit handler — earns adaptive points, then shows feedback popup
  const handleSubmit = useCallback(
    (answer) => {
      // ── Skip-dialog short-circuit ──────────────────────────────────────────
      // TaskRunner's skip dialog already required the user to type a reason
      // (see TaskRunner.jsx → handleSkipTask).  When that path fires we get
      // { skipped: true, skipReason, points: 0, ... } back as `answer`.
      // We must NOT show the end-of-task <TaskFeedback> popup again — testers
      // flagged that as redundant.  Record the entry, carry the reason
      // through as a "confusing" comment, and advance.
      if (answer && typeof answer === "object" && answer.skipped === true) {
        const reason = String(answer.skipReason || "").trim().slice(0, 300);
        const entry = {
          taskType: task?.taskType,
          title: task?.title,
          answer: null,
          skipped: true,
          points: 0,
          completedAt: new Date().toISOString(),
          // Reuse the same shape the backend export reader (demo.js
          // /feedback-export) already understands — a `confusing` string —
          // so these comments show up alongside other [CONFUSING] entries
          // without a second prompt.
          feedback: reason
            ? {
                confusing: reason,
                suggestion: "",
                source: "skip-dialog",
                fun: 0,
                clarity: 0,
                feedbackBonus: 0,
              }
            : null,
        };
        clearInterval(timerRef.current);
        setStreak(0);
        const newResults = [...results, entry];
        setResults(newResults);
        setPendingEntry(null);
        setShowFeedback(false);
        if (taskIdx < total - 1) {
          setTaskIdx((i) => i + 1);
        } else {
          onFinish(newResults);
        }
        return;
      }

      const { pts } = getAdaptivePts(task?.taskType, user.taskPoints, completedTypes);
      // Paper-draw bonus: DrawMimeTask emits paperBonus: <n> when the
      // player chose "Draw on paper" in the simple-mode method picker.
      // Stack it on top of the adaptive points so paper drawers earn
      // a small reward for keeping their hand on the page.  Capped to
      // prevent any odd inflation from a future generator passing a
      // huge value.
      const paperBonus =
        answer && typeof answer === "object" && Number(answer.paperBonus) > 0
          ? Math.min(20, Number(answer.paperBonus) | 0)
          : 0;
      const totalPts = pts + paperBonus;

      // ── Anti-grinding gate ──────────────────────────────────────────
      // Earlier behaviour awarded the task's adaptive points the moment
      // the student tapped Submit, then offered a small bonus for a
      // rating.  Conference visitors quickly figured out they could
      // grind 30 completions, dismiss every rating popup, and walk
      // away with a top-leaderboard score and ZERO usable feedback
      // (8 testers / 100+ completions / 0 ratings in the May 2026
      // export was the smoking gun).
      //
      // The new rule: a task's points are only committed once the
      // student actually completes the review.  We stash the pending
      // award on the entry, defer setTotalPoints / streak / points
      // pop, and let handleFeedback() commit (or drop) the award
      // based on whether the rating popup was completed or dismissed.
      const entry = {
        taskType: task?.taskType,
        title: task?.title,
        answer: typeof answer === "object" ? JSON.stringify(answer) : String(answer ?? ""),
        skipped: false,
        points: 0,                       // not yet awarded — gated on review
        pendingPoints: totalPts,         // committed by handleFeedback if reviewed
        ...(paperBonus > 0 ? { paperBonus } : {}),
        completedAt: new Date().toISOString(),
      };

      // Track this type as completed (independent of points — we still
      // want to know which task types the user tried, for diversity
      // logic and for completion counts in the export).
      setCompletedTypes((prev) => new Set([...prev, task?.taskType]));

      // Treat milestone: after 3rd completed task (conference mode only)
      const completedSoFar = results.filter((r) => !r.skipped).length + 1;
      if (completedSoFar === 3 && !isClassroom && !treatShownRef.current) {
        treatShownRef.current = true;
        setShowTreat(true);
      }

      // Pause timer; for task types that render an answer overlay or
      // post-submit review state, delay the feedback popup so the player
      // actually sees the overlay before the modal covers it. Otherwise
      // pop the feedback dialog immediately.
      clearInterval(timerRef.current);
      setPendingEntry(entry);
      // Task types that show an answer-reveal / review overlay on submit.
      // Keep this list in sync with the renderers' disabled/review-state
      // logic; new types with their own overlay should be added here.
      const FEEDBACK_OVERLAY_DELAY_MS = 2400;
      const OVERLAY_TYPES = new Set([
        "sort",
        "vennsort",
        "sequence",
        "mad-dash-sequence",
        "matching",
        "timeline",
        "multiple-choice",
        "true-false",
        "cloze",
        "short-answer",
        "trivia",
        "fake-out",
        "legends",
        "record-audio",
        "peer-editing",
      ]);
      if (OVERLAY_TYPES.has(task?.taskType)) {
        // Show the overlay first; then prompt for feedback.
        const timer = setTimeout(() => setShowFeedback(true), FEEDBACK_OVERLAY_DELAY_MS);
        // If the user moves to next task before delay (shouldn't be possible
        // since UI is locked, but defensive), clean up.
        feedbackDelayTimerRef.current = timer;
      } else {
        setShowFeedback(true);
      }
    },
    [task, taskIdx, total, results, onFinish, user.taskPoints, completedTypes]
  );

  // Handle feedback submission or skip
  const handleFeedback = useCallback(
    (feedback) => {
      // Pending task-points stashed by handleSubmit, awaiting review.
      const pendingPts = Number(pendingEntry?.pendingPoints) || 0;
      const fbBonus = feedback?.feedbackBonus || 0;

      // Strip the pendingPoints field from the persisted entry — it was
      // a transient hand-off, not data we want in the results log.
      const { pendingPoints: _drop, ...basePending } = pendingEntry || {};
      const entry = { ...basePending, feedback: feedback || null };

      if (feedback) {
        // Student completed the review → commit the task's adaptive
        // points AND any rating/comment bonus, advance the streak, and
        // pop the combined total.  This is the only path that adds to
        // the leaderboard total.
        const granted = pendingPts + fbBonus;
        entry.points = granted;
        if (granted > 0) {
          setTotalPoints((p) => p + granted);
          popKeyRef.current += 1;
          setLastEarned({ pts: granted, key: popKeyRef.current });
        }
        setStreak((s) => s + 1);
      } else {
        // Student dismissed the popup (X or 'Maybe later') → no points
        // for this task, no streak, no pop.  We still record the entry
        // so completion counts and task-type diversity are tracked.
        entry.points = 0;
        setStreak(0);
      }

      const newResults = [...results, entry];
      setResults(newResults);
      setShowFeedback(false);
      setPendingEntry(null);

      // ── PER-TASK INCREMENTAL FEEDBACK PERSISTENCE ─────────────────────
      // Previously, ratings + comments only POSTed to the backend when
      // the ResultsScreen mounted at session end. Testers who didn't
      // finish a session lost every rating they'd given.  Now we
      // fire-and-forget the single feedback entry to the existing
      // /orphan-feedback endpoint the moment the user hits Send.
      try {
        if (feedback && user?.email) {
          const hasContent =
            (feedback.fun && feedback.fun > 0) ||
            (feedback.clarity && feedback.clarity > 0) ||
            (feedback.confusing && String(feedback.confusing).trim()) ||
            (feedback.suggestion && String(feedback.suggestion).trim());
          if (hasContent) {
            fetch(`${API_BASE_URL}/api/conference/orphan-feedback`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: user.email,
                conference: "general",
                entries: [{
                  taskType: entry.taskType,
                  title: entry.title,
                  fun: Number(feedback.fun) || 0,
                  clarity: Number(feedback.clarity) || 0,
                  confusing: String(feedback.confusing || ""),
                  suggestion: String(feedback.suggestion || ""),
                }],
              }),
              keepalive: true, // survives a tab close mid-flight
            }).catch(() => { /* silent — results POST at session end is the backstop */ });
          }
        }
      } catch { /* never block the UX on telemetry */ }

      // ── Commitment auto-end ────────────────────────────────────────
      // If the player committed to N tasks on entry and just hit it,
      // award the bonus and end the session immediately.  Skips don't
      // count — only real completions get the player to the target.
      if (hasCommitment) {
        const completedCount = newResults.filter((r) => !r.skipped).length;
        if (completedCount >= target) {
          finishWithBonus(newResults);
          return;
        }
      }

      if (taskIdx < total - 1) {
        setTaskIdx((i) => i + 1);
      } else {
        onFinish(newResults);
      }
    },
    [pendingEntry, results, taskIdx, total, onFinish, hasCommitment, target, finishWithBonus, user?.email]
  );

  // Skip-reason dialog state (driven by the nav-bar "Skip →" button).
  // Without this, tapping Skip used to silently drop the task with no
  // feedback. Tester regression: 'it no longer prompts for why if skip
  // task!' — restored by gating goNext behind a reason capture.
  const [skipPromptOpen, setSkipPromptOpen] = useState(false);
  const [skipPromptText, setSkipPromptText] = useState("");

  const _commitSkip = useCallback(
    (reason) => {
      const trimmed = String(reason || "").trim().slice(0, 300);
      setResults((prev) => [
        ...prev,
        {
          taskType: task?.taskType,
          title: task?.title,
          answer: null,
          skipped: true,
          points: 0,
          completedAt: new Date().toISOString(),
          feedback: trimmed
            ? {
                confusing: trimmed,
                suggestion: "",
                source: "skip-nav",
                fun: 0,
                clarity: 0,
                feedbackBonus: 0,
              }
            : null,
        },
      ]);
      setStreak(0);
      if (taskIdx < total - 1) {
        setTaskIdx((i) => i + 1);
      } else {
        onFinish(results);
      }
    },
    [task, taskIdx, total, results, onFinish],
  );

  // Public goNext wrapper used by the nav-bar "Skip →" button.
  // Opens a tiny reason prompt; an empty reason still records the skip
  // (no friction wall) but a typed reason becomes a [CONFUSING] entry
  // in the feedback export, which is the most actionable data we have.
  const goNext = useCallback(() => {
    setSkipPromptText("");
    setSkipPromptOpen(true);
  }, []);

  const goPrev = useCallback(() => {
    if (taskIdx > 0) setTaskIdx((i) => i - 1);
  }, [taskIdx]);

  const handleDone = useCallback(() => {
    onFinish(results);
  }, [results, onFinish]);

  // Commitment-aware progress.  When a target is set, the bar tracks
  // completions toward target; otherwise it tracks position in the
  // task order as before.
  const completedCount = results.filter((r) => !r.skipped).length;
  const progressPct = hasCommitment
    ? Math.min(100, (completedCount / target) * 100)
    : ((taskIdx + 1) / total) * 100;
  // Width of the inactivity-warning bar (only shown when the warn
  // No more on-screen idle countdown bar — replaced by the modal.
  const timerPct = 100;
  const showInactivityWarning = false;

  // GRADUATION: every task type this player ever sees has now been
  // marked positive-only twice in a row.  Practice mode has nothing
  // fresh to show them — they've fully validated the catalog.
  const allTypesExhausted =
    exhaustedTypes !== null &&
    exhaustedTypes.size > 0 &&
    taskOrder.length === 0;

  if (allTypesExhausted) {
    return (
      <div style={styles.playerOuter}>
        <div
          style={{
            maxWidth: 560,
            margin: "60px auto",
            padding: "36px 28px",
            borderRadius: 22,
            background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
            boxShadow: "0 18px 50px rgba(217,119,6,0.25)",
            textAlign: "center",
          }}
          role="status"
        >
          <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>🎓</div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: "#7c2d12",
              marginBottom: 12,
              lineHeight: 1.2,
            }}
          >
            You have done all the practice you can.
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#92400e",
              marginBottom: 22,
            }}
          >
            Thank you!
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#78350f",
              marginBottom: 28,
              lineHeight: 1.5,
            }}
          >
            You've already given two positive reviews on every task type
            in the catalog. We're not going to keep showing you the same
            activities you've already signed off on.
          </div>
          <button
            onClick={() => onFinish(results)}
            style={{
              padding: "12px 28px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #d97706, #b45309)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 15,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 8px 22px rgba(180,83,9,0.35)",
            }}
          >
            Finish session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.playerOuter}>
      {/* Points pop */}
      {lastEarned && <PointsPop key={lastEarned.key} points={lastEarned.pts} />}

      {/* Streak banner */}
      <StreakBanner streak={streak} />

      {/* Catalog-coverage chip — "Validated X/N task types".  Shows
          testers their personal coverage so they're pulled toward
          experiencing every type at least once. Built from the
          exhaustedTypes set (= types this tester has signed off on at
          the current revision); the denominator is the size of the
          uniques set in DEMO_TASKS. */}
      {(() => {
        const validatedCount = (exhaustedTypes && exhaustedTypes.size) || 0;
        const totalTypes = new Set(DEMO_TASKS.map((t) => t.taskType)).size;
        if (totalTypes === 0) return null;
        const pct = Math.round((validatedCount / totalTypes) * 100);
        return (
          <div
            style={{
              position: "fixed",
              top: 60,
              right: 12,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.78)",
              color: "#fff",
              fontSize: "0.72rem",
              fontWeight: 800,
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              zIndex: 998,
              cursor: "default",
            }}
            title={`You've validated ${validatedCount} of ${totalTypes} task types (${pct}%). Each session prioritizes types you haven't tried yet, and any type we revise re-enters your queue.`}
          >
            <span aria-hidden="true">✅</span>
            <span>{validatedCount}/{totalTypes}</span>
          </div>
        );
      })()}

      {/* Treat toast — conference mode, after 3 completions */}
      {showTreat && <TreatToast onDismiss={() => setShowTreat(false)} />}

      {/* Orphan-draft recovery toast.  Auto-dismisses; reassures the
          user that the comments they typed last session weren't lost. */}
      {recoveredDrafts != null && (
        <div
          style={{
            position: "fixed",
            top: 110,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 18px",
            borderRadius: 14,
            background: "linear-gradient(135deg, #16a34a, #059669)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 13,
            zIndex: 9999,
            boxShadow: "0 6px 20px rgba(22,163,74,0.45)",
            animation: "streakSlide 0.4s ease-out",
            maxWidth: "min(92vw, 420px)",
            textAlign: "center",
          }}
          role="status"
        >
          ✅ Recovered {recoveredDrafts} feedback comment
          {recoveredDrafts === 1 ? "" : "s"} from your last session.
          <button
            onClick={() => setRecoveredDrafts(null)}
            style={{
              marginLeft: 10,
              background: "rgba(255,255,255,0.2)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "2px 10px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* "Done practicing?" idle prompt — fires after 10 min of
          inactivity.  Player can keep going (resets idle clock) or
          finish the whole session.  Replaces the silent auto-skip
          that testers complained about. */}
      {showDoneModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={handleStillPracticing}
          style={{
            position: "fixed", inset: 0, zIndex: 10001,
            background: "rgba(15,23,42,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 380,
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: "24px 22px",
              color: "#f1f5f9",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>
              Done practicing?
            </div>
            <div style={{ fontSize: 13, color: "rgba(226,232,240,0.7)", lineHeight: 1.5, marginBottom: 18 }}>
              You've been idle for about 10 minutes.
              <br />
              Tap <b>Keep going</b> to stay on this task, or <b>I'm done</b>{" "}
              to finish your practice session.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={handleStillPracticing}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#f1f5f9", fontWeight: 800, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={handleEndPractice}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                  color: "#fff", fontWeight: 900, fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(239,68,68,0.4)",
                }}
              >
                I'm done
              </button>
            </div>
            <div style={{ fontSize: 11, color: "rgba(148,163,184,0.6)", marginTop: 14 }}>
              Still idle in a few minutes? We'll just check you're still here — we won't end without asking.
            </div>
          </div>
        </div>
      )}

      {/* "Need more time?" — shown at the hard idle limit instead of silently
          ending. Stays up until the player answers, on ANY task. */}
      {needMoreTime && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 10002,
            background: "rgba(15,23,42,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%", maxWidth: 380,
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: "24px 22px",
              color: "#f1f5f9",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>
              Need more time?
            </div>
            <div style={{ fontSize: 13, color: "rgba(226,232,240,0.7)", lineHeight: 1.5, marginBottom: 18 }}>
              It's been quiet for a while. Still working on this task?
              <br />
              Tap <b>Keep practicing</b> to stay in, or <b>I'm done</b> to finish up.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={handleNeedMoreTime}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #22c55e, #16a34a)",
                  color: "#fff", fontWeight: 900, fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(34,197,94,0.4)",
                }}
              >
                Keep practicing
              </button>
              <button
                type="button"
                onClick={handleEndFromIdle}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#f1f5f9", fontWeight: 800, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                I'm done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task feedback popup */}
      {showFeedback && pendingEntry && (
        <TaskFeedback
          taskType={pendingEntry.taskType}
          taskTitle={pendingEntry.title}
          userEmail={user?.email}
          onSubmit={(fb) => handleFeedback(fb)}
          onSkip={() => handleFeedback(null)}
        />
      )}

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={{ fontWeight: 900, fontSize: 15 }}>
            {isClassroom ? "Practice Mode" : "Curriculate Demo"}
          </span>
          <span style={styles.badge}>
            {hasCommitment
              ? `${completedCount} / ${target}`
              : `${taskIdx + 1} / ${total}`}
          </span>
          {hasCommitment && bonus > 0 && (
            <span
              style={{
                padding: "3px 9px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 800,
                background: "rgba(245,158,11,0.18)",
                color: "#fbbf24",
                border: "1px solid rgba(245,158,11,0.3)",
                whiteSpace: "nowrap",
              }}
              title={`Hit ${target} tasks to earn the +${bonus} commitment bonus`}
            >
              +{bonus} at finish
            </span>
          )}
        </div>
        <div style={styles.topBarRight}>
          {/* Points counter */}
          <div style={styles.pointsCounter}>
            <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>PTS</span>
            <span style={styles.pointsValue}>{totalPoints}</span>
          </div>

          {/* Only show the timer label when the inactivity warning
              is actually running.  Otherwise the player would see a
              countdown ticking down all the time even while they're
              actively working — confusing and unnecessary. */}
          {showInactivityWarning ? (
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: remainingMs < 10000 ? "#ef4444" : "#f59e0b",
              }}
              title="Move or tap to keep going"
            >
              Idle… {formatTime(remainingMs)}
            </span>
          ) : null}
          <button onClick={handleDone} style={styles.doneBtn}>
            I'm done
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={styles.progressOuter}>
        <div style={{ ...styles.progressInner, width: `${progressPct}%` }} />
      </div>

      {/* Inactivity warning bar — only rendered while the countdown
          is actually running.  Active players never see it. */}
      {showInactivityWarning ? (
        <div style={styles.timerOuter}>
          <div
            style={{
              height: "100%",
              width: `${timerPct}%`,
              background:
                remainingMs < 15000
                  ? "linear-gradient(90deg, #ef4444, #f97316)"
                  : "linear-gradient(90deg, #f59e0b, #ef4444)",
              borderRadius: 2,
              transition: "width 0.25s linear",
            }}
          />
        </div>
      ) : null}

      {/* Task type label + points preview */}
      <div style={styles.taskTypeLabel}>
        <span style={styles.taskTypeBadge}>{task?.taskType?.replace(/-/g, " ")}</span>
        <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{task?.title}</span>
        <span style={styles.ptsBadge}>
          {nextIsNew && <span style={styles.newBadge}>NEW</span>}
          +{nextTaskPts} pts
        </span>
      </div>

      {/* Task Runner */}
      <div ref={taskAreaRef} style={styles.taskArea}>
        <TaskRunner
          key={`demo-${taskIdx}`}
          task={task}
          taskIndex={taskIdx}
          taskTypes={taskOrder.map((t) => t.taskType)}
          onSubmit={handleSubmit}
          submitting={false}
          disabled={false}
          socket={demoSocket}
          mode="play"
          memberNames={[user.name]}
          roomCode="DEMO"
          playerTeam={user.name}
          /* practiceMode = "single-player solo demo": pads teams with
             bot teammates, falls back to screen-based art views, etc.
             True for BOTH practice AND conference — the conference
             attendee is alone at a booth too. */
          practiceMode={true}
          /* requireRealScans = "this is a real conference booth with
             physical QR codes set up".  Hides the tap-to-scan
             simulator panels in Musical Chairs / Mad Dash and the
             click-color fallback in Physical Multiple Choice, so the
             attendee actually has to scan.  Practice mode keeps the
             simulators on. */
          requireRealScans={isConference}
        />
      </div>

      {/* Skip-reason dialog — shows when the user taps the nav-bar
          "Skip →" button. Reason is optional but heavily encouraged: an
          empty submission still advances, a typed reason ships to the
          feedback export as a [CONFUSING] entry. */}
      {skipPromptOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(2,6,23,0.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSkipPromptOpen(false);
              setSkipPromptText("");
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#0f172a",
              color: "#f8fafc",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 18,
              boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>
              Skip this task?
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, lineHeight: 1.45 }}>
              A quick reason helps us fix what wasn't working. (Leave blank to skip silently.)
            </div>
            <textarea
              autoFocus
              rows={3}
              value={skipPromptText}
              onChange={(e) => setSkipPromptText(e.target.value)}
              placeholder="e.g. 'mic permission popup never appeared', 'instructions unclear', 'too hard for this group'…"
              maxLength={300}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.07)",
                color: "#f8fafc",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                resize: "vertical",
                minHeight: 64,
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setSkipPromptOpen(false);
                  setSkipPromptText("");
                }}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "#cbd5e1",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const reason = skipPromptText;
                  setSkipPromptOpen(false);
                  setSkipPromptText("");
                  _commitSkip(reason);
                }}
                style={{
                  flex: 2,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: skipPromptText.trim()
                    ? "linear-gradient(135deg, #22c55e, #16a34a)"
                    : "linear-gradient(135deg, #475569, #334155)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {skipPromptText.trim() ? "Skip + send feedback" : "Skip silently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div style={styles.navBar}>
        <button onClick={goPrev} disabled={taskIdx === 0} style={{ ...styles.navBtn, opacity: taskIdx === 0 ? 0.3 : 1 }}>
          ← Previous
        </button>
        <button onClick={goNext} style={styles.navBtn}>
          {taskIdx < total - 1 ? "Skip →" : "Finish →"}
        </button>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes pointsPop {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
          40%  { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -120%) scale(1); }
        }
        @keyframes streakSlide {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes feedbackFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes treatSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(40px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes ambassadorFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Results & Signup CTA
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Keener Detection
// ----------------------------------------------------------------

function isKeener(results) {
  const completed = results.filter((r) => !r.skipped);
  if (completed.length < 8) return false; // need decent engagement

  const withFeedback = completed.filter((r) => r.feedback && (r.feedback.fun > 0 || r.feedback.clarity > 0));
  if (withFeedback.length === 0) return false;

  const avgFun = withFeedback.reduce((s, r) => s + (r.feedback.fun || 0), 0) / withFeedback.length;
  const wroteComments = completed.some(
    (r) => r.feedback && (r.feedback.confusing || r.feedback.suggestion)
  );

  // High completion + enjoying it + left feedback = keener
  return avgFun >= 3.5 || (completed.length >= 12) || (completed.length >= 8 && wroteComments);
}

// ----------------------------------------------------------------
// Ambassador Popup
// ----------------------------------------------------------------

function AmbassadorPopup({ user, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const referralCode = `REF-${user.name.replace(/\s+/g, "").slice(0, 6).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const referralLink = `https://curriculate.net/pricing?ref=${encodeURIComponent(referralCode)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 20,
        animation: "ambassadorFadeIn 0.3s ease-out",
      }}
      onClick={onDismiss}
    >
      <div
        style={{
          maxWidth: 380,
          width: "100%",
          background: "#fff",
          borderRadius: 20,
          padding: 28,
          textAlign: "center",
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Mascot category="ambassador" size={100} style={{ marginBottom: 4, filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.12))" }} />
        <h2 style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
          You're a natural, {user.name.split(" ")[0]}
        </h2>
        <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5, marginBottom: 20 }}>
          You clearly see what this could do in a classroom.
          Want to help spread the word? Share your personal link
          — anyone who signs up through it gets an extra month free,
          and you'll get credit toward yours too.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          <input
            type="text"
            readOnly
            value={referralLink}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              fontSize: 12,
              color: "#334155",
              outline: "none",
              fontFamily: "monospace",
            }}
          />
          <button
            onClick={handleCopy}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: copied ? "#10b981" : "#3b82f6",
              color: "#fff",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <button
          onClick={onDismiss}
          style={{
            padding: "10px 24px",
            borderRadius: 10,
            border: "none",
            background: "#f1f5f9",
            color: "#64748b",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Recommend a Teacher — earn bonus points
// ----------------------------------------------------------------

const RECOMMEND_POINTS = 25;

// ----------------------------------------------------------------
// End-of-session "overall impression" star ratings
// ----------------------------------------------------------------

// A single 1-5 star row. value 0 = unrated.
function StarRow({ value, onChange, disabled }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", gap: 4 }} role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            onMouseEnter={() => !disabled && setHover(n)}
            onMouseLeave={() => !disabled && setHover(0)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-checked={value === n}
            role="radio"
            style={{
              background: "transparent",
              border: "none",
              cursor: disabled ? "default" : "pointer",
              fontSize: 30,
              lineHeight: 1,
              padding: "0 2px",
              color: active ? "#f59e0b" : "#d1d5db",
              filter: active ? "drop-shadow(0 1px 2px rgba(245,158,11,0.4))" : "none",
              transition: "color 0.12s, transform 0.12s",
              transform: (hover || value) === n ? "scale(1.15)" : "scale(1)",
            }}
          >
            {active ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

function SessionRating({ user, source = "practice" }) {
  const [overall, setOverall] = useState(0);
  const [wantTeacherUse, setWantTeacherUse] = useState(0);
  const [recommend, setRecommend] = useState(0);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  const anyRated = overall > 0 || wantTeacherUse > 0 || recommend > 0;

  const conference =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("event") || "general"
      : "general";

  const handleSubmit = async () => {
    if (!anyRated || status === "sending") return;
    setStatus("sending");
    try {
      const resp = await fetch(`${API_BASE_URL}/api/conference/session-rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          conference,
          overall,
          wantTeacherUse,
          recommend,
          comment: comment.trim(),
          source,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      setStatus(data?.ok ? "sent" : "error");
    } catch (err) {
      console.warn("[session-rating] failed:", err);
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div style={{
        width: "100%", padding: 20, borderRadius: 16,
        background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
        border: "2px solid #6ee7b7", textAlign: "center", marginBottom: 20,
      }}>
        <div style={{ fontSize: 30, marginBottom: 4 }}>💚</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: "#047857" }}>
          Thank you for the feedback!
        </div>
        <div style={{ fontSize: 13, color: "#059669", marginTop: 2 }}>
          It helps us make Curriculate better for your class.
        </div>
      </div>
    );
  }

  const rows = [
    { key: "overall", label: "Overall impression of Curriculate", value: overall, set: setOverall },
    { key: "teacher", label: "I'd like my teacher to use this in class", value: wantTeacherUse, set: setWantTeacherUse },
    { key: "recommend", label: "I'd likely recommend Curriculate", value: recommend, set: setRecommend },
  ];

  return (
    <div style={{
      width: "100%", padding: 20, borderRadius: 16,
      background: "linear-gradient(135deg, #fffbeb, #fef9c3)",
      border: "2px solid #fde68a", marginBottom: 20,
    }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "#92400e", marginBottom: 2, textAlign: "center" }}>
        How did we do?
      </div>
      <div style={{ fontSize: 12, color: "#a16207", marginBottom: 14, textAlign: "center" }}>
        Tap the stars — your honest rating helps us improve.
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10, padding: "8px 0", borderTop: "1px solid rgba(146,64,14,0.12)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#78350f", flex: 1, lineHeight: 1.3 }}>
            {r.label}
          </div>
          <StarRow value={r.value} onChange={r.set} disabled={status === "sending"} />
        </div>
      ))}

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={status === "sending"}
        rows={2}
        placeholder="Anything else you'd like to tell us? (optional)"
        style={{
          width: "100%", marginTop: 12, padding: "10px 12px", borderRadius: 10,
          border: "1px solid #fcd34d", background: "rgba(255,255,255,0.85)",
          color: "#1e293b", fontSize: 13, fontFamily: "inherit", resize: "vertical",
          boxSizing: "border-box",
        }}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!anyRated || status === "sending"}
        style={{
          width: "100%", marginTop: 12, padding: "12px 16px", borderRadius: 12, border: "none",
          background: anyRated ? "linear-gradient(135deg, #f59e0b, #d97706)" : "#e5e7eb",
          color: anyRated ? "#fff" : "#9ca3af",
          fontWeight: 900, fontSize: 15,
          cursor: anyRated && status !== "sending" ? "pointer" : "default",
        }}
      >
        {status === "sending" ? "Sending…" : "Submit Rating"}
      </button>
      {status === "error" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", textAlign: "center", fontWeight: 700 }}>
          Couldn't save — please try again.
        </div>
      )}
    </div>
  );
}

function RecommendTeacher({ user, onPointsEarned }) {
  const [expanded, setExpanded] = useState(false);
  const [teacherName, setTeacherName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | sending | sent | duplicate | error
  const [earnedPoints, setEarnedPoints] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!teacherEmail.trim() || !isValidEmail(teacherEmail)) return;

    setStatus("sending");
    try {
      const resp = await fetch(`${API_BASE_URL}/api/conference/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherName: teacherName.trim(),
          teacherEmail: teacherEmail.trim().toLowerCase(),
          studentName: user.name,
          studentEmail: user.email,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStatus("sent");
        setEarnedPoints(data.points || RECOMMEND_POINTS);
        onPointsEarned?.(data.points || RECOMMEND_POINTS);
      } else if (data.alreadyRecommended) {
        setStatus("duplicate");
      } else {
        setStatus("error");
      }
    } catch (err) {
      console.warn("[recommend] failed:", err);
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div style={{
        width: "100%",
        padding: 20,
        borderRadius: 16,
        background: "linear-gradient(135deg, #f5f3ff, #ede9fe)",
        border: "2px solid #c4b5fd",
        textAlign: "center",
        marginBottom: 20,
      }}>
        <Mascot category="recommend" size={80} style={{ marginBottom: 4, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.1))" }} />
        <div style={{ fontSize: 16, fontWeight: 900, color: "#6d28d9", marginBottom: 4 }}>
          Recommendation Sent!
        </div>
        <div style={{ fontSize: 14, color: "#7c3aed" }}>
          {teacherName || teacherEmail} will get an email from Curriculate with your name as the recommender.
        </div>
        <div style={{
          marginTop: 12,
          padding: "6px 14px",
          borderRadius: 8,
          background: "#fef3c7",
          border: "1px solid #fde68a",
          display: "inline-block",
          fontSize: 14,
          fontWeight: 800,
          color: "#f59e0b",
        }}>
          +{earnedPoints} pts earned!
        </div>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: 14,
          border: "2px dashed #c4b5fd",
          background: "linear-gradient(135deg, #faf5ff, #f5f3ff)",
          cursor: "pointer",
          textAlign: "center",
          marginBottom: 20,
          transition: "all 0.2s",
        }}
      >
        <Mascot category="recommend" size={44} style={{ marginRight: 4, verticalAlign: "middle", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: "#6d28d9" }}>
          Recommend a Teacher — Earn {RECOMMEND_POINTS} pts!
        </span>
        <div style={{ fontSize: 12, color: "#7c3aed", marginTop: 4 }}>
          Know a teacher who'd love Curriculate? Send them a recommendation!
        </div>
      </button>
    );
  }

  return (
    <div style={{
      width: "100%",
      padding: 20,
      borderRadius: 16,
      background: "linear-gradient(135deg, #faf5ff, #f5f3ff)",
      border: "2px solid #c4b5fd",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <Mascot category="recommend" size={64} style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.1))" }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, color: "#6d28d9", marginBottom: 4, textAlign: "center" }}>
        Recommend a Teacher
      </div>
      <div style={{ fontSize: 12, color: "#7c3aed", marginBottom: 16, textAlign: "center" }}>
        They'll get an email from Curriculate with your name. Earn {RECOMMEND_POINTS} bonus points!
      </div>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#4c1d95", marginBottom: 4 }}>
          Teacher's name <span style={{ fontWeight: 400, color: "#8b5cf6" }}>(optional)</span>
        </label>
        <input
          type="text"
          value={teacherName}
          onChange={(e) => setTeacherName(e.target.value)}
          placeholder="e.g. Ms. Johnson"
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd6fe",
            fontSize: 15,
            marginBottom: 12,
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#4c1d95", marginBottom: 4 }}>
          Teacher's email <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          type="email"
          value={teacherEmail}
          onChange={(e) => setTeacherEmail(e.target.value)}
          placeholder="teacher@school.edu"
          required
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd6fe",
            fontSize: 15,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />

        {status === "duplicate" && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            fontSize: 13,
            color: "#92400e",
            marginBottom: 12,
            textAlign: "center",
          }}>
            This teacher has already been recommended! Try a different teacher.
          </div>
        )}

        {status === "error" && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            fontSize: 13,
            color: "#991b1b",
            marginBottom: 12,
            textAlign: "center",
          }}>
            Something went wrong. Please try again.
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="submit"
            disabled={status === "sending" || !teacherEmail.trim()}
            style={{
              flex: 1,
              padding: "12px 20px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              cursor: status === "sending" ? "wait" : "pointer",
              opacity: status === "sending" || !teacherEmail.trim() ? 0.6 : 1,
            }}
          >
            {status === "sending" ? "Sending…" : `Send Recommendation (+${RECOMMEND_POINTS} pts)`}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#64748b",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ----------------------------------------------------------------
// Recommend Practice to a Friend — paste a message + share, earn pts
// ----------------------------------------------------------------

const PRACTICE_SHARE_POINTS = 10;
const PRACTICE_SHARE_DAILY_CAP = 3;

function buildPracticeInvite(name) {
  const me = (name || "").split(/\s+/)[0] || "I";
  return (
    `Hey! ${me} just tried Curriculate Practice — it's a quick, ` +
    `actually-fun way to stretch your brain between classes. ` +
    `60+ mini-tasks, free to try.\n\n` +
    `Heads up: they're in their testing phase right now and want ` +
    `real user feedback, so the top weekly performers get prizes ` +
    `(I think there's a Tim's card up for grabs). Worth a try:\n\n` +
    `https://curriculate.net/practice`
  );
}

function RecommendPractice({ user, onPointsEarned }) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState(() => buildPracticeInvite(user?.name));
  const [status, setStatus] = useState("idle"); // idle | sending | sent | capped | error
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState(null);
  const recordedRef = useRef(false);

  const recordShare = useCallback(
    async (channel) => {
      // Single-shot per session — first share earns the bonus, the
      // rest just trigger the OS share / clipboard.  Daily cap is
      // enforced server-side too.
      if (recordedRef.current) return;
      recordedRef.current = true;
      setStatus("sending");
      try {
        const resp = await fetch(
          `${API_BASE_URL}/api/conference/recommend-practice`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studentName: user.name,
              studentEmail: user.email,
              channel,
              recipientHint: "",
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (data?.ok) {
          setStatus("sent");
          setEarnedPoints(data.points || PRACTICE_SHARE_POINTS);
          setDailyRemaining(
            typeof data.dailyRemaining === "number" ? data.dailyRemaining : null
          );
          onPointsEarned?.(data.points || PRACTICE_SHARE_POINTS);
        } else if (data?.capped) {
          setStatus("capped");
          recordedRef.current = false; // allow retry tomorrow if they reload
        } else {
          setStatus("error");
          recordedRef.current = false;
        }
      } catch (err) {
        console.warn("[recommend-practice] failed:", err);
        setStatus("error");
        recordedRef.current = false;
      }
    },
    [user, onPointsEarned]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback: select + copy
      try {
        const ta = document.createElement("textarea");
        ta.value = message;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
    recordShare("copy");
  }, [message, recordShare]);

  const handleNativeShare = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.share) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: "Try Curriculate Practice",
        text: message,
        url: "https://curriculate.net/practice",
      });
      recordShare("share");
    } catch (err) {
      // User cancelled — silent.
    }
  }, [message, handleCopy, recordShare]);

  const handleSms = useCallback(() => {
    const body = encodeURIComponent(message);
    // iOS uses ?, Android both work — `?` is the safer cross-platform.
    window.location.href = `sms:?&body=${body}`;
    recordShare("sms");
  }, [message, recordShare]);

  const handleEmail = useCallback(() => {
    const subject = encodeURIComponent("Try this — Curriculate Practice");
    const body = encodeURIComponent(message);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    recordShare("email");
  }, [message, recordShare]);

  if (status === "sent") {
    return (
      <div
        style={{
          width: "100%",
          padding: 20,
          borderRadius: 16,
          background: "linear-gradient(135deg, #ecfeff, #cffafe)",
          border: "2px solid #67e8f9",
          textAlign: "center",
          marginBottom: 20,
        }}
      >
        <Mascot
          category="recommend"
          size={80}
          style={{ marginBottom: 4, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.1))" }}
        />
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0e7490", marginBottom: 4 }}>
          Invite shared!
        </div>
        <div style={{ fontSize: 13, color: "#0891b2" }}>
          Thanks for spreading the word.
          {dailyRemaining != null && dailyRemaining > 0 && (
            <> {dailyRemaining} more share{dailyRemaining === 1 ? "" : "s"} count for points today.</>
          )}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: "6px 14px",
            borderRadius: 8,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            display: "inline-block",
            fontSize: 14,
            fontWeight: 800,
            color: "#f59e0b",
          }}
        >
          +{earnedPoints} pts earned!
        </div>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: 14,
          border: "2px dashed #67e8f9",
          background: "linear-gradient(135deg, #ecfeff, #cffafe)",
          cursor: "pointer",
          textAlign: "center",
          marginBottom: 20,
          transition: "all 0.2s",
        }}
      >
        <Mascot
          category="recommend"
          size={44}
          style={{
            marginRight: 4,
            verticalAlign: "middle",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
          }}
        />
        <span style={{ fontSize: 15, fontWeight: 800, color: "#0e7490" }}>
          Recommend Practice to a Friend — Earn {PRACTICE_SHARE_POINTS} pts!
        </span>
        <div style={{ fontSize: 12, color: "#0891b2", marginTop: 4 }}>
          Paste a message and send it to a friend who'd love this!
        </div>
      </button>
    );
  }

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div
      style={{
        width: "100%",
        padding: 20,
        borderRadius: 16,
        background: "linear-gradient(135deg, #ecfeff, #cffafe)",
        border: "2px solid #67e8f9",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <Mascot
          category="recommend"
          size={64}
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.1))" }}
        />
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 900,
          color: "#0e7490",
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        Invite a Friend to Practice
      </div>
      <div style={{ fontSize: 12, color: "#0891b2", marginBottom: 12, textAlign: "center" }}>
        Edit the message, then send it however your friends chat. Earn{" "}
        {PRACTICE_SHARE_POINTS} bonus points (max {PRACTICE_SHARE_DAILY_CAP}/day).
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #a5f3fc",
          fontSize: 14,
          marginBottom: 12,
          boxSizing: "border-box",
          resize: "vertical",
          fontFamily: "inherit",
          lineHeight: 1.4,
          color: "#0c4a6e",
          background: "#fff",
        }}
      />

      {status === "capped" && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            fontSize: 13,
            color: "#92400e",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          You've hit today's share-bonus cap. Sharing still works — points reset tomorrow.
        </div>
      )}
      {status === "error" && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            fontSize: 13,
            color: "#991b1b",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          Couldn't record that — your share went through, but the bonus didn't stick. Try again?
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: canShare ? "1fr 1fr" : "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {canShare ? (
          <button
            type="button"
            onClick={handleNativeShare}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            📤 Share…
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSms}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #a5f3fc",
                background: "#fff",
                color: "#0e7490",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              💬 Text
            </button>
            <button
              type="button"
              onClick={handleEmail}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #a5f3fc",
                background: "#fff",
                color: "#0e7490",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              ✉️ Email
            </button>
          </>
        )}
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #a5f3fc",
            background: "#fff",
            color: "#0e7490",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {copied ? "✓ Copied!" : "📋 Copy"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(false)}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
          background: "transparent",
          color: "#64748b",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}

function DemoResults({
  user,
  results,
  source,
  promoCode = "CONFERENCE2025",
  commitment = null,
  onPlayAgain,
}) {
  // The synthetic "commitment-bonus" entry is a reward, NOT a task — exclude it
  // from task counts so committing to 10 shows 10 completed, not 11 (tester:
  // "I chose 10 and it gave me 11 … not technically correct").
  const isRealTask = (r) => r && !r.skipped && r.taskType !== "commitment-bonus";
  const hitCommitment =
    commitment &&
    typeof commitment.target === "number" &&
    results.filter(isRealTask).length >= commitment.target;
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showAmbassador, setShowAmbassador] = useState(false);
  const [recommendBonus, setRecommendBonus] = useState(0);
  // Lifetime totals from the backend response (POST /results returns
  // sessionPoints + cumulative totalPoints + sessionCount).  Tester
  // (Harnoor): "I did the 10 task, 50 pointer one three times, and I
  // thought when I redid, it'd add on to my previous 50, but it
  // reset" — the on-screen hero used to show session-only.  We now
  // surface lifetime alongside so replays clearly stack.
  const [lifetimeTotal, setLifetimeTotal] = useState(null);
  const [lifetimeSessionCount, setLifetimeSessionCount] = useState(null);
  const isClassroom = source === "classroom";
  // CTA + ambassador require BOTH source==="conference" AND an actual
  // conference event in the URL (?event=...).  Without that we treat
  // it as a stray default and skip the in-booth promo.  See email
  // side: backend/routes/demo.js — same gate.
  const conferenceEvent =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("event") || ""
      : "";
  const isConference = source === "conference" && !!conferenceEvent.trim();

  const completed = results.filter(isRealTask);
  const skipped = results.filter((r) => r.skipped);
  // basePoints intentionally includes the commitment-bonus entry's points.
  const basePoints = results.reduce((s, r) => s + (r.points || 0), 0);
  const totalPoints = basePoints + recommendBonus;

  // Per-task duration estimate for the conference report.  Each entry
  // has a completedAt; the previous entry's completedAt (or session
  // start) is the start.  We render seconds rounded.
  const timeline = useMemo(() => {
    if (!Array.isArray(results) || results.length === 0) return [];
    const out = [];
    let prevTs = null;
    for (const r of results) {
      const completedAt = r.completedAt ? new Date(r.completedAt) : null;
      let durationMs = null;
      if (completedAt && prevTs) {
        durationMs = Math.max(0, completedAt - prevTs);
      }
      out.push({ ...r, durationMs });
      if (completedAt) prevTs = completedAt;
    }
    return out;
  }, [results]);
  const sessionDurationMs =
    timeline.length > 0 && timeline[0]?.completedAt
      ? new Date(timeline[timeline.length - 1].completedAt) -
        new Date(timeline[0].completedAt)
      : 0;
  const fmtDur = (ms) => {
    if (!ms || ms < 1000) return "<1s";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };

  // Show ambassador popup after a brief delay for keeners (conference only)
  useEffect(() => {
    if (!isConference) return;
    if (!isKeener(results)) return;
    const t = setTimeout(() => setShowAmbassador(true), 2500);
    return () => clearTimeout(t);
  }, []);

  // Send results to backend for email
  useEffect(() => {
    if (sent || sending) return;
    setSending(true);
    fetch(`${API_BASE_URL}/api/conference/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        role: user.role,
        results,
        source,
        completedAt: new Date().toISOString(),
      }),
    })
      .then(async (r) => {
        try {
          const data = await r.json();
          if (data && typeof data.totalPoints === "number") {
            setLifetimeTotal(data.totalPoints);
          }
          if (data && typeof data.sessionCount === "number") {
            setLifetimeSessionCount(data.sessionCount);
          }
        } catch {}
        setSent(true);
      })
      .catch((err) => {
        console.warn("[demo] results submit failed:", err);
        setSent(true);
      })
      .finally(() => setSending(false));
  }, []);

  return (
    <div style={styles.resultsOuter}>
      <div style={styles.resultsCard}>
        <Mascot category="celebrate" size={140} style={{ marginBottom: -4, filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.12))" }} />
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>
          {isClassroom ? `Awesome, ${user.name}!` : `Great job, ${user.name}!`}
        </h1>

        {/* Points hero */}
        <div
          style={{
            width: "100%",
            padding: 20,
            borderRadius: 16,
            background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
            border: "2px solid #fde68a",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 14, color: "#92400e", fontWeight: 700, marginBottom: 4 }}>
            This Session
          </div>
          <div style={{ fontSize: 48, fontWeight: 900, color: "#f59e0b" }}>{totalPoints}</div>
          <div style={{ fontSize: 13, color: "#a16207" }}>
            {completed.length} task{completed.length !== 1 ? "s" : ""} completed out of {DEMO_TASKS.length}
          </div>
          <div style={{ fontSize: 12, color: "#a16207", marginTop: 2 }}>
            {new Set(completed.map((r) => r.taskType)).size} unique task types tried
          </div>

          {/* Lifetime stack — shows on the second render after the
              backend confirms totalPoints.  Tester (Harnoor) expected
              the on-screen total to keep climbing across replays; this
              row makes the cumulative total explicit. */}
          {typeof lifetimeTotal === "number" && lifetimeTotal > 0 && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px dashed rgba(146,64,14,0.25)",
              }}
            >
              <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, opacity: 0.85 }}>
                Lifetime
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#b45309" }}>
                {lifetimeTotal}
                <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6, opacity: 0.85 }}>
                  pts
                </span>
              </div>
              {typeof lifetimeSessionCount === "number" && lifetimeSessionCount > 1 && (
                <div style={{ fontSize: 11, color: "#a16207", marginTop: 2 }}>
                  across {lifetimeSessionCount} sessions — every replay adds to this.
                </div>
              )}
            </div>
          )}
          {hitCommitment && (
            <div
              style={{
                marginTop: 10,
                display: "inline-block",
                padding: "5px 12px",
                borderRadius: 999,
                background: "rgba(245,158,11,0.18)",
                color: "#92400e",
                fontWeight: 800,
                fontSize: 12,
                border: "1px solid rgba(245,158,11,0.4)",
              }}
            >
              ✨ Hit your {commitment.target}-task commitment · +{commitment.bonus} bonus
            </div>
          )}
        </div>

        {/* Conference: per-task report table.  Booth visitors get a
            real per-task breakdown (time, score, feedback) like a
            teacher's taskset report — not just badges.  Practice
            keeps the simpler badge row below. */}
        {isConference && timeline.length > 0 && (
          <div
            style={{
              width: "100%",
              marginBottom: 20,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                fontWeight: 800,
                fontSize: 13,
                color: "#0f172a",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>📋 Demo session report</span>
              <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>
                {fmtDur(sessionDurationMs)} at the booth
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#fff" }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Task</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Time</th>
                  <th style={{ padding: "6px 10px", textAlign: "right", color: "#64748b", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>Pts</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((r, i) => {
                  const isSkip = r.skipped;
                  const fb = r.feedback || null;
                  const fbBlob = fb
                    ? [fb.confusing, fb.suggestion].filter(Boolean).join(" · ")
                    : "";
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 10px", color: "#0f172a", fontWeight: 600 }}>
                        {isSkip ? "⏭️" : "✅"} {r.title || r.taskType}
                        {fbBlob && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              fontWeight: 400,
                              marginTop: 2,
                              fontStyle: "italic",
                              lineHeight: 1.3,
                            }}
                          >
                            "{fbBlob.length > 110 ? fbBlob.slice(0, 110) + "…" : fbBlob}"
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "8px 8px",
                          color: isSkip ? "#94a3b8" : "#16a34a",
                          fontWeight: 700,
                        }}
                      >
                        {isSkip ? "Skipped" : "Done"}
                      </td>
                      <td style={{ padding: "8px 8px", color: "#64748b", textAlign: "right" }}>
                        {r.durationMs ? fmtDur(r.durationMs) : "—"}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          color: r.points > 0 ? "#f59e0b" : "#cbd5e1",
                          fontWeight: 800,
                          textAlign: "right",
                        }}
                      >
                        {r.points > 0 ? `+${r.points}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Task badges (practice / classroom — conference uses the
            report table above instead). */}
        {!isConference && (
          <div style={{ width: "100%", marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Tasks you completed:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {completed.map((r, i) => (
                <span
                  key={i}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    background: "#dcfce7",
                    color: "#15803d",
                    border: "1px solid #bbf7d0",
                  }}
                >
                  ✓ {r.title} (+{r.points || 0})
                </span>
              ))}
            </div>
          </div>
        )}

        {skipped.length > 0 && !isConference && (
          <div style={{ width: "100%", marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, opacity: 0.6 }}>
              Skipped ({skipped.length}):
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {skipped.map((r, i) => (
                <span
                  key={i}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    background: "#f1f5f9",
                    color: "#94a3b8",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {r.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Overall impression — 1-5 star ratings for the whole session */}
        <SessionRating user={user} source={source} />

        {/* Recommend a Teacher */}
        <RecommendTeacher user={user} onPointsEarned={(pts) => setRecommendBonus((b) => b + pts)} />

        {/* Recommend Practice to a Friend */}
        <RecommendPractice user={user} onPointsEarned={(pts) => setRecommendBonus((b) => b + pts)} />

        {/* CTA section — conference-only.  Practice / classroom / unknown
            sources all skip this so the promo never bleeds outside the
            in-booth conference flow. */}
        {isConference && (
          <div
            style={{
              width: "100%",
              padding: 20,
              borderRadius: 16,
              background: "linear-gradient(135deg, #eff6ff, #f0f9ff)",
              border: "2px solid #93c5fd",
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            <Mascot category="promo" size={64} style={{ marginBottom: 4, filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.1))" }} />
            <div style={{ fontSize: 20, fontWeight: 900, color: "#1e40af", marginBottom: 4 }}>
              1 Month Free
            </div>
            <div style={{ fontSize: 14, color: "#3b82f6", marginBottom: 12 }}>
              Use code <strong style={{ fontSize: 18, letterSpacing: 2 }}>{promoCode}</strong> when you sign up
            </div>
            <a
              href="https://curriculate.net/pricing"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "12px 28px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                color: "#fff",
                fontWeight: 900,
                fontSize: 15,
                textDecoration: "none",
                boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
              }}
            >
              Sign Up Free →
            </a>
          </div>
        )}

        {/* Email confirmation */}
        <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
          {sent
            ? `✓ A report has been emailed to ${user.email}`
            : sending
            ? "Sending your report…"
            : ""}
        </p>

        {/* Play again — keeps the email + lifetime points, drops the
            user back at the commitment picker (or straight into a new
            session in conference mode). */}
        <button
          onClick={() => {
            if (typeof onPlayAgain === "function") onPlayAgain();
            else window.location.reload();
          }}
          style={{
            marginTop: 12,
            padding: "12px 28px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            fontWeight: 900,
            fontSize: 15,
            cursor: "pointer",
            color: "#fff",
            boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
          }}
        >
          Play Again →
        </button>
      </div>

      {/* Ambassador popup for keeners */}
      {showAmbassador && (
        <AmbassadorPopup user={user} onDismiss={() => setShowAmbassador(false)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Commitment Picker (practice mode)
// ----------------------------------------------------------------
//
// After email capture (and only in practice / non-conference flows),
// the player picks a commitment level: 3 / 5 / 10 tasks.  Hitting that
// target awards a bonus and ends the session — so practice has a
// natural stopping point instead of dragging on indefinitely.

const COMMITMENT_OPTIONS = [
  {
    target: 3,
    bonus: 10,
    label: "Quick taste",
    blurb: "3 tasks · finish them all and pocket a bonus",
  },
  {
    target: 5,
    bonus: 25,
    label: "Half session",
    blurb: "5 tasks · solid stretch, mid-tier bonus",
  },
  {
    target: 10,
    bonus: 50,
    label: "Full commit",
    blurb: "10 tasks · max bonus for the long-haulers",
  },
];

function CommitPicker({ user, onPick, isConference }) {
  // Conference attendees skip the commitment picker entirely — they get
  // the open-ended booth flow.  This guard exists as a fallback; the
  // parent only renders CommitPicker when !isConference.
  useEffect(() => {
    if (isConference) onPick(null);
  }, [isConference, onPick]);

  return (
    <div style={styles.captureOuter}>
      <div style={{ ...styles.captureCard, maxWidth: 480 }}>
        <Mascot
          category="practice-signin"
          size={120}
          style={{ marginBottom: 4, filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.15))" }}
        />
        <h1 style={{ ...styles.captureTitle, fontSize: 24 }}>
          Pick your commitment, {user.name.split(/\s+/)[0]}
        </h1>
        <p style={{ ...styles.captureSubtitle, marginBottom: 20 }}>
          Set a target and we'll celebrate you when you hit it. Bigger
          target = bigger bonus.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          {COMMITMENT_OPTIONS.map((opt) => (
            <button
              key={opt.target}
              onClick={() => onPick(opt)}
              style={{
                width: "100%",
                padding: "16px 18px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "#f8fafc",
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 14,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.borderColor = "rgba(245,158,11,0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 900,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {opt.target}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>
                  {opt.blurb}
                </div>
              </div>
              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 10,
                  background: "rgba(245,158,11,0.18)",
                  color: "#fbbf24",
                  border: "1px solid rgba(245,158,11,0.3)",
                  fontWeight: 900,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                +{opt.bonus}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => onPick(null)}
          style={{
            marginTop: 14,
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Skip — just let me roam
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Main DemoMode Component
// ----------------------------------------------------------------

export default function DemoMode({ source = "conference", classroom = "" }) {
  // capture → commit (practice only) → play → results
  const [phase, setPhase] = useState("capture");
  const [user, setUser] = useState(null);
  const [results, setResults] = useState([]);
  const [commitment, setCommitment] = useState(null); // { target, bonus } | null

  // Allow URL params to override source/classroom
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const effectiveSource = params.get("source") || source;
  const effectiveClassroom = params.get("classroom") || classroom;
  const effectivePromo = params.get("promo") || "CONFERENCE2025";
  const conferenceName = params.get("event") || "";
  const conferenceLocation = params.get("location") || "";
  const conferenceDate = params.get("date") || "";

  // Conference attendees keep the open-ended flow; commitment picker
  // is practice / classroom only.  Same gate logic as DemoResults.
  const isConference =
    effectiveSource === "conference" && !!conferenceName.trim();

  const handleStart = useCallback(
    (u) => {
      setUser(u);
      // Expose the practicer's identity so image-failure telemetry can attribute
      // failures to this session (lands in the feedback report). conference is
      // "general" to match how practice/classroom leads are stored.
      try {
        if (typeof window !== "undefined") {
          window.__CURRICULATE_PRACTICE__ = { email: u?.email || "", name: u?.name || "", source: effectiveSource, conference: "general" };
        }
      } catch { /* ignore */ }
      // Conference flow → straight to play, no commitment picker.
      // Practice / classroom → commit phase first.
      setPhase(isConference ? "play" : "commit");
    },
    [isConference, effectiveSource]
  );

  const handleCommit = useCallback((opt) => {
    // null = "skip — just let me roam"; treat as no commitment.
    setCommitment(opt || null);
    setPhase("play");
  }, []);

  const handleFinish = useCallback((r) => {
    setResults(r);
    setPhase("results");
  }, []);

  const handlePlayAgain = useCallback(() => {
    // Keep the user's email; clear results + commitment, return to
    // commit picker so they can set a new target (or skip).
    setResults([]);
    setCommitment(null);
    setPhase(isConference ? "play" : "commit");
  }, [isConference]);

  return (
    <div style={styles.root}>
      {phase === "capture" && (
        <EmailCapture
          onStart={handleStart}
          source={effectiveSource}
          classroom={effectiveClassroom}
          promoCode={effectivePromo}
          conferenceName={conferenceName}
          conferenceLocation={conferenceLocation}
          conferenceDate={conferenceDate}
        />
      )}
      {phase === "commit" && user && (
        <CommitPicker user={user} onPick={handleCommit} isConference={isConference} />
      )}
      {phase === "play" && user && (
        <DemoPlayer
          user={user}
          onFinish={handleFinish}
          source={effectiveSource}
          target={commitment?.target || null}
          bonus={commitment?.bonus || 0}
          isConference={isConference}
        />
      )}
      {phase === "results" && user && (
        <DemoResults
          user={user}
          results={results}
          source={effectiveSource}
          promoCode={effectivePromo}
          commitment={commitment}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------

const styles = {
  root: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#f8fafc",
  },

  // Email Capture
  captureOuter: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  captureCard: {
    width: "100%",
    maxWidth: 420,
    padding: 32,
    borderRadius: 24,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  captureTitle: {
    fontSize: 28,
    fontWeight: 900,
    marginBottom: 8,
    background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  captureSubtitle: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#94a3b8",
    marginBottom: 4,
    marginTop: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.07)",
    color: "#f8fafc",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    marginTop: 8,
    fontSize: 13,
    color: "#f87171",
    fontWeight: 600,
  },
  startBtn: {
    marginTop: 20,
    width: "100%",
    padding: "14px 24px",
    borderRadius: 14,
    border: "none",
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "#fff",
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(59,130,246,0.3)",
  },

  // Player
  playerOuter: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 16px",
    background: "rgba(0,0,0,0.3)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  badge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    background: "rgba(59,130,246,0.2)",
    color: "#93c5fd",
    border: "1px solid rgba(59,130,246,0.3)",
  },
  pointsCounter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 10,
    background: "rgba(245,158,11,0.15)",
    border: "1px solid rgba(245,158,11,0.3)",
  },
  pointsValue: {
    fontSize: 16,
    fontWeight: 900,
    color: "#fbbf24",
  },
  ptsBadge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    background: "rgba(245,158,11,0.15)",
    color: "#fbbf24",
    border: "1px solid rgba(245,158,11,0.25)",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  newBadge: {
    padding: "1px 5px",
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 900,
    background: "#22c55e",
    color: "#fff",
    letterSpacing: "0.5px",
    lineHeight: "14px",
  },
  doneBtn: {
    padding: "6px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "#f8fafc",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  progressOuter: {
    height: 4,
    background: "rgba(255,255,255,0.08)",
  },
  progressInner: {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  timerOuter: {
    height: 3,
    background: "rgba(255,255,255,0.05)",
  },
  taskTypeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
  },
  taskTypeBadge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(139,92,246,0.2)",
    color: "#c4b5fd",
    border: "1px solid rgba(139,92,246,0.3)",
    textTransform: "capitalize",
  },
  taskArea: {
    flex: 1,
    overflow: "auto",
    padding: "0 8px 8px",
  },
  navBar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 16px 20px",
    background: "rgba(0,0,0,0.2)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  navBtn: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#f8fafc",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    textAlign: "center",
  },

  // Results
  resultsOuter: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  resultsCard: {
    width: "100%",
    maxWidth: 480,
    padding: 32,
    borderRadius: 24,
    background: "#fff",
    color: "#0f172a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
};
