// student-app/src/components/tasks/types/CareersTask.jsx
//
// Unified renderer for the "careers" task type (CAREERS_TASK_PLAN.md).
// Switches on `config.mode` to render one of six discussion-driven mini-tasks.
// All six modes share a final pattern: scenario card(s) → optional pick → required
// justification text → submit. Mode-specific UI lives inside the switch.
//
// Modes (locked-in by spec §3):
//   best-fit | pathway-builder | aptitude-match
//   salary-vs-lifestyle | who-should-be-hired | career-myths
//
// Anti-toxicity (CAREERS_TASK_PLAN.md §7):
//   - Best Fit picks are PRIVATE — submitted per-player, never displayed publicly.
//   - "Worst fit" is never a prompt.
//   - Free-text justifications are submitted as-is; profanity filtering is server-side.
import React, { useMemo, useState } from "react";

const MODE_LABELS = {
  "best-fit": "Best Fit",
  "pathway-builder": "Pathway Builder",
  "aptitude-match": "Aptitude Match",
  "salary-vs-lifestyle": "Salary vs Lifestyle",
  "who-should-be-hired": "Who Should Be Hired",
  "career-myths": "Career Myths",
};

export default function CareersTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};
  const mode = String(cfg.mode || "best-fit");

  const [pick, setPick] = useState(null);           // Selected option / candidate / pathway
  const [justification, setJustification] = useState("");
  const [revealedMyths, setRevealedMyths] = useState({}); // mode "career-myths": id → guess

  const minJustChars = mode === "aptitude-match" ? 0 : 20;
  const canSubmit = !disabled && (
    mode === "aptitude-match"
      ? Object.keys(revealedMyths).length > 0 || justification.trim().length > 0
      : mode === "career-myths"
        ? Object.keys(revealedMyths).length >= (Array.isArray(cfg.questions) ? cfg.questions.length : 1)
        : pick !== null && justification.trim().length >= minJustChars
  );

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (onSubmit) {
      onSubmit({
        type: "careers",
        mode,
        pick,
        justification: justification.trim(),
        responses: revealedMyths,
        autoComplete: true,
      });
    }
  };

  /* ──────────────── Mode-specific renders ──────────────── */
  let content;
  if (mode === "best-fit") {
    const career = cfg.career || {};
    const teammates = Array.isArray(cfg.teammates) ? cfg.teammates : [];
    content = (
      <>
        <div style={cardWrap}>
          <div style={cardLabel}>Career: {career.name || "—"}</div>
          {career.description ? <p style={bodyText}>{career.description}</p> : null}
          {Array.isArray(career.traits) && career.traits.length > 0 ? (
            <ul style={{ margin: "8px 0 0 0", paddingLeft: 18, color: "#cbd5e1" }}>
              {career.traits.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
            </ul>
          ) : null}
        </div>
        <div style={cardLabel}>Which teammate would thrive in this role?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(teammates.length > 0 ? teammates : ["Teammate 1", "Teammate 2", "Teammate 3"]).map((name) => (
            <label key={name} style={{ ...pickRow, ...(pick === name ? pickRowSelected : {}) }}>
              <input type="radio" name="bestFit" value={name} checked={pick === name} onChange={() => setPick(name)} />
              <span style={{ marginLeft: 8 }}>{name}</span>
            </label>
          ))}
          <label style={{ ...pickRow, ...(pick === "__other" ? pickRowSelected : {}) }}>
            <input type="radio" name="bestFit" value="__other" checked={pick === "__other"} onChange={() => setPick("__other")} />
            <span style={{ marginLeft: 8 }}>Someone else / not pictured</span>
          </label>
        </div>
        <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 6 }}>
          {teammates.length > 0
            ? <>Your pick is <strong>private</strong> — in class, each student picks on their own device, so no teammate sees who picked whom.</>
            : <>Just you here in practice — in a real class, each student would pick <strong>privately</strong> on their own device.</>}
        </div>
      </>
    );
  } else if (mode === "pathway-builder") {
    const career = String(cfg.targetCareer || cfg.career?.name || "this career");
    const pathways = Array.isArray(cfg.pathways) ? cfg.pathways : [];
    content = (
      <>
        <div style={cardLabel}>Pathways to {career}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pathways.map((p, i) => (
            <button
              key={p.id || i}
              type="button"
              onClick={() => setPick(p.id || p.name)}
              style={{ ...optionCard, ...(pick === (p.id || p.name) ? optionCardSelected : {}) }}
            >
              <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{p.name}</div>
              <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 4 }}>
                {[
                  p.years ? `${p.years}y` : null,
                  p.costRange || null,
                  p.salaryRange ? `Salary: ${p.salaryRange}` : null,
                  p.flexibility ? `Flex: ${"★".repeat(Math.min(5, Number(p.flexibility) || 1))}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {p.notes ? <div style={{ fontSize: "0.8rem", color: "#cbd5e1", marginTop: 4 }}>{p.notes}</div> : null}
            </button>
          ))}
        </div>
      </>
    );
  } else if (mode === "who-should-be-hired") {
    const role = String(cfg.role || "the role");
    const candidates = Array.isArray(cfg.candidates) ? cfg.candidates : [];
    content = (
      <>
        <div style={cardLabel}>Who would you hire for {role}?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {candidates.map((c, i) => (
            <button
              key={c.id || i}
              type="button"
              onClick={() => setPick(c.id || c.name)}
              style={{ ...optionCard, ...(pick === (c.id || c.name) ? optionCardSelected : {}) }}
            >
              <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{c.name}</div>
              {c.summary ? <div style={{ fontSize: "0.82rem", color: "#cbd5e1", marginTop: 4 }}>{c.summary}</div> : null}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {(Array.isArray(c.strengths) ? c.strengths : []).slice(0, 3).map((s, j) => (
                  <span key={j} style={tagOk}>+ {s}</span>
                ))}
                {(Array.isArray(c.weaknesses) ? c.weaknesses : []).slice(0, 2).map((w, j) => (
                  <span key={j} style={tagWarn}>- {w}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </>
    );
  } else if (mode === "salary-vs-lifestyle") {
    const a = cfg.optionA || {};
    const b = cfg.optionB || {};
    content = (
      <>
        <div style={cardLabel}>Two paths, one trade-off</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[a, b].map((o, i) => {
            const idKey = o.id || (i === 0 ? "A" : "B");
            const isPicked = pick === idKey;
            return (
              <button
                key={idKey}
                type="button"
                onClick={() => setPick(idKey)}
                style={{ ...optionCard, ...(isPicked ? optionCardSelected : {}), padding: 10 }}
              >
                <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{o.label || (i === 0 ? "Option A" : "Option B")}</div>
                <div style={{ fontSize: "0.8rem", color: "#cbd5e1", marginTop: 4, lineHeight: 1.4 }}>{o.summary}</div>
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (mode === "career-myths") {
    const questions = Array.isArray(cfg.questions) ? cfg.questions : [];
    content = (
      <>
        <div style={cardLabel}>{cfg.career?.name ? `Myths about: ${cfg.career.name}` : "Career myths"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {questions.map((q, qi) => {
            const qid = q.id || `q-${qi}`;
            const chosen = revealedMyths[qid];
            return (
              <div key={qid} style={cardWrap}>
                <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{q.prompt}</div>
                {Array.isArray(q.options) && q.options.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {q.options.map((opt, oi) => {
                      const isPicked = chosen === oi;
                      const isReveal = typeof chosen === "number";
                      const isCorrect = isReveal && q.correctIndex === oi;
                      return (
                        <button
                          key={oi}
                          type="button"
                          disabled={isReveal || disabled}
                          onClick={() => setRevealedMyths((cur) => ({ ...cur, [qid]: oi }))}
                          style={{
                            ...pickRow,
                            ...(isPicked ? pickRowSelected : {}),
                            ...(isReveal && isCorrect ? { borderColor: "#22c55e", background: "rgba(34,197,94,0.15)" } : {}),
                            ...(isReveal && isPicked && !isCorrect ? { borderColor: "#ef4444", background: "rgba(239,68,68,0.10)" } : {}),
                            cursor: isReveal ? "default" : "pointer",
                          }}
                        >
                          {opt}
                          {isReveal && isCorrect ? <span style={{ marginLeft: 8 }}>✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {typeof chosen === "number" && q.reveal ? (
                  <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#cbd5e1", fontStyle: "italic" }}>
                    {q.reveal}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    // aptitude-match (and any unknown fallback)
    const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : [];
    content = (
      <>
        <div style={cardLabel}>Quick check-in</div>
        <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>
          These prompts aren't a diagnosis — they're a starting point for conversation. Different people are gifted differently.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {prompts.map((p, i) => {
            const pid = p.id || `p-${i}`;
            const chosen = revealedMyths[pid];
            return (
              <div key={pid} style={cardWrap}>
                <div style={{ fontWeight: 600, color: "#f1f5f9", fontSize: "0.95rem" }}>{p.prompt}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {(p.options || ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]).map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => setRevealedMyths((cur) => ({ ...cur, [pid]: oi }))}
                      style={{
                        ...pillBtn,
                        ...(chosen === oi ? { background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" } : {}),
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  /* ──────────────── Frame ──────────────── */
  return (
    <div style={wrap}>
      <div style={tagStrip}>Careers · {MODE_LABELS[mode] || mode}</div>
      <div style={titleStyle}>{task?.title || cfg.title || "Career Conversation"}</div>
      {task?.prompt ? <p style={promptStyle}>{task.prompt}</p> : null}

      {content}

      {mode !== "career-myths" && mode !== "aptitude-match" ? (
        <>
          <div style={cardLabel}>Why?</div>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Explain your reasoning (at least one sentence)…"
            disabled={disabled}
            maxLength={280}
            style={textareaStyle}
          />
          <div style={{ fontSize: "0.7rem", color: "#94a3b8", textAlign: "right" }}>
            {justification.length}/280
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          ...submitBtn,
          background: canSubmit ? "linear-gradient(135deg, #7c3aed, #6d28d9)" : "rgba(75,85,99,0.4)",
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.6,
        }}
      >
        Submit
      </button>
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 14px",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#c4b5fd",
  alignSelf: "flex-start",
  padding: "2px 8px",
  background: "rgba(124,58,237,0.18)",
  borderRadius: 999,
};
const titleStyle = { fontSize: "1.4rem", fontWeight: 800, color: "#f1f5f9" };
const promptStyle = { fontSize: "0.95rem", color: "#cbd5e1", margin: 0, lineHeight: 1.45 };
const cardWrap = {
  padding: 12,
  background: "rgba(30,41,59,0.55)",
  border: "1px solid rgba(124,58,237,0.3)",
  borderRadius: 12,
};
const cardLabel = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#a78bfa",
};
const bodyText = { fontSize: "0.95rem", color: "#e2e8f0", lineHeight: 1.55, margin: "6px 0 0" };
const pickRow = {
  display: "flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 10,
  background: "rgba(15,23,42,0.5)",
  border: "1px solid #334155",
  color: "#e2e8f0",
  cursor: "pointer",
};
const pickRowSelected = {
  borderColor: "#7c3aed",
  background: "rgba(124,58,237,0.16)",
};
const optionCard = {
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(15,23,42,0.5)",
  border: "1px solid #334155",
  color: "#e2e8f0",
  cursor: "pointer",
};
const optionCardSelected = {
  borderColor: "#7c3aed",
  background: "rgba(124,58,237,0.14)",
};
const tagOk = {
  fontSize: "0.72rem",
  color: "#bbf7d0",
  background: "rgba(34,197,94,0.14)",
  border: "1px solid rgba(34,197,94,0.35)",
  padding: "2px 8px",
  borderRadius: 999,
};
const tagWarn = {
  fontSize: "0.72rem",
  color: "#fde68a",
  background: "rgba(251,191,36,0.10)",
  border: "1px solid rgba(251,191,36,0.35)",
  padding: "2px 8px",
  borderRadius: 999,
};
const pillBtn = {
  fontSize: "0.78rem",
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid #475569",
  color: "#cbd5e1",
  cursor: "pointer",
};
const textareaStyle = {
  width: "100%",
  minHeight: 70,
  padding: "10px 12px",
  fontSize: "0.95rem",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "rgba(15,23,42,0.6)",
  color: "#f1f5f9",
  outline: "none",
  fontFamily: "inherit",
  resize: "vertical",
};
const submitBtn = {
  padding: "12px 28px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 14,
  color: "#fff",
  alignSelf: "center",
  marginTop: 6,
};
