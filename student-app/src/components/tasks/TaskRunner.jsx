// student-app/src/components/tasks/TaskRunner.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { TASK_TYPES, TASK_TYPE_META } from "../../../../shared/taskTypes.js";
import SmoothCountdownBar from "../ui/SmoothCountdownBar.jsx";

import BodyBreakTask from "./types/BodyBreakTask";
import MakeAndSnapTask from "./types/MakeAndSnapTask";
import MultipleChoiceTask from "./types/MultipleChoiceTask";
import OpenTextTask from "./types/OpenTextTask";
import LetterTask from "./types/LetterTask";
import CaseStudyTask from "./types/CaseStudyTask";
import VocabularyTask from "./types/VocabularyTask";
import PhotoTask from "./types/PhotoTask";
import RecordAudioTask from "./types/RecordAudioTask";
import SequenceTask from "./types/SequenceTask";
import ShortAnswerTask from "./types/ShortAnswerTask";
import ReadingCompTask from "./types/ReadingCompTask";
import SortTask from "./types/SortTask";
import TrueFalseTask from "./types/TrueFalseTask";
import DrawMimeTask from "./types/DrawMimeTask";
import CollaborationTask from "./types/CollaborationTask";
import MusicalChairsTask from "./types/MusicalChairsTask";
import MysteryCluesTask from "./types/MysteryCluesTask";
import FakeOutTask from "./types/FakeOutTask";
import TrueFalseTicTacToeTask from "./types/TrueFalseTicTacToeTask";
import TrueFalseConnectFourTask from "./types/TrueFalseConnectFourTask";
import MadDashTask from "./types/MadDashTask";
import MadDashSequenceTask from "./types/MadDashSequenceTask";
import LiveDebateTask from "./types/LiveDebateTask";
import FlashcardsTask from "./types/FlashcardsTask";
import FlashcardsRaceTask from "./types/FlashcardsRaceTask";
import TimelineTask from "./types/TimelineTask";
import PetFeedingTask from "./types/PetFeedingTask";
import MotionMissionTask from "./types/MotionMissionTask";
import BrainstormBattleTask from "./types/BrainstormBattleTask";
import MindMapperTask from "./types/MindMapperTask";
import SpeedDrawTask from "./types/SpeedDrawTask";
import DiffDetectiveTask from "./types/DiffDetectiveTask";
import BrainSparkNotesTask from "./types/BrainSparkNotesTask";
import HideNSeekTask from "./types/HideNSeekTask";
import SpeechRecognitionTask from "./types/SpeechRecognitionTask";
import PronunciationTask from "./types/PronunciationTask";
import AIDebateJudgeTask from "./types/AIDebateJudgeTask";
import BrainBlitzTask from "./types/BrainBlitzTask";
import PhotoJournalTask from "./types/PhotoJournalTask";
import HangmanDuelTask from "./types/HangmanDuelTask";
import MatchingTask from "./types/MatchingTask";
import MapItTask from "./types/MapItTask";
import LabelMeTask from "./types/LabelMeTask";
import WordWeaverDuelTask from "./types/WordWeaverDuelTask";
import MoodCheckInTask from "./types/MoodCheckInTask"; // ✅ NEW
import TreasureRunnerTask from "./types/TreasureRunnerTask"; // ✅ NEW
import VennSortTask from "./types/VennSortTask";
import MultiPlayerFeedbackTask from "./types/MultiPlayerFeedbackTask";
import GuessWhoTask from "./types/GuessWhoTask"; // ✅ NEW (Guess Who)
import NarrationSynthesizeTask from "./types/NarrationSynthesizeTask";
import PhysicalMultipleChoiceTask from "./types/PhysicalMultipleChoiceTask";

import StorytellingTask from "./types/StorytellingTask";
import ScriptPlayTask from "./types/ScriptPlayTask";
import RolePlayDeckTask from "./types/RolePlayDeckTask";
import TowerBuilderTask from "./types/TowerBuilderTask";
import ArtViewTask from "./types/ArtViewTask";
import HistoricalDocTask from "./types/HistoricalDocTask";
import RiddleTask from "./types/RiddleTask";
import WhatAmITask from "./types/WhatAmITask";
import QuestTask from "./types/QuestTask";
import CurrentEventsTask from "./types/CurrentEventsTask";
import CareersTask from "./types/CareersTask";
import HoleInOneTask from "./types/HoleInOneTask";
import LegendsTask from "./types/LegendsTask";
import TruthOrDareTask from "./types/TruthOrDareTask";
import TriviaTask from "./types/TriviaTask";
import SpinnerTask from "./types/SpinnerTask";
import TeamSelfieTask from "./types/TeamSelfieTask";
import PeerEditingTask from "./types/PeerEditingTask";
import InterviewTask from "./types/InterviewTask";
import ClozeTask from "./types/ClozeTask";
import TeachBackTask from "./types/TeachBackTask";
import PaperModeCamera from "./PaperModeCamera.jsx";
import CoachPanel from "./CoachPanel.jsx";
import { getPlayerName } from "../../utils/playerName";


// Task types that SKIP coach mode (already have built-in turn mechanics, or non-academic)
const COACH_MODE_SKIP = new Set([
  "echo-chain",          // already turn-based
  "hangman-duel",        // already turn-based
  "fake-out",            // already has reader rotation
  "script-play",         // already has speaker roles
  "role-play-deck",      // already has speaker roles
  "draw-mime",           // physical/visual — whole team participates
  "body-break",          // physical — everyone moves
  "motion-mission",      // physical — everyone moves
  "team-selfie",         // everyone poses
  "mood-checkin",        // everyone rates
  "treasure-runner",     // scan task
  "record-audio",        // voice task
  "narration-synthesize",// voice task
  "speech-recognition",  // voice task
  "pronunciation",       // voice task
  "ai-debate-judge",     // voice/debate task
  "physical-multiple-choice", // movement task
  "mad-dash",            // movement task
  "mad-dash-sequence",   // movement task
  "musical-chairs",      // movement task
  "brain-blitz",             // has per-clue step rotation + everyone shouts
  "true-false-connect-four", // already has per-turn rotation
  "true-false-tictactoe",    // already has per-turn rotation
  "flashcards-race",     // competitive — everyone taps
  "brainstorm-battle",   // everyone contributes
  "collaboration",       // shared writing
  "multi-player-feedback", // everyone rates
  "diff-detective",      // competitive race
  "speed-draw",          // everyone draws
  "make-and-snap",       // everyone builds
  "photo",               // camera task
  "photo-journal",       // camera task
  "word-weaver-duel",    // turn-based duel
  "live-debate",         // debate — everyone speaks
  "trivia",              // everyone answers together
  "spinner",             // everyone watches the spin
  "interview",           // live AI conversation — individual
]);

// Task types eligible for paper mode (text-heavy tasks that can be done on paper)
const PAPER_MODE_ELIGIBLE = new Set([
  "short-answer",
  "open-text",
  "reading-comp",
]);

// Task-level error boundary: prevents a single task crash from blanking the entire screen
class TaskErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, err: error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    try {
      console.error('[TaskRunner] Task render error:', error, info);
    } catch (_) {}
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const title = this.props.title || 'Task crashed';
    const msg = String(this.state.err?.message || this.state.err || 'Unknown error');
    return (
      <div style={{ padding: 16, margin: 16, borderRadius: 14, border: '1px solid rgba(226,232,240,1)', background: '#fff' }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>{title}</div>
        <div style={{ color: '#334155', marginBottom: 12, lineHeight: 1.35 }}>
          The task UI hit an error, but the app stayed alive. Use the details below to pinpoint the fix.
        </div>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12, whiteSpace: 'pre-wrap', color: '#0f172a', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          {msg}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => this.setState({ hasError: false, err: null, info: null })}
            style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(226,232,240,1)', background: '#fff', fontWeight: 800, cursor: 'pointer' }}>
            Retry render
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(226,232,240,1)', background: '#fff', fontWeight: 800, cursor: 'pointer' }}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

// High-contrast neutrals for inner task cards / text
const CONTRAST_TEXT_DARK = "#0f172a";
const CONTRAST_BG_LIGHT = "#f9fafb";
const CONTRAST_BORDER = "#d1d5db";
const CONTRAST_ACCENT = "#0ea5e9";

function BrainSparkNotesInline({ task, onSubmit, disabled }) {
  const notes = task?.notes ?? task?.config?.notes ?? null;
  const heading = String(notes?.heading || notes?.title || task?.title || "Notes").trim();
  const keyTerms = Array.isArray(notes?.keyTerms) ? notes.keyTerms : Array.isArray(notes?.terms) ? notes.terms : [];
  const mainPoints = Array.isArray(notes?.mainPoints) ? notes.mainPoints : Array.isArray(notes?.sections) ? notes.sections : [];
  const summaryArr = Array.isArray(notes?.summary) ? notes.summary : (typeof notes?.summary === "string" && notes.summary.trim() ? [notes.summary] : []);

  // Helper: render a keyTerm item (object { term, definition, points } OR plain string)
  const renderKeyTerm = (kt, i) => {
    if (typeof kt === "string") return <li key={i} style={{ marginBottom: 8 }}>{kt}</li>;
    const term = String(kt?.term ?? kt?.word ?? kt?.name ?? "").trim();
    const def = String(kt?.definition ?? kt?.def ?? "").trim();
    const pts = Array.isArray(kt?.points) ? kt.points : Array.isArray(kt?.bullets) ? kt.bullets : Array.isArray(kt?.facts) ? kt.facts : [];
    return (
      <li key={i} style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 800, color: "#1e3a5f" }}>{term || `Term ${i + 1}`}</span>
        {def && <span style={{ color: "#334155" }}> — {def}</span>}
        {pts.length > 0 && (
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 16, listStyleType: "circle" }}>
            {pts.map((p, j) => (
              <li key={j} style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{typeof p === "string" ? p : JSON.stringify(p)}</li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  // Helper: render a mainPoint item (object { heading, bullets/sections } OR plain string)
  const renderMainPoint = (mp, i) => {
    if (typeof mp === "string") return <li key={i} style={{ marginBottom: 8 }}>{mp}</li>;
    const mpHeading = String(mp?.heading ?? mp?.title ?? "").trim();
    const bullets = Array.isArray(mp?.bullets) ? mp.bullets : Array.isArray(mp?.points) ? mp.points : [];
    const sections = Array.isArray(mp?.sections) ? mp.sections : [];
    return (
      <li key={i} style={{ marginBottom: 14 }}>
        <span style={{ fontWeight: 800, color: "#1e3a5f" }}>{mpHeading || `Point ${i + 1}`}</span>
        {bullets.length > 0 && (
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 16, listStyleType: "disc" }}>
            {bullets.map((b, j) => (
              <li key={j} style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{typeof b === "string" ? b : JSON.stringify(b)}</li>
            ))}
          </ul>
        )}
        {sections.length > 0 && sections.map((sec, si) => {
          const secTitle = String(sec?.title ?? sec?.heading ?? "").trim();
          const secBullets = Array.isArray(sec?.bullets) ? sec.bullets : Array.isArray(sec?.points) ? sec.points : [];
          return (
            <div key={si} style={{ marginTop: 6, marginLeft: 4 }}>
              {secTitle && <div style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>{secTitle}</div>}
              {secBullets.length > 0 && (
                <ul style={{ margin: "2px 0 0 0", paddingLeft: 16, listStyleType: "disc" }}>
                  {secBullets.map((b, j) => (
                    <li key={j} style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{typeof b === "string" ? b : JSON.stringify(b)}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </li>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16, padding: "0 2px" }}>
      {/* Title */}
      <div style={{
        fontSize: 20, fontWeight: 900, color: "#0f172a", lineHeight: 1.3,
        borderBottom: "3px solid #3b82f6", paddingBottom: 8,
      }}>
        📝 {heading}
      </div>

      {/* Instruction pill */}
      <div style={{
        background: "linear-gradient(135deg, #fef3c7, #fde68a)", borderRadius: 12,
        padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#92400e",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 18 }}>📖</span>
        Copy these notes into your notebook — neat and complete!
      </div>

      {/* Key Terms */}
      {keyTerms.length > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #eff6ff, #dbeafe)", borderRadius: 14,
          padding: "14px 16px", border: "1.5px solid #93c5fd",
        }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10, color: "#1e40af", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📚</span> Key Terms
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {keyTerms.map(renderKeyTerm)}
          </ul>
        </div>
      )}

      {/* Main Points */}
      {mainPoints.length > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderRadius: 14,
          padding: "14px 16px", border: "1.5px solid #86efac",
        }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10, color: "#166534", display: "flex", alignItems: "center", gap: 6 }}>
            <span>⭐</span> Main Points
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {mainPoints.map(renderMainPoint)}
          </ol>
        </div>
      )}

      {/* Summary */}
      {summaryArr.length > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #fdf2f8, #fce7f3)", borderRadius: 14,
          padding: "14px 16px", border: "1.5px solid #f9a8d4",
        }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8, color: "#9d174d", display: "flex", alignItems: "center", gap: 6 }}>
            <span>✨</span> Summary
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, listStyleType: "disc", lineHeight: 1.6 }}>
            {summaryArr.map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: "#831843", fontStyle: "italic" }}>
                {typeof s === "string" ? s : JSON.stringify(s)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Done button */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
        <button
          type="button"
          disabled={!!disabled}
          onClick={() => onSubmit?.({ ok: true })}
          style={{
            padding: "12px 20px", borderRadius: 999, border: "none",
            background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff",
            fontWeight: 800, fontSize: 15, cursor: disabled ? "not-allowed" : "pointer",
            boxShadow: "0 4px 12px rgba(37,99,235,0.3)",
          }}
        >
          ✅ Done
        </button>
        <div style={{ opacity: 0.6, fontSize: 13 }}>Tap when you've written everything down.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Category staging videos (8s play → collapse) - put files in:
// student-app/public/animations/categories/<filename>
// For each base file, you can also add a "-alt.mp4" variant and we'll pick randomly.
// ---------------------------------------------------------------------
const CATEGORY_ANIMATION_BASE_FILES = {
  question: "question.mp4",
  ordering: "ordering.mp4",
  creative: "creative.mp4",
  movement: "movement.mp4",
  competitive: "competitive.mp4",
  deduction: "deduction.mp4",
  collaboration: "collaboration.mp4",
  "feedback/meta": "feedback-meta.mp4",
  synthesis: "synthesis.mp4",
  recall: "recall.mp4",
  "role-play": "role-play.mp4",
  other: "other.mp4",
};

function stableRand01(seedStr) {
  // deterministic 0..1 for the same seedStr (fast hash)
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned → 0..1
  return ((h >>> 0) % 1000000) / 1000000;
}

// Build a task key that stays stable across frequent parent re-renders.
// Why: some UI elements (staging/victory videos) should not reset just because
// a progress bar, socket tick, or overlay timer updates state.
function buildStableTaskKey(taskObj, normalizedType) {
  if (!taskObj) return String(normalizedType || "task");

  // Prefer true IDs if present.
  const id = taskObj._id || taskObj.id || taskObj.taskId;
  if (id) return String(id);

  // Fall back to a deterministic fingerprint from common stable fields.
  const type = String(normalizedType || taskObj.taskType || taskObj.type || "task");
  const title = String(taskObj.title || taskObj.name || "").trim();
  const prompt = String(taskObj.prompt || taskObj.question || taskObj.text || "").trim();
  const itemsLen = Array.isArray(taskObj.items) ? taskObj.items.length : 0;
  const optionsLen = Array.isArray(taskObj.options) ? taskObj.options.length : 0;

  // Keep prompt short to avoid huge keys.
  const p = prompt.slice(0, 80);
  return `${type}:${title}:${p}:${itemsLen}:${optionsLen}`;
}


// Task types that should NOT show category staging video (legacy helper)
const CATEGORY_ANIMATION_SKIP_TYPES_LEGACY = new Set(
  [
    TASK_TYPES.MOOD_CHECKIN,
    TASK_TYPES.TREASURE_RUNNER,
    TASK_TYPES.MULTI_PLAYER_FEEDBACK,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
);

function pickCategoryVideoSrc(taskType, taskObj) {
  const tt = normalizeTaskType(taskType || taskObj?.taskType || taskObj?.type);

  if (CATEGORY_ANIMATION_SKIP_TYPES_LEGACY.has(tt)) return null;

  // Hard overrides for certain families (stable filenames in /animations/categories/)
  // Photo-family tasks should always use photo.mp4 (no random alt) to match Curriculate category assets.
  if (tt === "photo" || tt === "make-and-snap" || tt === "photo-journal") {
    return `/animations/categories/photo.mp4`;
  }
  // Musical Chairs category video
  if (tt === "musical-chairs") {
    return `/animations/categories/musical-chairs.mp4`;
  }

  // allow per-task override (exact filename in /animations/categories/)
  const ui = taskObj?.ui || taskObj?.config?.ui || null;
  const override = ui?.categoryVideo || ui?.categoryAnimation || ui?.categoryAnim || null;
  if (override && typeof override === "string") {
    return `/animations/categories/${override}`;
  }

  const meta = TASK_TYPE_META?.[tt] || null;
  const cat = meta?.category || "other";
  const base = CATEGORY_ANIMATION_BASE_FILES[cat] || CATEGORY_ANIMATION_BASE_FILES.other;
  const alt = base.replace(/\.mp4$/i, "-alt.mp4");

  // stable random per task instance (so it won't swap mid-render and cause a flash)
  const seed = `${taskObj?._id || taskObj?.id || taskObj?.taskId || ""}|${tt}|${cat}`;
  const useAlt = stableRand01(seed) >= 0.5;

  return `/animations/categories/${useAlt ? alt : base}`;
}

function seededShuffle(array, seedStr) {
  const copy = [...array];

  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }

  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed >>>= 0;
    seed ^= seed << 5;
    seed >>>= 0;
    return (seed >>> 0) / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Convert "quick_response" → "Quick Response"
function toTitleCase(str) {
  if (!str) return "";
  return str
    .replace(/[_-]+/g, " ")
    .replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
    );
}

function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;

  switch (raw) {
    // MC / TF / SHORT
    case "mc":
    case "multiple-choice":
      return TASK_TYPES.MULTIPLE_CHOICE;

    case "brain-spark-notes":
    case "brain_spark_notes":
    case "brainsparknotes":
    case "brain spark notes":
      return TASK_TYPES.BRAIN_SPARK_NOTES;

    case "mind-mapper":
    case "mind_mapper":
    case "mindmapper":
    case "mind map":
    case "mind-map":
      return TASK_TYPES.MIND_MAPPER;

    
    case "reading-comp":
    case "reading_comp":
    case "readingcomp":
    case "reading comprehension":
    case "reading-comprehension":
      return TASK_TYPES.READING_COMP;

    case "physical-multiple-choice":
    case "physical_multiple_choice":
    case "physical-mc":
    case "pmc":
      return TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;

    case "tf":
    case "true_false":
    case "true-false":
      return TASK_TYPES.TRUE_FALSE;

    case "short":
    case "short-answer":
      return TASK_TYPES.SHORT_ANSWER;

    case "open":
    case "open-text":
    case "open_text":
      return TASK_TYPES.OPEN_TEXT;

    // Sorting & Sequence
    case "sort":
      return TASK_TYPES.SORT;

    case "seq":
    case "sequence":
      return TASK_TYPES.SEQUENCE;

    // ✅ Matching (NEW)
    case "matching":
    case "match":
    case "match-up":
    case "match_up":
    case "matchup":
    case "pairs":
    case "key-terms-match":
    case "key_terms_match":
    case "key-terms":
    case "key_terms":
    case "keyterms":
    case "term-match":
    case "term_match":
    case "vocabulary-match":
    case "vocab-match":
      return TASK_TYPES.MATCHING;

    case "labelme":
    case "label-me":
    case "label_me":
    case "label":
    case "diagram-label":
    case "image-label":
    case "map-label":
      return TASK_TYPES.LABELME;

    // Timeline
    case "timeline":
      return TASK_TYPES.TIMELINE;

    // VennSort (2–3 circles)
    case "vennsort":
    case "venn-sort":
    case "venn_sort":
    case "venn":
    case "venn-diagram":
    case "venn_diagram":
    case "venndiagram":
      return TASK_TYPES.VENNSORT;

    
// Feedback / reflection
case "multi-player-feedback":
case "multi_player_feedback":
case "multiplayerfeedback":
case "feedback":
  return TASK_TYPES.MULTI_PLAYER_FEEDBACK;

// Photo / Media
    case "photo":
      return TASK_TYPES.PHOTO;

    case "make-and-snap":
    case "make_and_snap":
      return TASK_TYPES.MAKE_AND_SNAP;

    // Photo Journal
    case "photo-journal":
    case "photo_journal":
    case "photojournal":
      return TASK_TYPES.PHOTO_JOURNAL;

    // Art View (observation task)
    case "art-view":
    case "art_view":
    case "artview":
      return TASK_TYPES.ART_VIEW;

    // Historical Document (primary source analysis)
    case "historical-doc":
    case "historical_doc":
    case "historicaldoc":
      return TASK_TYPES.HISTORICAL_DOC;

    case "record-audio":
    case "record_audio":
      return TASK_TYPES.RECORD_AUDIO;

    // Speech recognition
    case "speech-recognition":
    case "speech_recognition":
      return TASK_TYPES.SPEECH_RECOGNITION;

    // Pronunciation (NEW)
    case "pronunciation":
    case "pronounce":
    case "speech-practice":
      return TASK_TYPES.PRONUNCIATION;

    // Body break
    case "body-break":
    case "body_break":
      return TASK_TYPES.BODY_BREAK;


    // Motion Mission
    case "motion-mission":
    case "motion_mission":
    case "motionmission":
      return TASK_TYPES.MOTION_MISSION;

    // Musical Chairs
    case "musical-chairs":
    case "musical_chairs":
    case "musicalchairs":
      return TASK_TYPES.MUSICAL_CHAIRS;

    // ✅ Mood check-in (NEW)
    case "mood-checkin":
    case "mood-check-in":
    case "mood_checkin":
    case "moodcheckin":
    case "mood_check_in":
      return TASK_TYPES.MOOD_CHECKIN;

    // ✅ Guess Who (NEW)
    case "guesswho":
    case "guess-who":
    case "guess_who":
    case "guess-who-task":
      return TASK_TYPES.GUESS_WHO;

    // ✅ Echo Chain (NEW)
    case "echochain":
    case "echo-chain":
    case "echo_chain":
    case "echo chain":
      return TASK_TYPES.ECHO_CHAIN;

    // Draw-only tasks
    case "Draw":
    case "draw":
    case "drawing":
      return TASK_TYPES.DRAW;

    // Mime-only tasks
    case "mime":
    case "act":
    case "act-out":
      return TASK_TYPES.MIME;

    // Combined draw–mime tasks
    case "draw-mime":
    case "draw_mime":
      return TASK_TYPES.DRAW_MIME;

    // Diff Detective
    case "diff-detective":
    case "diff_detective":
    case "diff":
      return TASK_TYPES.DIFF_DETECTIVE;

    // Hide & Seek
    case "hidenseek":
    case "hide-n-seek":
    case "hide_and_seek":
    case "hide-and-seek":
      return TASK_TYPES.HIDENSEEK;

    // Speed Draw (aliases)
    case "speed-draw":
    case "speed_draw":
      return TASK_TYPES.SPEED_DRAW;

    // AI Debate Judge (NEW)
    case "ai-debate-judge":
    case "ai_debate_judge":
    case "debate-judge":
      return TASK_TYPES.AI_DEBATE_JUDGE;

    // Hangman (NEW)
    case "hangman":
    case "hangman-duel":
    case "hangman_duel":
    case "hangmanduel":
      return TASK_TYPES.HANGMAN_DUEL;

    // ✅ WordWeaver Duel (NEW)
    case "word-weaver":
    case "word_weaver":
    case "wordweaver":
    case "word-weaver-duel":
    case "word_weaver_duel":
    case "wordweaverduel":
      return TASK_TYPES.WORD_WEAVER_DUEL;

    // already normalized constant coming through
    case TASK_TYPES.WORD_WEAVER_DUEL:
      return TASK_TYPES.WORD_WEAVER_DUEL;

    // ✅ Script Play
    case "script-play":
    case "script_play":
    case "scriptplay":
    case "script":
      return TASK_TYPES.SCRIPT_PLAY;

    // ✅ Role Play Deck
    case "role-play":
    case "roleplay":
    case "role-play-deck":
    case "role_play_deck":
    case "roleplaydeck":
    case "role-play-task":
      return TASK_TYPES.ROLE_PLAY_DECK;

    // ✅ Fake Out (NEW)
    case "fakeout":
    case "fake-out":
    case "fake_out":
    case "fake out":
      return TASK_TYPES.FAKE_OUT;

    // Brainstorm Battle
    case "brainstorm-battle":
    case "brainstorm_battle":
    case "brainstormbattle":
      return TASK_TYPES.BRAINSTORM_BATTLE;

    // Collaboration
    case "collaboration":
    case "collab":
      return TASK_TYPES.COLLABORATION;

    // Live Debate
    case "live-debate":
    case "live_debate":
    case "debate":
      return TASK_TYPES.LIVE_DEBATE;

    // Brain Blitz / Jeopardy
    case "brain-blitz":
    case "brain_blitz":
    case "brainblitz":
    case "jeopardy":
      return TASK_TYPES.JEOPARDY;

    // Pet Feeding
    case "pet-feeding":
    case "pet_feeding":
    case "petfeeding":
    case "feed-the-pet":
      return TASK_TYPES.PET_FEEDING;


    default:
      return raw;
  }
}

// ---------------------------------------------------------------------
// Station-color helpers
// ---------------------------------------------------------------------
// Keep in sync with the station palette used elsewhere in the student app.
const STATION_COLOR_PALETTE = [
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Blue",
  "Teal",
  "Purple",
  "Pink",
];

function normalizeStationColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // If we already have a known color name (any casing), return the canonical palette case.
  const lower = s.toLowerCase();
  const direct = STATION_COLOR_PALETTE.find((c) => c.toLowerCase() === lower);
  if (direct) return direct;

  // If someone passed a station id (e.g. "station-5"), map it to a palette color.
  const m = /^station-(\d+)$/i.exec(lower);
  if (m) {
    const idx = Number(m[1]) - 1;
    return Number.isFinite(idx) ? STATION_COLOR_PALETTE[idx] || null : null;
  }

  // Unknown string - return as-is (best effort) so downstream code can decide.
  return s;
}


// ---------------------------------------------------------------------
// Defensive normalizers for tasks whose backend payloads may vary.
// (We never want the UI to hard-fail just because one field is missing.)
// ---------------------------------------------------------------------
function ensureFakeOutRounds(task) {
  const t = task || {};
  const cfg = t?.config && typeof t.config === "object" ? t.config : {};

  // FakeOutTask.jsx reads cfg.rounds (not task.rounds). Ensure that shape exists.
  const existingCfgRounds = Array.isArray(cfg.rounds)
    ? cfg.rounds.filter((r) => {
        const statement = String(
          r?.statement ?? r?.prompt ?? r?.question ?? r?.text ?? r?.stem ?? ""
        ).trim();
        return r && statement;
      })
    : [];
  if (existingCfgRounds.length > 0) return t;

  // Helper: normalize an arbitrary "round-like" object into the schema FakeOutTask expects.
  const normalizeRound = (r, fallbackIdx = 0) => {
    const statement = String(
      r?.statement ?? r?.prompt ?? r?.question ?? r?.text ?? r?.stem ?? t?.prompt ?? t?.title ?? ""
    ).trim();

    const optionsRaw =
      (Array.isArray(r?.options) && r.options) ||
      (Array.isArray(r?.choices) && r.choices) ||
      (Array.isArray(r?.answers) && r.answers) ||
      (Array.isArray(t?.options) && t.options) ||
      (Array.isArray(t?.choices) && t.choices) ||
      [];

    const options = optionsRaw.map((o) => String(o ?? "").trim()).filter(Boolean);
    while (options.length < 4) options.push("");
    const fixedOptions = options.slice(0, 4);

    // correctIndex must be 0..2 (option 4 is joke). Try to infer if missing.
    let correctIndex = Number(r?.correctIndex);
    if (!Number.isFinite(correctIndex) || correctIndex < 0 || correctIndex > 2) {
      const truth = String(r?.correctAnswer ?? r?.answer ?? r?.truth ?? "").trim();
      const idx = truth ? fixedOptions.findIndex((x) => String(x).trim() === truth) : -1;
      correctIndex = idx >= 0 && idx <= 2 ? idx : 0;
    }

    return { statement, options: fixedOptions, correctIndex, _fallbackIdx: fallbackIdx };
  };

  // Prefer existing task.rounds if present (some generators do this).
  const fromTaskRounds = Array.isArray(t.rounds) ? t.rounds : [];

  // Otherwise, try common multi-item shapes.
  const rawItems =
    (Array.isArray(t.items) && t.items.length > 0 && t.items) ||
    (Array.isArray(t.questions) && t.questions.length > 0 && t.questions) ||
    (Array.isArray(t.subItems) && t.subItems.length > 0 && t.subItems) ||
    (Array.isArray(t.multiQuestions) && t.multiQuestions.length > 0 && t.multiQuestions) ||
    [];

  const inferred =
    (fromTaskRounds.length > 0 ? fromTaskRounds : rawItems).map((r, idx) => normalizeRound(r, idx));

  const finalRounds = inferred.filter((r) => r && String(r.statement ?? "").trim());

  // If we still couldn't infer anything, leave as-is (FakeOutTask will show its message).
  if (finalRounds.length === 0) return t;

  return {
    ...t,
    // Ensure config exists and contains rounds in the expected schema.
    config: {
      ...cfg,
      rounds: finalRounds.map(({ _fallbackIdx, ...rest }) => rest),
      // gently carry over common top-level values if config doesn't have them
      playerCount: cfg.playerCount ?? t.playerCount,
      playerNames: cfg.playerNames ?? t.playerNames,
    },
  };
}

function normalizeSpokenText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFromText(s) {
  const clean = normalizeSpokenText(s);
  return clean ? clean.split(" ") : [];
}

// Returns true if transcript contains the target tokens in order (not necessarily contiguous).
function containsTokensInOrder(transcriptTokens, targetTokens) {
  if (!targetTokens || targetTokens.length === 0) return true;
  if (!transcriptTokens || transcriptTokens.length === 0) return false;

  let j = 0;
  for (let i = 0; i < transcriptTokens.length && j < targetTokens.length; i += 1) {
    if (transcriptTokens[i] === targetTokens[j]) j += 1;
  }
  return j >= targetTokens.length;
}

function EchoChainInline({ task, onSubmit, disabled, readOnly = false, memberNames = [], practiceMode = false }) {
  const seed = String(task?.seedTerm || task?.config?.seedTerm || "").trim();
  const perTurnSeconds =
    Number(task?.config?.perTurnSeconds ?? task?.perTurnSeconds ?? 10) || 0;
  const rotationBonus = Number(task?.config?.rotationBonusPoints ?? 25) || 0;
  const minChainLength = Math.max(3, Math.min(20, Number(task?.config?.minChainLength ?? 5) || 5));

  const [chain, setChain] = useState(() => (seed ? [seed] : []));
  const [nextWord, setNextWord] = useState("");
  const [turn, setTurn] = useState(1);

  const [hideChain, setHideChain] = useState(() => (!readOnly ? true : false));
  const [speakerIndex, setSpeakerIndex] = useState(0);
  // Tester: "don't allow add until someone has clicked '__ said that'." Each
  // turn requires confirming who recited the chain before the next word is added.
  const [recitedThisTurn, setRecitedThisTurn] = useState(false);

  const [listening, setListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastCheck, setLastCheck] = useState(null); // { ok, missing, heard }

  const recognitionRef = useRef(null);

  useEffect(() => {
    // Reset visibility + speaker when task changes.
    if (!readOnly) setHideChain(true);
    setSpeakerIndex(0);
    setLastTranscript("");
    setLastCheck(null);
    setListening(false);
    setRecitedThisTurn(false);
  }, [task?.id, task?._id, task?.taskId, readOnly]);

  // Pad practice mode with bot teammates so the per-player "X said
  // that ✅" attribution row demonstrates the multi-player flow even
  // without a real roster.  Tester request.
  const ECHO_BOTS_INLINE = ["Riley (bot)", "Quinn (bot)", "Avery (bot)"];
  const allNames = (() => {
    const real = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
    if (practiceMode && real.length < 3) {
      const me = real[0] || getPlayerName();
      return [me, ...ECHO_BOTS_INLINE.slice(0, 2)];
    }
    return real;
  })();
  const getSpeakerLabel = (idx) => {
    if (allNames.length > 0) return allNames[idx % allNames.length];
    return `Player ${idx + 1}`;
  };

  // Only enforce the "confirm who recited" gate when we actually know the
  // teammates (otherwise there's no "said that" button to click).
  const requiresRecital = !readOnly && allNames.length > 0;

  const canUseSpeech =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopListening = () => {
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    setListening(false);
  };

  const startListening = () => {
    if (disabled || readOnly) return;
    if (!canUseSpeech) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    recognitionRef.current = rec;

    // Tester: 'Listen and check does not stay on to listen, it should
    // tap on to listen and then tap off to stop'.  continuous=true
    // keeps the mic open until the user explicitly stops it.
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    setLastTranscript("");
    setLastCheck(null);
    setListening(true);

    rec.onresult = (event) => {
      // continuous=true means we may get many partial results;
      // accumulate them all and re-check the chain on every update.
      const text = Array.from(event?.results || [])
        .map((r) => r?.[0]?.transcript)
        .filter(Boolean)
        .join(" ");

      setLastTranscript(text);

      const target = tokensFromText(chain.join(" "));
      const heard = tokensFromText(text);

      const ok = containsTokensInOrder(heard, target);
      setLastCheck({
        ok,
        missing: ok ? [] : target,
        heard,
      });
      // Don't auto-stop — leave the mic open until the user taps Stop.
    };

    rec.onerror = () => {
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  // Simple per-turn timer (optional). This is a UI helper only; scoring is handled by backend/session rules.
  const [timeLeft, setTimeLeft] = useState(
    perTurnSeconds > 0 ? perTurnSeconds : null
  );
  useEffect(() => {
    if (readOnly) return;
    if (!perTurnSeconds || perTurnSeconds <= 0) return;
    setTimeLeft(perTurnSeconds);
  }, [perTurnSeconds, turn, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (timeLeft == null) return;
    if (timeLeft <= 0) return;

    const tId = setTimeout(
      () => setTimeLeft((t) => (t == null ? null : t - 1)),
      1000
    );
    return () => clearTimeout(tId);
  }, [timeLeft, readOnly]);

  const addWord = () => {
    if (disabled || readOnly) return;
    if (requiresRecital && !recitedThisTurn) return; // must confirm recital first
    const w = String(nextWord || "").trim();
    if (!w) return;
    setChain((prev) => [...prev, w]);
    setNextWord("");
    setTurn((t) => t + 1);
    setSpeakerIndex((s) => s + 1);
    setLastCheck(null);
    setLastTranscript("");
    setRecitedThisTurn(false); // next turn needs a fresh recital
  };

  const reset = () => {
    if (disabled || readOnly) return;
    setChain(seed ? [seed] : []);
    setNextWord("");
    setTurn(1);
    setSpeakerIndex(0);
    setLastCheck(null);
    setLastTranscript("");
    setListening(false);
    setRecitedThisTurn(false);
  };

  const finish = () => {
    if (disabled || readOnly) return;
    if (chain.length < minChainLength) return;
    onSubmit?.({
      type: TASK_TYPES.ECHO_CHAIN,
      completed: true,
      chain,
      chainLength: chain.length,
      perTurnSeconds,
      rotationBonusPoints: rotationBonus,
    });
  };

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${CONTRAST_BORDER}`,
        background: CONTRAST_BG_LIGHT,
        padding: 12,
        color: CONTRAST_TEXT_DARK,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
  <div style={{ fontWeight: 700, fontSize: "1rem" }}>🔊 Echo Chain</div>
  <div style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${CONTRAST_BORDER}`, background: "#ffffff", fontWeight: 800, fontSize: "0.85rem" }}>
    🎯 Need {Math.max(0, minChainLength - chain.length)} more
  </div>
</div>

        {perTurnSeconds > 0 && (
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#ffffff",
              fontWeight: 700,
              fontSize: "0.9rem",
            }}
            aria-label="Turn timer"
            title="Optional per-turn timer"
          >
            ⏱ {timeLeft ?? perTurnSeconds}s
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: "0.95rem" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>How to play</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.35 }}>
          <li>
            Start with: <strong>{seed || "the seed term"}</strong>
          </li>
          <li>Player 1 repeats it aloud and adds one related term.</li>
          <li>Next player repeats the full chain in order and adds one.</li>
          <li>
            If someone forgets or changes order, the chain breaks—reset and try
            again.
          </li>
        </ul>
        {/* Practice / solo notice — Echo Chain pads with bots but
            testers (Ranbir) read that as "this task needs other
            players I don't have."  Spell out what to do when alone. */}
        {practiceMode &&
          (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []).length < 2 && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.35)",
                color: "#92400e",
                fontSize: "0.85rem",
                lineHeight: 1.4,
              }}
            >
              👤 <b>Playing solo?</b> You'll take every turn — the
              bot names are stand-ins.
            </div>
          )}
        {rotationBonus > 0 && (
          <div style={{ marginTop: 6, fontSize: "0.9rem", color: "#334155" }}>
            ⭐ Bonus idea: +{rotationBonus} points for a full rotation without
            errors.
          </div>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Current chain <span style={{ fontWeight: 700 }}>({chain.length})</span>
          <div style={{ marginTop: 4, fontSize: "0.85rem", color: "rgba(15,23,42,0.70)" }}>
            Tip: one person says the full chain out loud. Keep it hidden to avoid silent reading.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            padding: 10,
            borderRadius: 14,
            background: "#ffffff",
            border: `1px solid ${CONTRAST_BORDER}`,
            minHeight: 52,
          }}
        >
          {chain.length ? (
            chain.map((w, i) => {
              const masked = !readOnly && hideChain;
              return (
                <span
                  key={`${w}:${i}`}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: masked ? "#f1f5f9" : "#eef2ff",
                    border: masked ? "1px solid #cbd5e1" : "1px solid #c7d2fe",
                    fontSize: "0.9rem",
                    color: masked ? "#64748b" : CONTRAST_TEXT_DARK,
                    letterSpacing: masked ? 1 : 0,
                  }}
                  title={masked ? "Hidden during play" : undefined}
                >
                  {i + 1}. {masked ? "••••" : w}
                </span>
              );
            })
          ) : (
            <span style={{ color: "#64748b", fontSize: "0.9rem" }}>
              Waiting for the seed term…
            </span>
          )}
        </div>
      
      {!readOnly && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#ffffff",
              fontWeight: 800,
              fontSize: "0.9rem",
            }}
          >
            🎤 Speaker:{" "}
            <select
              value={speakerIndex}
              onChange={(e) => setSpeakerIndex(Number(e.target.value) || 0)}
              disabled={disabled}
              style={{
                marginLeft: 6,
                border: `1px solid ${CONTRAST_BORDER}`,
                borderRadius: 999,
                padding: "4px 10px",
                fontWeight: 800,
                outline: "none",
              }}
            >
              {(() => {
                const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
                const n = names.length > 0 ? names.length : Math.max(4, turn); // fallback
                return new Array(n).fill(0).map((_, i) => (
                  <option key={i} value={i}>
                    {getSpeakerLabel(i)}
                  </option>
                ));
              })()}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setHideChain((v) => !v)}
            disabled={disabled}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#ffffff",
              color: CONTRAST_TEXT_DARK,
              fontWeight: 800,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
            title="Hide/show the chain on screen during play"
          >
            {hideChain ? "👀 Reveal chain" : "🔒 Hide chain"}
          </button>

          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={disabled || !canUseSpeech}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "none",
              background: !canUseSpeech ? "#9ca3af" : listening ? "#dc2626" : "#0ea5e9",
              color: "#ffffff",
              fontWeight: 900,
              cursor: disabled || !canUseSpeech ? "not-allowed" : "pointer",
            }}
            title={!canUseSpeech ? "Speech recognition not supported in this browser" : "Listen to the speaker recite the full chain"}
          >
            {listening ? "Stop mic" : "Listen & check"}
          </button>

        </div>
      )}

      {/* Per-player attribution row — one button per teammate.  Tester:
          'the player who said it taps "Richard said that"'.  Tap any
          name to attribute the recital to that player. */}
      {!readOnly && allNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: CONTRAST_TEXT_DARK, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Who recited?
          </span>
          {allNames.map((nm, i) => (
            <button
              key={`${nm}-${i}`}
              type="button"
              onClick={() => {
                onSubmit?.({
                  type: TASK_TYPES.ECHO_CHAIN,
                  checkpoint: true,
                  speaker: nm,
                  speakerIndex: i,
                  chainLength: chain.length,
                  lastTranscript,
                  lastCheck,
                });
                setSpeakerIndex(i + 1);
                setRecitedThisTurn(true); // unlocks "Add" for this turn
              }}
              disabled={disabled}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "none",
                background: "#16a34a",
                color: "#fff",
                fontWeight: 900,
                fontSize: 13,
                cursor: disabled ? "not-allowed" : "pointer",
                boxShadow: "0 4px 10px rgba(22,163,74,0.25)",
              }}
            >
              {nm} said that ✅
            </button>
          ))}
        </div>
      )}

      {(lastTranscript || lastCheck) && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 14, border: `1px solid ${CONTRAST_BORDER}`, background: "#ffffff" }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Mic check</div>
          {lastTranscript ? (
            <div style={{ color: "#475569", fontSize: "0.92rem", lineHeight: 1.35 }}>
              Heard: <strong>{lastTranscript}</strong>
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "0.92rem" }}>No transcript captured.</div>
          )}
          {lastCheck && (
            <div style={{ marginTop: 6, fontWeight: 900, color: lastCheck.ok ? "#16a34a" : "#dc2626" }}>
              {lastCheck.ok ? "✅ Chain appears in order." : "⚠️ Chain may be missing or out of order."}
            </div>
          )}
          <div style={{ marginTop: 6, color: "#64748b", fontSize: "0.85rem" }}>
            Tip: keep the chain hidden on screen during play to reduce "read-off" cheating.
          </div>
        </div>
      )}

</div>

      {!readOnly && (
        <div
          style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={nextWord}
            onChange={(e) => setNextWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWord(); // addWord enforces the recital gate itself
              }
            }}
            disabled={disabled}
            placeholder="Type the next word your team adds…"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              fontSize: "0.95rem",
              outline: "none",
            }}
          />

          <button
            type="button"
            onClick={addWord}
            disabled={disabled || !String(nextWord || "").trim() || (requiresRecital && !recitedThisTurn)}
            title={requiresRecital && !recitedThisTurn ? "First tap who recited the chain above" : "Add the next word"}
            style={{
              padding: "10px 12px",
              borderRadius: 999,
              border: "none",
              background: (!String(nextWord || "").trim() || (requiresRecital && !recitedThisTurn))
                ? "#9ca3af"
                : CONTRAST_ACCENT,
              color: "#ffffff",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>
        </div>
      )}
      {!readOnly && requiresRecital && !recitedThisTurn && (
        <div style={{ marginTop: 6, fontSize: "0.82rem", color: "#92400e" }}>
          ☝️ Tap "<b>{getSpeakerLabel(speakerIndex)} said that</b>" above to confirm the recital, then add the next word.
        </div>
      )}

      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={reset}
          disabled={disabled || readOnly}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: `1px solid ${CONTRAST_BORDER}`,
            background: "#ffffff",
            color: CONTRAST_TEXT_DARK,
            fontWeight: 700,
            cursor: disabled || readOnly ? "not-allowed" : "pointer",
          }}
        >
          Reset
        </button>

        <button
          type="button"
          onClick={finish}
          disabled={disabled || readOnly || chain.length < minChainLength}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "none",
            background: "#16a34a",
            color: "#ffffff",
            fontWeight: 800,
            cursor: disabled || readOnly ? "not-allowed" : "pointer",
          }}
          title={chain.length < minChainLength ? `Add ${Math.max(0, minChainLength - chain.length)} more to finish` : "Finish after minimum chain length"}
        >
          Done ✅
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Multi-part renderer for MC / TF / Short Answer
   ───────────────────────────────────────────── */

function MultiPartTask({ mode, task, review, readOnly = false, onSubmit, submitting, disabled, memberNames = [] }) {
  const isChoice = mode === "choice";
  const isReview = !!readOnly;
  const [validationMsg, setValidationMsg] = useState(null);

  const rawItemsAll =
    (Array.isArray(task.items) && task.items.length > 0 && task.items) ||
    (Array.isArray(task.questions) && task.questions.length > 0 && task.questions) ||
    (Array.isArray(task.subItems) && task.subItems.length > 0 && task.subItems) ||
    (Array.isArray(task.multiQuestions) && task.multiQuestions.length > 0 && task.multiQuestions) ||
    [];

  // Short answer: the generator can produce many questions (testers saw 20+),
  // but a short-answer task is meant to be split ~2 per team member. Present
  // only (players × perPlayer) and label each with whose turn it is. Choice/MC
  // keeps all of its questions.
  const roster = (Array.isArray(memberNames) ? memberNames.map((n) => String(n || "").trim()).filter(Boolean) : []);
  const players = roster.length ? roster : ["You"];
  const perPlayer = Math.max(1, Number(task?.config?.questionsPerPlayer) || 2);
  const rawItems = (mode === "short" && rawItemsAll.length > 0)
    ? rawItemsAll.slice(0, Math.min(rawItemsAll.length, players.length * perPlayer) || rawItemsAll.length)
    : rawItemsAll;

  const items =
    rawItems.length > 0
      ? rawItems
      : [{
          id: task.id || "only",
          prompt: task.prompt,
          options: task.options || [],
          correctAnswer: task.correctAnswer ?? null,
        }];

  const [answers, setAnswers] = useState(() =>
    items.map(() => ({ value: isChoice ? null : "" }))
  );

  useEffect(() => {
    setAnswers(items.map(() => ({ value: isChoice ? null : "" })));
  }, [items.length, isChoice, task?._id, task?.id]);

  const itemOptions = useMemo(() => {
    const taskKey = String(task?._id || task?.id || "task");

    return items.map((item, idx) => {
      const base =
        (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
        (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
        (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
          ? ["True", "False"]
          : []);

      if (!base || base.length === 0) return [];

      const itemKey = String(item?.id || item?._id || `i${idx}`);
      return seededShuffle(base, `${taskKey}:${itemKey}`);
    });
  }, [task?._id, task?.id, items]);

  const handleChoiceClick = (itemIndex, option) => {
    setAnswers((prev) =>
      prev.map((ans, idx) => (idx === itemIndex ? { ...ans, value: option } : ans))
    );
  };

  const handleTextChange = (itemIndex, value) => {
    setAnswers((prev) =>
      prev.map((ans, idx) => (idx === itemIndex ? { ...ans, value } : ans))
    );
  };

  // Sentence validation for short-answer (non-choice) mode
  const MIN_SENTENCE_WORDS = 5;
  const SENTENCE_PUNCT = /[.!?]$/;

  const getAnswerStatus = (val) => {
    if (isChoice) return "ok";
    const text = String(val || "").trim();
    if (!text) return "empty";
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < MIN_SENTENCE_WORDS) return "too-short";
    if (!SENTENCE_PUNCT.test(text)) return "no-punct";
    return "ok";
  };

  const allAnswered = answers.every(
    (ans) => ans.value !== null && String(ans.value).trim() !== ""
  );

  const allValid = isChoice || answers.every((ans) => getAnswerStatus(ans.value) === "ok");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submitting || disabled || !allAnswered) return;

    // Validate sentences for short-answer mode
    if (!isChoice) {
      for (let i = 0; i < answers.length; i++) {
        const status = getAnswerStatus(answers[i].value);
        if (status === "too-short") {
          setValidationMsg(`Question ${i + 1}: Your sentence is too short — write at least ${MIN_SENTENCE_WORDS} words.`);
          setTimeout(() => setValidationMsg(null), 4000);
          return;
        }
        if (status === "no-punct") {
          setValidationMsg(`Question ${i + 1}: Please end your sentence with proper punctuation (. ! ?)`);
          setTimeout(() => setValidationMsg(null), 4000);
          return;
        }
      }
    }

    const payload = items.map((item, idx) => {
      let answerVal = answers[idx]?.value ?? null;

      const isTF =
        task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE;

      if (isTF && typeof answerVal === "string") {
        const v = answerVal.trim().toLowerCase();
        if (v === "true" || v === "false") answerVal = v;
      }

      let baseIndex = null;
      if (isChoice && answerVal != null) {
        const base =
          (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
          (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
          (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
            ? ["True", "False"]
            : []);

        if (base && base.length > 0) {
          const idxBase = base.findIndex(
            (opt) => String(opt).trim() === String(answerVal).trim()
          );
          baseIndex = idxBase >= 0 ? idxBase : null;
        }
      }

      return {
        // True/False items commonly carry the question under `statement`
        // (not `prompt`/`text`). Without this, multi-item T/F rendered blank
        // questions — the long-standing "there were no questions" bug, since
        // MultiPartTask (not the dedicated TrueFalseTask) renders multi-item T/F.
        itemId: item.id ?? idx,
        prompt: item.prompt ?? item.statement ?? item.text ?? item.question ?? "",
        value: answerVal,
        baseIndex,
      };
    });

    const payloadObj = {
      type: mode === "choice" ? "multi-choice" : "multi-short",
      answers: payload,
    };

    onSubmit?.(payloadObj);
  };

  return (
    <form onSubmit={handleSubmit}>
      {task.prompt && (
        <p
          style={{
            marginTop: 0,
            marginBottom: 12,
            fontSize: "1rem",
            fontWeight: 500,
            color: CONTRAST_TEXT_DARK,
          }}
        >
          {task.prompt}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, idx) => {
          const labelRaw =
            item?.label ??
            item?.question ??
            item?.prompt ??
            item?.statement ??   // True/False items carry the question here — was missing, so T/F showed "Question N" placeholders
            item?.stem ??
            item?.text ??
            item?.title ??
            item?.description ??
            "";

          const label =
            typeof labelRaw === "string" && labelRaw.trim()
              ? labelRaw.trim()
              : `Question ${idx + 1}`;
          const opts = itemOptions[idx] || [];
          const answerVal = answers[idx]?.value ?? "";
          const correctIndex = item?.correctAnswer ?? null;
          const studentIndex =
            review?.answers?.[idx]?.baseIndex ??
            review?.studentAnswer?.[idx]?.baseIndex ??
            null;

          return (
            <div
              key={item.id ?? idx}
              style={{
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: CONTRAST_BG_LIGHT,
                color: CONTRAST_TEXT_DARK,
              }}
            >
              {label && (
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    color: CONTRAST_TEXT_DARK,
                  }}
                >
                  <span style={{ marginRight: 4 }}>{idx + 1}.</span>
                  {!isChoice && (
                    <span style={{ fontWeight: 800, color: "#0369a1" }}>
                      {players[idx % players.length]},{" "}
                    </span>
                  )}
                  {label}
                </div>
              )}

              {isChoice ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                  {opts.map((opt, optIndex) => {
                    const base =
                      (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
                      (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
                      (task.taskType === TASK_TYPES.TRUE_FALSE ||
                      task.type === TASK_TYPES.TRUE_FALSE
                        ? ["True", "False"]
                        : []);

                    const optBaseIndex = base.findIndex(
                      (x) => String(x).trim() === String(opt).trim()
                    );

                    const isSelected = answerVal === opt;
                    const isCorrect = isReview && optBaseIndex === correctIndex;
                    const isChosen = isReview && optBaseIndex === studentIndex;

                    const border =
                      isReview && isCorrect
                        ? "2px solid #16a34a"
                        : isReview && isChosen && !isCorrect
                        ? "2px solid #dc2626"
                        : isSelected
                        ? `2px solid ${CONTRAST_ACCENT}`
                        : `1px solid ${CONTRAST_BORDER}`;

                    const background = isSelected ? CONTRAST_ACCENT : "#ffffff";
                    const color = isSelected ? "#ffffff" : CONTRAST_TEXT_DARK;

                    return (
                      <button
                        key={`${item.id ?? idx}:${optIndex}`}
                        type="button"
                        onClick={() => handleChoiceClick(idx, opt)}
                        disabled={submitting || disabled}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          border,
                          background,
                          color,
                          textAlign: "left",
                          cursor: submitting || disabled ? "not-allowed" : "pointer",
                          fontSize: "0.9rem",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  rows={2}
                  value={answerVal}
                  onChange={(e) => { handleTextChange(idx, e.target.value); if (validationMsg) setValidationMsg(null); }}
                  disabled={submitting || disabled}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 10,
                    border: `1px solid ${getAnswerStatus(answerVal) === "ok" ? "#86efac" : CONTRAST_BORDER}`,
                    fontSize: "0.9rem",
                    resize: "vertical",
                    color: CONTRAST_TEXT_DARK,
                    background: getAnswerStatus(answerVal) === "ok" ? "#f0fdf4" : "#fff",
                    transition: "background 0.25s ease, border-color 0.25s ease",
                  }}
                  placeholder="Type your answer…"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Validation popup */}
      {validationMsg && (
        <div style={{
          marginTop: 8,
          padding: "8px 12px",
          borderRadius: 10,
          background: "#fef2f2",
          border: "1px solid #fca5a5",
          color: "#991b1b",
          fontSize: "0.85rem",
          fontWeight: 600,
        }}>
          {validationMsg}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={!allAnswered || submitting || disabled}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "none",
            background: allAnswered ? "#16a34a" : "#9ca3af",
            color: "#ffffff",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: !allAnswered || submitting || disabled ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Sending…" : items.length > 1 ? "Submit all" : "Submit"}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────
Main TaskRunner
───────────────────────────────────────────── */

export default function TaskRunner({
  task,
  taskIndex,
  taskTypes,
  onSubmit,
  submitting = false,
  onAnswerChange,
  answerDraft,
  disabled = false,
  socket,

  mode = "play", // play || review
  review = null,

  // for FlashcardsRace
  roomCode,
  playerTeam,
  memberNames = [],
  remainingMs,
  partnerAnswer,
  showPartnerReply,
  onPartnerReply,

  // Student email state for feedback report emails
  savedEmails,
  onEmailsChange,

  // Inline scanner element (e.g. <QrScanner>) to embed inside task UIs
  // that have their own scanner chrome (e.g. PhysicalMultipleChoiceTask)
  scannerSlot = null,

  // Practice / demo surface (DemoMode.jsx).  Lets task types render
  // simulators in place of hardware-bound features (e.g. PMC's color
  // scanner, which can't access the camera in practice mode).
  practiceMode = false,

  // Conference-booth flag: even though practiceMode is true (solo
  // user, bots, etc.), the player IS in front of physical QR codes
  // at our booth, so scan-simulator panels and click-color fallbacks
  // should be hidden — they have to actually scan.
  requireRealScans = false,
}) {
  if (!task) return null;

  // Inject taskIndex into task object so DesignatedWriter can use it for
  // consistent index-based rotation (matches the handoff prompt in StudentApp)
  const t = useMemo(() => {
    if (typeof taskIndex === "number" && taskIndex >= 0) {
      return { ...task, _taskIndex: taskIndex };
    }
    return task;
  }, [task, taskIndex]);

  // -------------------------------------------------------------------
  // TaskRunner Presenter Overlay (shared, reusable across tasks)
  // Tasks can call props.presenter.showCountdown(...) to display a standard 1-2-3 GO! overlay.
  // -------------------------------------------------------------------
  const [presenterOverlay, setPresenterOverlay] = useState(null); // { kind:'countdown', title, seconds, subtext, key }

  const [tasksetVictoryKey, setTasksetVictoryKey] = useState(null);
  const [victoryCanPlayAt, setVictoryCanPlayAt] = useState(null);
  // Random victory videos (per-task celebration)
  const VICTORY_VIDEOS = useMemo(
    () => [1, 2, 3, 4, 5, 6].map((n) => `/animations/victory/victory-${n}.mp4`),
    []
  );

  const [taskVictory, setTaskVictory] = useState(null); // { key, src }
  const presenterResolveRef = useRef(null);

  const activeTaskScanHandlerRef = useRef(null);

  const registerTaskScanHandler = (handler) => {
    activeTaskScanHandlerRef.current = handler;
  };

  const unregisterTaskScanHandler = () => {
    activeTaskScanHandlerRef.current = null;
  };

  const type = t ? normalizeTaskType(t.taskType || t.type) : null;
  const taskKey = buildStableTaskKey(t, type);

  function playSound(src, volume = 0.6) {
    try {
      const a = new Audio(src);
      a.volume = volume;
      a.play().catch(() => {});
    } catch {}
  }

  function triggerTasksetVictory() {
    const k = `tv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setTasksetVictoryKey(k);
    setVictoryCanPlayAt(null);
    // If you have a dedicated victory audio, use it. Autoplay with audio is often blocked, so this is best-effort.
    playSound("/sounds/victory.mp3", 0.7);
  }

  function triggerTaskVictory() {
    const k = `tv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const src =
      VICTORY_VIDEOS[Math.floor(Math.random() * VICTORY_VIDEOS.length)] ||
      "/animations/victory/victory-1.mp4";
    setTaskVictory({ key: k, src });
    setVictoryCanPlayAt(null);
    // Best-effort: autoplay with audio is often blocked; still attempt a victory sound.
    playSound("/sounds/victory.mp3", 0.7);
  }

  const hidePresenter = React.useCallback((result = { ok: false, reason: "hidden" }) => {
    try {
      if (presenterResolveRef.current) presenterResolveRef.current(result);
    } catch (_) {}
    presenterResolveRef.current = null;
    setPresenterOverlay(null);
  }, []);

  const showCountdown = React.useCallback(
    ({ title = "Get ready", seconds = 3, subtext = "1-2-3 GO!", key = null } = {}) => {
      const s = Math.max(1, Math.min(10, Number(seconds) || 3));
      const k = key || `${Date.now()}:${Math.random().toString(16).slice(2)}`;

      // If something is already open, close it cleanly.
      if (presenterResolveRef.current) {
        try {
          presenterResolveRef.current({ ok: false, reason: "replaced" });
        } catch (_) {}
        presenterResolveRef.current = null;
      }

      setPresenterOverlay({ kind: "countdown", title, seconds: s, subtext, key: k });

      return new Promise((resolve) => {
        presenterResolveRef.current = resolve;
      });
    },
    []
  );

  // Resolve any pending presenter when TaskRunner unmounts
  useEffect(() => {
    return () => {
      try {
        if (presenterResolveRef.current) presenterResolveRef.current({ ok: false, reason: "unmounted" });
      } catch (_) {}
      presenterResolveRef.current = null;
    };
  }, []);

  const presenter = useMemo(
    () => ({
      showCountdown,
      hide: hidePresenter,
    }),
    [showCountdown, hidePresenter]
  );

  // Defensive per-type payload normalizing (keeps UI resilient during AI/taskset iteration)
  const tPrepared = useMemo(() => {
    if (!t) return t;
    if (type === TASK_TYPES.FAKE_OUT) return ensureFakeOutRounds(t);
    return t;
  }, [t, type]);

  // Prepared task payload (avoid TDZ crashes; used throughout)
  const tp = tPrepared || t;


  // Tier 2 — Contextual moments (staging interstitial)
  // Shows the category animation briefly when a new task loads, then collapses (1s) so the task UI slides up.
  // IMPORTANT: use a stable task key so UI elements (like staging/victory videos)
  // don't constantly reset on unrelated re-renders (e.g., countdown bar updates).
  
  // -------------------------------------------------------------------
  // Global QR scan dispatcher helper (does NOT mount a camera)
  //
  // Your single app-wide scanner can call:
  //   window.__curriculateTaskRunnerScanHandler = (raw) => { ... }
  //
  // It will:
  //  1) dispatch a window event that tasks can listen for
  //  2) also forward to TaskRunner's active scan handler (if installed)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.__curriculateTaskRunnerScanHandler = (raw) => {
      const fn = activeTaskScanHandlerRef.current;
      return typeof fn === "function" ? fn(raw) === true : false;
    };

    return () => {
      window.__curriculateTaskRunnerScanHandler = null;
    };
  }, [taskKey]);

  // Derived team id for tasks that need it (media uploads, inter-team routing, etc.)
  const derivedTeamId =
    t?.teamId ||
    playerTeam?.id ||
    playerTeam?.teamId ||
    playerTeam?.teamID ||
    null;

  // const tp = tPrepared || t; // moved выше to avoid TDZ crash

  const handleTaskSubmit = async (payload) => {
    let outgoing = payload;
    if (payload != null && typeof payload !== "object") {
      outgoing = { type, answer: payload };
    }

    // If this is the final task in the taskset, show the universal victory overlay here (TaskRunner),
    // so every task type benefits (sounds + confetti + optional victory.mp4).
    const isFinalTaskset =
      !!(task?.isFinalTaskset ||
        task?.isFinal ||
        task?.config?.isFinalTaskset ||
        task?.config?.isFinal ||
        task?.ui?.isFinalTaskset ||
        task?.ui?.finalTaskset ||
        task?.ui?.isFinalTask ||
        task?.ui?.finalTask);

    if (isFinalTaskset && mode !== "review") {
      triggerTasksetVictory();
    }
    let submitOk = true;
    try {
      if (onSubmit) {
        const maybePromise = onSubmit(outgoing);
        if (maybePromise && typeof maybePromise.then === "function") {
          await maybePromise;
        }
      }
    } catch (e) {
      submitOk = false;
    }

    // Every successful task completion: play a random victory video + sound (TaskRunner-level)
    const isCompletion =
      outgoing?.completed === true ||
      outgoing?.ok === true ||
      outgoing?.type === "submit" ||
      outgoing?.final === true;

    if (submitOk && isCompletion && mode !== "review") {
      // For task types that render their own answer-reveal overlay,
      // delay the victory video so it doesn't cover the reveal.
      // Tester (Gavy, May 2026): 'overlay video obscured answer
      // overlay. probably fine but technically not timed right'.
      const ANSWER_REVEAL_TYPES = new Set([
        "sort", "vennsort", "sequence", "mad-dash-sequence",
        "matching", "timeline", "multiple-choice", "true-false",
        "cloze", "short-answer", "trivia", "fake-out", "legends",
        // peer-editing & diff-detective show a post-submit review/answer key
        // the student needs to read before the celebration covers it.
        // (Tester: "did not wait long enough for me to read it.")
        "peer-editing", "diff-detective", "labelme",
      ]);
      const delay = ANSWER_REVEAL_TYPES.has(type) ? 2500 : 0;
      if (delay > 0) {
        setTimeout(() => triggerTaskVictory(), delay);
      } else {
        triggerTaskVictory();
      }
    }
  };

  // Hangman expects socket.current; keep existing socket usage for other tasks.
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket || null;
  }, [socket]);

  const isReview = mode === "review";

  const isChoiceType = type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.TRUE_FALSE;
  const isShortType = type === TASK_TYPES.SHORT_ANSWER;

  const hasMultiItems =
    (Array.isArray(tp.items) && tp.items.length > 1) ||
    (Array.isArray(tp.questions) && tp.questions.length > 1) ||
    (Array.isArray(tp.subItems) && tp.subItems.length > 1) ||
    (Array.isArray(tp.multiQuestions) && tp.multiQuestions.length > 1);
    
  const meta = TASK_TYPE_META[type];
  const [diffRaceStatus, setDiffRaceStatus] = useState(null);

  useEffect(() => {
    if (!socket) return;

    const isDiffDetective =
      (tp.taskType || tp.type) === TASK_TYPES.DIFF_DETECTIVE ||
      (tp.taskType || tp.type) === "diff-detective";

    if (!isDiffDetective) {
      setDiffRaceStatus(null);
      return;
    }

    const handleRaceStart = (payload) => {
      setDiffRaceStatus({
        startedAt: payload.startedAt || Date.now(),
        leader: null,
        timeLeft: null,
        winnerTeamId: null,
        winnerTeamName: null,
      });
    };

    const handleRaceWinner = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        leader: payload.teamName ?? prev?.leader ?? null,
        winnerTeamId: payload.teamId ?? prev?.winnerTeamId ?? null,
        winnerTeamName: payload.teamName ?? prev?.winnerTeamName ?? null,
        winnerAt: payload.winnerAt || Date.now(),
      }));
    };

    const handleRaceTick = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        timeLeft: payload.timeLeft ?? null,
      }));
    };

    const handleRaceUpdate = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        leader: payload.teamName ?? prev?.leader ?? null,
      }));
    };

    const handleRaceFinish = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        lastFinish: {
          teamId: payload.teamId,
          teamName: payload.teamName,
          rank: payload.rank,
          correct: payload.correct,
        },
      }));
    };

    socket.on("diff:race-start", handleRaceStart);
    socket.on("diff:race-tick", handleRaceTick);
    socket.on("diff:race-update", handleRaceUpdate);

    // ✅ add this (match your server event name)
    socket.on("diff:race-winner", handleRaceWinner);

    socket.on("diff:race-end", handleRaceFinish);

    return () => {
      socket.off("diff:race-start", handleRaceStart);
      socket.off("diff:race-tick", handleRaceTick);
      socket.off("diff:race-update", handleRaceUpdate);

      // ✅ cleanup
      socket.off("diff:race-winner", handleRaceWinner);

      socket.off("diff:race-end", handleRaceFinish);
    };
  }, [socket, tp.taskType, tp.type]);

  const effectiveDisabled = disabled || submitting;

  const currentDisplay =
    Array.isArray(tp.displays) && tp.displayKey
      ? tp.displays.find((d) => d.key === tp.displayKey) || null
      : null;

  let displayTitle = "";
  if (meta?.label) displayTitle = toTitleCase(meta.label);
  else if (tp.title) displayTitle = toTitleCase(tp.title);
  else if (tp.taskType && TASK_TYPE_META[tp.taskType]?.label)
    displayTitle = toTitleCase(TASK_TYPE_META[tp.taskType].label);

  // -------------------------------------------------------------------
  // Category video: plays once for ~8s at task start, then collapses to 0 height (3s)
  // -------------------------------------------------------------------
  const categoryVideoSrc = useMemo(() => {
    return pickCategoryVideoSrc(type, tp);
  }, [
    taskKey, // easiest "new task" signal (already stable)
    type,
    tp?.ui?.categoryVideo,
    tp?.config?.ui?.categoryVideo,
    tp?.ui?.categoryAnimation,
    tp?.config?.ui?.categoryAnimation,
  ]);

  // Keep the staging video src stable for the duration of a task (prevents flicker if parent re-renders).
  const stageSrcRef = useRef(null);
  const [stageReady, setStageReady] = useState(false);

  const [stageCollapsed, setStageCollapsed] = useState(false);
  const [stageDone, setStageDone] = useState(false);
  const stageTimersRef = useRef({ t1: null, t2: null });

  useEffect(() => {
    // reset per-task
    setStageCollapsed(false);
    setStageDone(false);

    stageSrcRef.current = categoryVideoSrc || null;
    setStageReady(false);

    if (stageTimersRef.current.t1) clearTimeout(stageTimersRef.current.t1);
    if (stageTimersRef.current.t2) clearTimeout(stageTimersRef.current.t2);

    if (!(stageSrcRef.current || categoryVideoSrc)) {
      setStageDone(true);
      return;
    }

    // Only show staging in normal play mode (not review).
    if (mode !== "play") {
      setStageDone(true);
      return;
    }

    // Play for 8s, then collapse over 3s.
    stageTimersRef.current.t1 = setTimeout(() => {
      setStageCollapsed(true);
      stageTimersRef.current.t2 = setTimeout(() => {
        setStageDone(true);
      }, 3000);
    }, 8000);

    return () => {
      if (stageTimersRef.current.t1) clearTimeout(stageTimersRef.current.t1);
      if (stageTimersRef.current.t2) clearTimeout(stageTimersRef.current.t2);
    };
  }, [taskKey, mode]);

  if (meta && meta.implemented === false) {
    return (
      <div className="p-4 text-center text-red-600 space-y-2">
        <div className="font-semibold">
          ⚠ This task type is not available yet on student devices.
        </div>
        <div className="text-sm text-red-500">
          Task type: <strong>{meta.label || type}</strong>
        </div>
      </div>
    );
  }

  // Multi-item TRUE-FALSE is intentionally NOT intercepted here — it falls
  // through to its dedicated case below, which uses the polished, per-team
  // TrueFalseTask in play mode (and MultiPartTask in review). MultiPartTask was
  // shadowing that, so the dedicated component (and its correct `statement`
  // handling) never ran in play. MC + short-answer still use MultiPartTask.
  if (hasMultiItems && ((isChoiceType && type !== TASK_TYPES.TRUE_FALSE) || isShortType)) {
    const multiMode = (isChoiceType && type !== TASK_TYPES.TRUE_FALSE) ? "choice" : "short";
    return (
        <div className="h-full overflow-auto" style={{ WebkitOverflowScrolling: "touch", transform: "translateZ(0)" }}>
          <MultiPartTask
            mode={multiMode}
            readOnly={isReview}
            task={tp}
            review={review}
            onSubmit={isReview ? () => {} : handleTaskSubmit}
            submitting={submitting}
            disabled={effectiveDisabled || isReview}
            memberNames={memberNames}
          />
        </div>
    );
  }

  let content = null;

  // Paper mode: if teacher has minimizeOnScreen enabled, replace text-heavy tasks with camera
  const paperModeEnabled = !!task?.minimizeOnScreen || !!task?.config?.minimizeOnScreen;
  if (paperModeEnabled && PAPER_MODE_ELIGIBLE.has(task?.taskType)) {
    return (
      <TaskErrorBoundary title="Paper mode crashed">
        <PaperModeCamera task={task} onSubmit={onSubmit} disabled={disabled} />
      </TaskErrorBoundary>
    );
  }

  switch (type) {
    case TASK_TYPES.MOOD_CHECKIN:
    case "mood-checkin": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      content = (
        <MoodCheckInTask
          task={tp}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.TREASURE_RUNNER:
    case "treasure-runner": {
      content = (
        <TreasureRunnerTask
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.GUESS_WHO:
    case "guess-who": {
      content = (
        <GuessWhoTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.ECHO_CHAIN:
    case "echo-chain": {
      content = (
        <EchoChainInline
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;
    }

    case TASK_TYPES.NARRATION_SYNTHESIZE:
    case "narration-synthesize": {
      content = (
        <NarrationSynthesizeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
        />
      );
      break;
    }

    case TASK_TYPES.SCRIPT_PLAY:
    case "script-play": {
      content = (
        <ScriptPlayTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
          memberNames={memberNames}
        />
      );
      break;
    }

    case TASK_TYPES.ROLE_PLAY_DECK:
    case "role-play":
    case "role-play-deck":
    case "roleplay": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      content = (
        <RolePlayDeckTask
          task={tp}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.MULTIPLE_CHOICE:
      content = (
        <MultipleChoiceTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE:
      content = (
        <PhysicalMultipleChoiceTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          excludedColor={tp?.stationColor || tp?.config?.stationColor || null}
          excludedColors={[tp?.nextStationColor].filter(Boolean)}
          scannerSlot={scannerSlot}
          practiceMode={practiceMode}
          requireRealScans={requireRealScans}
          onIncorrectScan={() => {
            try {
              const fn = window.__curriculatePlayWrongSound;
              if (typeof fn === "function") fn();
            } catch {}
          }}
        />
      );
      break;

    case TASK_TYPES.TRUE_FALSE:
      // In review mode, keep the canonical MultiPart renderer so teachers can see the correct/selected overlay.
      // In play mode, use the dedicated TrueFalseTask for a more polished, deterministic (per-team) UI.
      if (isReview) {
        content = (
          <MultiPartTask
            mode="choice"
            readOnly={isReview}
            task={tp}
            review={review}
            onSubmit={null}
            submitting={submitting}
            disabled={true}
          />
        );
      } else {
        content = (
          <TrueFalseTask
            task={tp}
            onSubmit={handleTaskSubmit}
            disabled={effectiveDisabled}
            onAnswerChange={onAnswerChange}
            answerDraft={answerDraft}
            memberNames={memberNames}
          />
        );
      }
      break;

    case TASK_TYPES.VENNSORT:
    case "vennsort":
    case "venn-sort":
      content = (
        <VennSortTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

case TASK_TYPES.MULTI_PLAYER_FEEDBACK:
case "multi-player-feedback":
case "multi_player_feedback":
  content = (
    <MultiPlayerFeedbackTask
      roomCode={roomCode}
      teamId={
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null
      }
      teamName={
        t?.teamName ||
        playerTeam?.name ||
        playerTeam?.teamName ||
        null
      }
      socket={socket}
      onSubmit={handleTaskSubmit}
      savedEmails={savedEmails}
      onEmailsChange={onEmailsChange}
    />
  );
  break;


    case TASK_TYPES.SORT:
      content = (
        <SortTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.SEQUENCE:
      content = (
        <SequenceTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.MATCHING:
    case "matching":
      content = (
        <MatchingTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.MAPIT:
    case "mapit":
      content = (
        <MapItTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          onAnswerChange={onAnswerChange}
        />
      );
      break;

    case TASK_TYPES.LABELME:
    case "labelme":
      content = (
        <LabelMeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.PHOTO:
      content = (
        <PhotoTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.PHOTO_JOURNAL:
    case "photo-journal":
      content = (
        <PhotoJournalTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.ART_VIEW:
      content = (
        <ArtViewTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.HISTORICAL_DOC:
      content = (
        <HistoricalDocTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.MAKE_AND_SNAP:
      content = (
        <MakeAndSnapTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
    case TASK_TYPES.DRAW_MIME:
      content = (
        <DrawMimeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          memberNames={memberNames}
          startGoSequence={presenter?.showCountdown ? async ({ seconds = 3, label = "1-2-3 GO!" } = {}) => {
            await presenter.showCountdown({
              title: "Get ready",
              seconds,
              subtext: label,
            });
          } : undefined}
          emitTaskEvent={(name, payload) => {
            try {
              socket?.emit?.(name, payload);
            } catch {}
          }}
          playSfx={(name) => {
            try {
              if (name === "yourTurn") {
                const a = new Audio("/sounds/your-turn.mp3");
                a.play().catch(() => {});
              } else if (name === "go") {
                const a = new Audio("/sounds/go.mp3");
                a.play().catch(() => {});
              }
            } catch {}
          }}
        />
      );
      break;

    case TASK_TYPES.BODY_BREAK:
      content = (
        <BodyBreakTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.OPEN_TEXT: {
      const kind = String(tp?.config?.kind || tp?.config?.mode || "").toLowerCase();
      const isVocab = kind === "vocabulary-paragraph" || kind === "vocab-paragraph" || kind === "vocabulary";

      content = isVocab ? (
        <VocabularyTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          memberNames={memberNames}
        />
      ) : (
        <OpenTextTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          memberNames={memberNames}
        />
      );
      break;
    }
    
    case TASK_TYPES.LETTER:
      content = (
        <LetterTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          roomCode={roomCode}
          teamId={derivedTeamId}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.CASE_STUDY:
    case "case-study":
    case "case_study":
    case "caseStudy":
      content = (
        <CaseStudyTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          roomCode={roomCode}
          teamId={derivedTeamId}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.STORYTELLING:
    case "storytelling":
      content = (
        <StorytellingTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          roomCode={roomCode}
          teamId={derivedTeamId}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.RECORD_AUDIO:
      content = (
        <RecordAudioTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.SPEECH_RECOGNITION:
      content = (
        <SpeechRecognitionTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.JEOPARDY:
      content = (
        <BrainBlitzTask
          task={tp}
          onSubmit={isReview ? () => {} : handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={isReview ? null : socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.PRONUNCIATION:
      content = (
        <PronunciationTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;

    case TASK_TYPES.WORD_WEAVER_DUEL:
    case "word-weaver-duel": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      content = (
        <WordWeaverDuelTask
          task={tp}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;
    }

    case TASK_TYPES.SHORT_ANSWER:
      content = (
        <ShortAnswerTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
        />
      );
      break;

    
    case TASK_TYPES.READING_COMP: {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      content = (
        <ReadingCompTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          isMultiplayer={Boolean(roomCode)}
          raceStatus={null}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          roomCode={roomCode}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;
    }

case TASK_TYPES.COLLABORATION:
      content = (
        <CollaborationTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          partnerAnswer={partnerAnswer}
          showPartnerReply={showPartnerReply}
          onPartnerReply={onPartnerReply}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.MUSICAL_CHAIRS:
      content = (
        <MusicalChairsTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          practiceMode={practiceMode}
          requireRealScans={requireRealScans}
        />
      );
      break;

    case TASK_TYPES.MYSTERY_CLUES:
      content = (
        <MysteryCluesTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} practiceMode={practiceMode} />
      );
      break;

    case TASK_TYPES.FAKE_OUT:
      content = (
        <FakeOutTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.TRUE_FALSE_TICTACTOE:
      content = (
        <TrueFalseTicTacToeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          teamRole={t.teamRole}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
          remainingMs={remainingMs}
          timeLimitSeconds={t.timeLimitSeconds || tp.timeLimitSeconds}
        />
      );
      break;

    case TASK_TYPES.TRUE_FALSE_CONNECT_FOUR:
      content = (
        <TrueFalseConnectFourTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          teamRole={t.teamRole}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
          remainingMs={remainingMs}
          timeLimitSeconds={t.timeLimitSeconds || tp.timeLimitSeconds}
        />
      );
      break;


case TASK_TYPES.TOWER_BUILDER:
      content = (
        <TowerBuilderTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          memberNames={memberNames}
          remainingMs={remainingMs}
          timeLimitSeconds={t.timeLimitSeconds || tp.timeLimitSeconds}
        />
      );
      break;

case TASK_TYPES.MAD_DASH:
  content = (
    <MadDashTask
      task={tp}
      onSubmit={handleTaskSubmit}
      disabled={effectiveDisabled}
      memberNames={memberNames}
      practiceMode={practiceMode}
      requireRealScans={requireRealScans}
    />
  );
  break;

case TASK_TYPES.MAD_DASH_SEQUENCE:
  content = (
    <MadDashSequenceTask
      task={tp}
      onSubmit={handleTaskSubmit}
      disabled={effectiveDisabled}
      socket={socket}
      practiceMode={practiceMode}
      requireRealScans={requireRealScans}
    />
  );
  break;

    case TASK_TYPES.LIVE_DEBATE:
      content = (
        <LiveDebateTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          memberNames={memberNames}
          teamMembers={t.teamMembers}
        />
      );
      break;

    case TASK_TYPES.AI_DEBATE_JUDGE:
      content = (
        <AIDebateJudgeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.FLASHCARDS:
      content = (
        <FlashcardsTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.FLASHCARDS_RACE:
      content = (
        <FlashcardsRaceTask
          task={tp}
          onSubmit={handleTaskSubmit}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
          disabled={effectiveDisabled || isReview}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.TIMELINE:
      content = (
        <TimelineTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.PET_FEEDING:
      content = (
        <PetFeedingTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.MOTION_MISSION:
      content = (
        <MotionMissionTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} remainingMs={remainingMs} />
      );
      break;

    case TASK_TYPES.BRAINSTORM_BATTLE:
      content = (
        <BrainstormBattleTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.MIND_MAPPER:
      content = (
        <MindMapperTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.SPEED_DRAW:
      content = (
        <SpeedDrawTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;

    case TASK_TYPES.DIFF_DETECTIVE:
      content = (
        <DiffDetectiveTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          raceStatus={diffRaceStatus}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          memberNames={memberNames}
        />
      );
      break;

    case TASK_TYPES.BRAIN_SPARK_NOTES:
      content = (
        <BrainSparkNotesInline task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.HIDENSEEK:
      content = (
        <HideNSeekTask task={tp} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.HANGMAN_DUEL:
    case "hangman-duel": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      const stationIndex = Number.isFinite(t?.stationIndex) ? t.stationIndex : null;

      const wordFromItems =
        Array.isArray(t?.items) && stationIndex != null
          ? (t.items?.[stationIndex]?.word ||
              t.items?.[stationIndex]?.hangmanWord ||
              t.items?.[stationIndex]?.answer ||
              t.items?.[stationIndex]?.value)
          : null;

      const wordFallback =
        t?.word ||
        t?.hangmanWord ||
        t?.data?.word ||
        wordFromItems ||
        (Array.isArray(t?.options) ? t.options?.[0] : null) ||
        t?.correctAnswer ||
        t?.displayKey ||
        "";

      const tFixed = { ...tp, word: wordFallback };

      content = (
        <HangmanDuelTask
          task={tFixed}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          practiceMode={practiceMode}
        />
      );
      break;
    }

    case TASK_TYPES.TRIVIA:
    case "trivia": {
      content = (
        <TriviaTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.SPINNER:
    case "spinner": {
      content = (
        <SpinnerTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.RIDDLE:
    case "riddle": {
      content = (
        <RiddleTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.WHAT_AM_I:
    case "what-am-i": {
      content = (
        <WhatAmITask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          teamId={derivedTeamId}
          taskIndex={taskIndex}
        />
      );
      break;
    }

    case TASK_TYPES.QUEST:
    case "quest": {
      content = (
        <QuestTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          teamId={derivedTeamId}
          taskIndex={taskIndex}
          practiceMode={practiceMode}
        />
      );
      break;
    }

    case TASK_TYPES.CURRENT_EVENTS:
    case "current-events": {
      content = (
        <CurrentEventsTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          practiceMode={practiceMode}
        />
      );
      break;
    }

    case TASK_TYPES.CAREERS:
    case "careers": {
      content = (
        <CareersTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.HOLE_IN_ONE:
    case "hole-in-one": {
      content = (
        <HoleInOneTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.LEGENDS:
    case "legends": {
      content = (
        <LegendsTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    }

    case TASK_TYPES.TRUTH_OR_DARE:
    case "truth-or-dare": {
      content = (
        <TruthOrDareTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          teamId={derivedTeamId}
          taskIndex={taskIndex}
          practiceMode={practiceMode}
        />
      );
      break;
    }

    case TASK_TYPES.TEAM_SELFIE:
    case "team-selfie": {
      content = (
        <TeamSelfieTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
        />
      );
      break;
    }

    case TASK_TYPES.PEER_EDITING:
    case "peer-editing": {
      content = (
        <PeerEditingTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.INTERVIEW:
    case "interview": {
      content = (
        <InterviewTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.CLOZE:
    case "cloze": {
      content = (
        <ClozeTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.TEACH_BACK:
    case "teach-back": {
      content = (
        <TeachBackTask
          task={tp}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    default:
      return (
        <div className="p-4 text-center text-red-600 space-y-2">
          <div className="font-semibold">⚠ Unsupported task type from server.</div>
          <div className="text-sm text-red-500">
            Received type: <strong>{String(type)}</strong>
          </div>
        </div>
      );
  }


  // Inject shared presenter API into every task component (no per-task edits needed).
  if (content && React.isValidElement(content)) {
    try {
      content = React.cloneElement(content, {
        presenter,
        registerScanHandler: registerTaskScanHandler,
        unregisterScanHandler: unregisterTaskScanHandler,
      });

    } catch (_) {}
  }
// --- Skip task feature ---
// Non-skippable task types (meta/feedback tasks that aren't real academic tasks)
const SKIP_EXCLUDED_TYPES = new Set([
  TASK_TYPES.MOOD_CHECKIN, "mood-checkin",
  TASK_TYPES.MULTI_PLAYER_FEEDBACK, "multi-player-feedback", "feedback",
  TASK_TYPES.BODY_BREAK, "body-break",
]);
const canSkip = mode === "play" && !isReview && !effectiveDisabled && !SKIP_EXCLUDED_TYPES.has(type);
// Persist the in-progress skip-reason text to localStorage so an
// accidental refresh mid-typing doesn't lose what the user wrote.
// Keyed per (roomCode, taskType) — practice mode uses roomCode "DEMO".
const skipDraftKey = `cw_skip_v1:${roomCode || "DEMO"}:${type || "unknown"}`;
const skipDraftInitial = (() => {
  try {
    return localStorage.getItem(skipDraftKey) || "";
  } catch {
    return "";
  }
})();
const [showSkipDialog, setShowSkipDialog] = useState(false);
const [skipReason, setSkipReason] = useState(skipDraftInitial);
const [skipSubmitting, setSkipSubmitting] = useState(false);

// Save every keystroke; clear on submit or explicit cancel.
useEffect(() => {
  try {
    if (skipReason && skipReason.length > 0) {
      localStorage.setItem(skipDraftKey, skipReason);
    } else {
      localStorage.removeItem(skipDraftKey);
    }
  } catch {}
}, [skipReason, skipDraftKey]);

const handleSkipTask = async () => {
  if (!skipReason.trim()) return;
  setSkipSubmitting(true);
  try {
    await handleTaskSubmit({
      skipped: true,
      skipReason: skipReason.trim().slice(0, 300),
      points: 0,
      answer: null,
      isCorrect: false,
    });
  } catch {}
  setSkipSubmitting(false);
  setShowSkipDialog(false);
  setSkipReason("");
  try { localStorage.removeItem(skipDraftKey); } catch {}
};

// (No auto-open — the draft just sits in state, ready in the textarea
// the next time the user clicks Skip on this task.  Auto-popping the
// dialog on every task with a leftover draft would be overkill.)

const showVictory = (taskVictory?.key || tasksetVictoryKey) && mode !== "review";
const showStageVideo = categoryVideoSrc && !stageDone && mode === "play";

return (
  <div className="h-full flex flex-col relative">
    {showVictory ? (
      <div
        key={taskVictory?.key || tasksetVictoryKey}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <style>{`
              @keyframes trConfettiFall {
                0% { transform: translateY(-20px) rotate(0deg); opacity: 0; }
                10% { opacity: 1; }
                100% { transform: translateY(920px) rotate(540deg); opacity: 0; }
              }
              @keyframes trPop {
                0% { transform: scale(0.95); opacity: 0; }
                15% { transform: scale(1); opacity: 1; }
                100% { transform: scale(1); opacity: 0; }
              }
            `}</style>

            {/* Victory video */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(2,6,23,0.55)",
                backdropFilter: "blur(6px)",
              }}
            />

            <div
              style={{
                position: "relative",
                width: "min(900px, 92vw)",
                borderRadius: 22,
                overflow: "hidden",
                boxShadow: "0 18px 60px rgba(2,6,23,0.45)",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              <video
                autoPlay
                playsInline
                muted
                preload="auto"
                onCanPlay={() => {
                  // Mark when the video is actually visible/ready so we keep the overlay long enough.
                  if (!victoryCanPlayAt) setVictoryCanPlayAt(Date.now());
                }}
                onEnded={() => {
                  // No timed dismiss: keep victory overlay up until the video finishes.
                  try {
                    if (tasksetVictoryKey) setTasksetVictoryKey(null);
                    if (taskVictory?.key) setTaskVictory(null);
                  } catch (_) {}
                  setVictoryCanPlayAt(null);
                }}
                style={{ width: "100%", height: "auto", display: "block" }}
              >
                <source src={taskVictory?.src || "/victory.mp4"} type="video/mp4" />
                <source src="/animations/victory/victory-1.mp4" type="video/mp4" />
              </video>
              <div
                style={{
                  position: "absolute",
                  top: 14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "10px 14px",
                  borderRadius: 16,
                  background: "rgba(34,197,94,0.16)",
                  border: "1px solid rgba(34,197,94,0.35)",
                  color: "#ecfdf5",
                  fontWeight: 950,
                  letterSpacing: 0.4,
                  animation: "trPop 1400ms ease-out forwards",
                  textShadow: "0 2px 10px rgba(0,0,0,0.25)",
                }}
              >
                🏁 Task Set Complete!
              </div>
            </div>

            {/* Confetti */}
            {Array.from({ length: 42 }).map((_, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  top: -10,
                  left: `${(i * 83) % 100}%`,
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a78bfa"][i % 5],
                  animation: `trConfettiFall ${3200 + (i % 10) * 180}ms ease-in forwards`,
                }}
              />
            ))}
          </div>
    ) : null}

    {showStageVideo ? (
      <div
        style={{
          width: "55vw",
          maxWidth: 900,
          minWidth: 320,
          marginLeft: "auto",
          marginRight: "auto",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(15,23,42,0.10)",
          boxShadow: "0 10px 30px rgba(2,6,23,0.08)",
          background: "rgba(0,0,0,0.85)",
          maxHeight: stageCollapsed ? 0 : 520,
          transition: "max-height 3s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <video
          src={stageSrcRef.current || categoryVideoSrc}
          preload="auto"
          muted
          playsInline
          style={{ display: "none" }}
        />
        <video
          key={`stagevid:${taskKey}`}
          src={stageSrcRef.current || categoryVideoSrc}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onLoadedData={() => setStageReady(true)}
          onCanPlay={() => setStageReady(true)}
          style={{
            opacity: stageReady ? 1 : 0,
            transition: "opacity 250ms ease",
            width: "100%",
            height: "auto",
            display: "block",
            objectFit: "contain",
            background: "#000",
            transformOrigin: "top",
          }}
          onEnded={() => {
            setStageCollapsed(true);
            window.setTimeout(() => setStageDone(true), 3000);
          }}
          onError={() => setStageDone(true)}
        />
      </div>
    ) : null}

    {presenterOverlay?.kind === "countdown" ? (
      <div
        key={presenterOverlay.key}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 9000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(2,6,23,0.55)",
          backdropFilter: "blur(6px)",
        }}
        onClick={() => hidePresenter({ ok: false, reason: "clicked" })}
      >
        <div
          style={{
            width: "min(520px, 92vw)",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(15,23,42,0.92)",
            color: "#fff",
            padding: 18,
            boxShadow: "0 18px 60px rgba(2,6,23,0.45)",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 8 }}>
            {presenterOverlay.title}
          </div>
          <div style={{ opacity: 0.9, marginBottom: 12 }}>
            {presenterOverlay.subtext}
          </div>

          <SmoothCountdownBar
            durationMs={presenterOverlay.seconds * 1000}
            running={true}
            resetKey={presenterOverlay.key}
            height={12}
            onDone={() => hidePresenter({ ok: true })}
          />
        </div>
      </div>
    ) : null}

    <div className="flex-1 min-h-0 overflow-auto" style={{ WebkitOverflowScrolling: "touch", transform: "translateZ(0)" }}>
      {/* Coach mode: non-writers get a tap-to-peek hint panel */}
      {content && !isReview && !COACH_MODE_SKIP.has(type) && memberNames.length >= 2 && (
        <CoachPanel
          task={tp}
          memberNames={memberNames}
          taskIndex={typeof taskIndex === "number" ? taskIndex : undefined}
        />
      )}
      {content ? (
        <TaskErrorBoundary title={(tp?.title || tp?.name || type || "Task")}>
          {content}
        </TaskErrorBoundary>
      ) : null}
    </div>

    {/* Skip task button — small, bottom-right, requires a reason */}
    {canSkip && !showSkipDialog && (
      <button
        onClick={() => setShowSkipDialog(true)}
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          zIndex: 50,
          padding: "6px 14px",
          borderRadius: 999,
          border: "1px solid rgba(15,23,42,0.15)",
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(4px)",
          color: "#64748b",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          opacity: 0.7,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.target.style.opacity = "1")}
        onMouseLeave={(e) => (e.target.style.opacity = "0.7")}
      >
        Skip task
      </button>
    )}

    {/* Skip reason dialog — uses position:fixed to escape overflow:auto parent */}
    {showSkipDialog && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(2,6,23,0.45)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) { setShowSkipDialog(false); setSkipReason(""); } }}
      >
        <div
          style={{
            width: "min(420px, 92vw)",
            borderRadius: 20,
            background: "#fff",
            color: "#0f172a",
            border: "1px solid rgba(15,23,42,0.12)",
            boxShadow: "0 16px 50px rgba(2,6,23,0.25)",
            padding: 20,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 950, fontSize: 17, marginBottom: 4, color: "#0f172a" }}>
            Skip this task?
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14, lineHeight: 1.4 }}>
            You'll receive <strong>0 points</strong> for this task.
            Your teacher will see that you skipped and your reason why.
          </div>
          <textarea
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="Why are you skipping? (required)"
            maxLength={300}
            rows={3}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: 12,
              borderRadius: 12,
              border: "1.5px solid rgba(15,23,42,0.18)",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
              background: "#fff",
              color: "#0f172a",
              WebkitAppearance: "none",
            }}
            autoFocus
          />
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, textAlign: "right" }}>
            {skipReason.length}/300
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                // "Go back" just closes the dialog — keeps the draft so
                // accidental closes don't lose work.  The user will
                // see the same text the next time they click Skip on
                // this task.  An explicit submit clears it.
                setShowSkipDialog(false);
              }}
              style={{
                padding: "8px 18px",
                borderRadius: 10,
                border: "1px solid rgba(15,23,42,0.15)",
                background: "#fff",
                color: "#0f172a",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Go back
            </button>
            <button
              onClick={handleSkipTask}
              disabled={!skipReason.trim() || skipSubmitting}
              style={{
                padding: "8px 18px",
                borderRadius: 10,
                border: "none",
                background: !skipReason.trim() ? "#e2e8f0" : "#ef4444",
                color: !skipReason.trim() ? "#94a3b8" : "#fff",
                fontWeight: 800,
                fontSize: 13,
                cursor: !skipReason.trim() ? "not-allowed" : "pointer",
              }}
            >
              {skipSubmitting ? "Skipping…" : "Skip — 0 points"}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
};
