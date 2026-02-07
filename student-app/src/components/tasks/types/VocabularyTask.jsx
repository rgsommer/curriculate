// student-app/src/components/tasks/types/VocabularyTask.jsx
import React, { useEffect, useMemo, useState } from "react";

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

  const statusLine = (() => {
    if (!hasSufficientTargetList) {
      return (
        <span className="text-amber-200">
          Task misconfigured: needs at least {MIN_INCLUDED_TARGET_WORDS} vocab words.
        </span>
      );
    }
    if (!hasAtLeastFiveTargets) {
      return (
        <span className="text-amber-200">
          Include at least{" "}
          <span className="font-semibold">{MIN_INCLUDED_TARGET_WORDS}</span> target
          words to unlock submit.
        </span>
      );
    }
    if (analysis.missingCount > 0) {
      return (
        <span className="text-amber-200">
          Missing: <span className="font-semibold">{analysis.missingCount}</span>
        </span>
      );
    }
    return (
      <span className="text-emerald-200">
        All words included — ready to submit ✅
      </span>
    );
  })();

  return (
    <div className="w-full">
      <div className="rounded-2xl p-4 md:p-5 shadow-sm border border-white/10 bg-white/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm opacity-80">Vocab Weave</div>
            <div className="text-xl md:text-2xl font-semibold leading-tight">
              One paragraph. Every word.
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs opacity-70">Words used</div>
            <div className="text-lg font-semibold">
              {analysis.usedCount}/{requiredWords.length}
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm leading-relaxed opacity-90">
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
                  "px-3 py-1 rounded-full text-sm border",
                  ok
                    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-100"
                    : "bg-amber-500/10 border-amber-400/30 text-amber-100",
                ].join(" ")}
              >
                {w}
              </span>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs opacity-80">
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

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3 md:p-4 shadow-sm">
        <textarea
          className="w-full min-h-[180px] md:min-h-[220px] rounded-xl bg-black/20 border border-white/10 p-3 md:p-4 text-sm md:text-base outline-none focus:ring-2 focus:ring-white/20"
          placeholder="Write your paragraph here…"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled || answered}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs opacity-70">
            Tip: Make it sound natural — not like a word list.
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={[
              "px-4 py-2 rounded-xl text-sm font-semibold shadow-sm border transition",
              canSubmit
                ? "bg-white/15 hover:bg-white/20 border-white/20"
                : "bg-white/5 border-white/10 opacity-50 cursor-not-allowed",
            ].join(" ")}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
