// student-app/src/components/tasks/types/VocabularyTask.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useThemeMode } from "../../../utils/ThemeModeContext.js";

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a matcher that allows:
// 1) exact word + suffixes
// 2) partial/stem substring match (fallback)
function buildWordMatcher(word) {
  const raw = String(word || "").trim();
  if (!raw) return null;

  const esc = escapeRegex(raw);

  // Strict: word boundary + suffixes
  const strictSuffix = "(?:'s|s|es|ed|ing)?";
  const strict = new RegExp(
    `(^|[^a-zA-Z0-9])${esc}${strictSuffix}($|[^a-zA-Z0-9])`,
    "i"
  );

  // Loose: substring (for stem matches like reconcil → reconciliation)
  const loose = new RegExp(esc, "i");

  return (text) => strict.test(text) || loose.test(text);
}

export default function VocabularyTask({
  task,
  disabled,
  answered,
  onSubmit,
  onAnswerChange,
  answerDraft,
}) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const requiredWords = useMemo(() => {
    const cfg = task?.config || {};
    const words =
      cfg.requiredWords ||
      cfg.words ||
      cfg.vocabulary ||
      task?.requiredWords ||
      task?.words ||
      [];
    return Array.isArray(words)
      ? words.map((w) => String(w || "").trim()).filter(Boolean).slice(0, 10)
      : [];
  }, [task]);

  const [text, setText] = useState(
    typeof answerDraft === "string" ? answerDraft : task?.answerDraft || ""
  );

  useEffect(() => {
    if (typeof answerDraft === "string" && answerDraft !== text) setText(answerDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerDraft]);

  const analysis = useMemo(() => {
    const t = String(text || "");
    const used = [];
    const missing = [];

    for (const w of requiredWords) {
      const match = buildWordMatcher(w);
      if (match && match(t)) used.push(w);
      else missing.push(w);
    }

    return {
      used,
      missing,
      usedCount: used.length,
      missingCount: missing.length,
    };
  }, [text, requiredWords]);

  const minWords = Number(task?.config?.minWords ?? 45);
  const maxWords = Number(task?.config?.maxWords ?? 140);

  const wordCount = useMemo(() => {
    const parts = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return parts.length;
  }, [text]);

  const withinLength =
    (minWords ? wordCount >= minWords : true) &&
    (maxWords ? wordCount <= maxWords : true);

  const MIN_INCLUDED_TARGET_WORDS = 5;
  const hasAtLeastFiveTargets = analysis.usedCount >= MIN_INCLUDED_TARGET_WORDS;
  const hasSufficientTargetList = requiredWords.length >= MIN_INCLUDED_TARGET_WORDS;

  const canSubmit =
    !disabled &&
    !answered &&
    hasSufficientTargetList &&
    hasAtLeastFiveTargets &&
    analysis.missingCount === 0 &&
    withinLength &&
    String(text || "").trim().length > 0;

  const handleChange = (v) => {
    setText(v);
    onAnswerChange?.(v);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit?.({
      type: task?.taskType || "open-text",
      kind: "vocabulary-paragraph",
      answer: text,
      requiredWords,
      usedWords: analysis.used,
      missingWords: analysis.missing,
      wordCount,
    });
  };

  const warnColor = isDark ? "text-amber-200" : "text-amber-700";
  const goodColor = isDark ? "text-emerald-200" : "text-emerald-700";

  const statusLine = (() => {
    if (!hasSufficientTargetList) {
      return (
        <span className={warnColor}>
          Task misconfigured: needs at least {MIN_INCLUDED_TARGET_WORDS} vocab words.
        </span>
      );
    }
    if (!hasAtLeastFiveTargets) {
      return (
        <span className={warnColor}>
          Include at least{" "}
          <span className="font-semibold">{MIN_INCLUDED_TARGET_WORDS}</span> target
          words to unlock submit.
        </span>
      );
    }
    if (analysis.missingCount > 0) {
      return (
        <span className={warnColor}>
          Missing: <span className="font-semibold">{analysis.missingCount}</span>
        </span>
      );
    }
    return (
      <span className={goodColor}>
        All words included — ready to submit ✅
      </span>
    );
  })();

  const handlePaste = useCallback((e) => {
    e.preventDefault();
  }, []);

  // Theme-aware colors
  const pillOk = isDark
    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-100"
    : "bg-emerald-100 border-emerald-400 text-emerald-800";
  const pillMissing = isDark
    ? "bg-amber-500/10 border-amber-400/30 text-amber-100"
    : "bg-amber-100 border-amber-400 text-amber-800";

  const cardBg = isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white/80";
  const textAreaBg = isDark
    ? "bg-black/20 border-white/10 text-white placeholder-white/40 focus:ring-white/20"
    : "bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-slate-400/30";
  const bodyText = isDark ? "" : "text-slate-800";
  const mutedText = isDark ? "opacity-80" : "text-slate-600";
  const mutedTextXs = isDark ? "opacity-70" : "text-slate-500";
  const inputAreaBg = isDark ? "border-white/10 bg-black/10" : "border-slate-200 bg-slate-50";
  const submitEnabled = isDark
    ? "bg-white/15 hover:bg-white/20 border-white/20"
    : "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white";
  const submitDisabled = isDark
    ? "bg-white/5 border-white/10 opacity-50 cursor-not-allowed"
    : "bg-slate-200 border-slate-300 text-slate-400 opacity-60 cursor-not-allowed";

  return (
    <div className={`w-full ${bodyText}`}>
      <div className={`rounded-2xl p-4 md:p-5 shadow-sm border ${cardBg}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={`text-sm ${mutedText}`}>Vocab Weave</div>
            <div className="text-xl md:text-2xl font-semibold leading-tight">
              One paragraph. Every word.
            </div>
          </div>

          <div className="text-right">
            <div className={`text-xs ${mutedTextXs}`}>Words used</div>
            <div className="text-lg font-semibold">
              {analysis.usedCount}/{requiredWords.length}
            </div>
          </div>
        </div>

        <div className={`mt-3 text-sm leading-relaxed ${mutedText}`}>
          Write <span className="font-semibold">one coherent paragraph</span> that
          uses <span className="font-semibold">every vocabulary word</span> below at
          least once. Correct form (plural/tense) is allowed.
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {requiredWords.map((w) => {
            const ok = analysis.used.includes(w);
            return (
              <span
                key={w}
                className={[
                  "px-3 py-1 rounded-full text-sm border font-medium",
                  ok ? pillOk : pillMissing,
                ].join(" ")}
              >
                {w}
              </span>
            );
          })}
        </div>

        <div className={`mt-3 flex flex-wrap items-center gap-3 text-xs ${mutedText}`}>
          <span>
            Target length:{" "}
            <span className="font-semibold">
              {minWords}–{maxWords} words
            </span>
          </span>
          <span>
            Current: <span className="font-semibold">{wordCount}</span>
          </span>
          {statusLine}
        </div>
      </div>

      <div className={`mt-4 rounded-2xl border ${inputAreaBg} p-3 md:p-4 shadow-sm`}>
        <textarea
          className={`w-full min-h-[180px] md:min-h-[220px] rounded-xl border p-3 md:p-4 text-sm md:text-base outline-none focus:ring-2 ${textAreaBg}`}
          placeholder="Write your paragraph here…"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={handlePaste}
          disabled={disabled || answered}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className={`text-xs ${mutedTextXs}`}>
            Tip: Make it sound natural — not like a word list.
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={[
              "px-4 py-2 rounded-xl text-sm font-semibold shadow-sm border transition",
              canSubmit ? submitEnabled : submitDisabled,
            ].join(" ")}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
