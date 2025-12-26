// teacher-app/src/pages/TasksetTranscript.jsx
import React from "react";

function summarizeNarrationRatings(sub, task) {
  // Accept multiple shapes to stay backward compatible:
  // - sub.ratings (array of {score} or numbers)
  // - sub.answerPayload.ratings
  // - sub.data.ratings / sub.data.peerRatings
  const raw =
    (Array.isArray(sub?.ratings) ? sub.ratings : null) ||
    (Array.isArray(sub?.answerPayload?.ratings) ? sub.answerPayload.ratings : null) ||
    (Array.isArray(sub?.data?.ratings) ? sub.data.ratings : null) ||
    (Array.isArray(sub?.data?.peerRatings) ? sub.data.peerRatings : null) ||
    null;

  if (!raw || raw.length === 0) return null;

  const values = raw
    .map((r) => (typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating)))
    .filter((n) => Number.isFinite(n));

  if (!values.length) return null;

  const scale =
    sub?.ratingScale ||
    sub?.answerPayload?.ratingScale ||
    sub?.data?.ratingScale ||
    task?.config?.ratingScale ||
    null;

  const max = Number(scale?.max) > 0 ? Number(scale.max) : 5;
  const min = Number(scale?.min) >= 0 ? Number(scale.min) : 1;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Per-speaker detail if present (preferred)
  const detailed =
    raw.some((r) => r && typeof r === "object" && ("playerIndex" in r || "playerName" in r))
      ? raw
          .map((r) => ({
            playerIndex: Number.isFinite(Number(r?.playerIndex)) ? Number(r.playerIndex) : null,
            playerName: r?.playerName ? String(r.playerName) : null,
            score: typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating),
          }))
          .filter((r) => Number.isFinite(r.score))
      : null;

  return { avg, count: values.length, min, max, detailed };
}

function summarizeScriptPlay(sub, task) {
  // Accept multiple shapes:
  // - sub.answerPayload.expressiveRating
  // - sub.answerPayload.expressive (boolean)
  // - sub.data.expressiveRating
  const rating =
    (Number.isFinite(Number(sub?.answerPayload?.expressiveRating)) ? Number(sub.answerPayload.expressiveRating) : null) ??
    (Number.isFinite(Number(sub?.data?.expressiveRating)) ? Number(sub.data.expressiveRating) : null) ??
    null;

  const expressive =
    typeof sub?.answerPayload?.expressive === "boolean"
      ? sub.answerPayload.expressive
      : typeof sub?.data?.expressive === "boolean"
      ? sub.data.expressive
      : null;

  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const scenes = Array.isArray(cfg.scenes) ? cfg.scenes : null;
  const lines = Array.isArray(cfg.lines) ? cfg.lines : null;

  const totalTurns = scenes
    ? scenes.reduce((sum, s) => sum + (Array.isArray(s?.turns) ? s.turns.length : 0), 0)
    : lines
    ? lines.length
    : null;

  const rolesCount =
    Array.isArray(cfg.roles) ? cfg.roles.length : Number.isFinite(Number(cfg.playerCount)) ? Number(cfg.playerCount) : null;

  return { rating, expressive, totalTurns, rolesCount };
}

function summarizeRolePlayDeck(sub, task) {
  // Prefer task.config; fallback to submission payloads for backward compatibility.
  const cfg =
    (task?.config && typeof task.config === "object" ? task.config : null) ||
    (sub?.answerPayload?.config && typeof sub.answerPayload.config === "object" ? sub.answerPayload.config : null) ||
    (sub?.data?.config && typeof sub.data.config === "object" ? sub.data.config : null) ||
    null;

  if (!cfg) return null;

  const mode = cfg.mode ? String(cfg.mode) : null;
  const scenario = cfg.scenario ? String(cfg.scenario) : null;

  const roles = Array.isArray(cfg.roles) ? cfg.roles : null;
  const rolesCount =
    roles ? roles.length : Number.isFinite(Number(cfg.playerCount)) ? Number(cfg.playerCount) : null;

  const hasAny = Boolean(mode || scenario || rolesCount != null);
  if (!hasAny) return null;

  return { mode, scenario, rolesCount };
}

function summarizeFakeOut(sub, task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};

  const rounds =
    (Array.isArray(ap.rounds) && ap.rounds.length ? ap.rounds : null) ||
    (Array.isArray(data.rounds) && data.rounds.length ? data.rounds : null) ||
    (Array.isArray(cfg.rounds) && cfg.rounds.length ? cfg.rounds : null) ||
    null;

  const round =
    (ap.round && typeof ap.round === "object" ? ap.round : null) ||
    (data.round && typeof data.round === "object" ? data.round : null) ||
    null;

  const votes =
    (Array.isArray(ap.votes) ? ap.votes : null) ||
    (Array.isArray(data.votes) ? data.votes : null) ||
    null;

  const votesByPlayer =
    (Array.isArray(ap.votesByPlayer) ? ap.votesByPlayer : null) ||
    (Array.isArray(data.votesByPlayer) ? data.votesByPlayer : null) ||
    null;

  const playerNames =
    (Array.isArray(cfg.playerNames) && cfg.playerNames.length ? cfg.playerNames : null) ||
    (Array.isArray(ap.playerNames) && ap.playerNames.length ? ap.playerNames : null) ||
    (Array.isArray(data.playerNames) && data.playerNames.length ? data.playerNames : null) ||
    null;

  const readerIndexRaw =
    (Number.isFinite(Number(ap.readerIndex)) ? Number(ap.readerIndex) : null) ??
    (Number.isFinite(Number(data.readerIndex)) ? Number(data.readerIndex) : null) ??
    (Number.isFinite(Number(ap.readerPlayerNumber)) ? Number(ap.readerPlayerNumber) - 1 : null) ??
    null;

  const toRoundSummary = (r) => {
    if (!r || typeof r !== "object") return null;
    const statement = r.statement ? String(r.statement) : "";
    const options = Array.isArray(r.options) ? r.options.map((x) => String(x)) : [];
    const correctIndex = Number.isFinite(Number(r.correctIndex)) ? Number(r.correctIndex) : null;
    if (!statement && options.length === 0 && correctIndex == null) return null;
    return { statement, options, correctIndex };
  };

  const roundSummaries = (rounds || []).map(toRoundSummary).filter(Boolean);
  const single = toRoundSummary(round);

  const useRounds = roundSummaries.length ? roundSummaries : single ? [single] : [];

  if (!useRounds.length) return null;

  let normalizedVotes = [];
  if (Array.isArray(votesByPlayer) && votesByPlayer.length) {
    normalizedVotes = votesByPlayer
      .map((v) => ({
        playerName: v?.playerName ? String(v.playerName) : null,
        optionIndex: Number.isFinite(Number(v?.optionIndex)) ? Number(v.optionIndex) : null,
      }))
      .filter((v) => v.optionIndex != null);
  } else if (Array.isArray(votes) && votes.length) {
    normalizedVotes = votes
      .map((optIdx, i) => ({
        playerName: playerNames?.[i] ? String(playerNames[i]) : `Player ${i + 1}`,
        optionIndex: Number.isFinite(Number(optIdx)) ? Number(optIdx) : null,
      }))
      .filter((v) => v.optionIndex != null);
  }

  return {
    rounds: useRounds.slice(0, 6),
    votes: normalizedVotes.slice(0, 24),
    readerIndex: readerIndexRaw,
  };
}


/**
 * Simple transcript viewer.
 * Props:
 *   - transcript: {
 *       roomCode,
 *       tasksetName,
 *       tasks: [{ index, title, taskType, prompt }],
 *       teams: [{ teamId, teamName }],
 *       submissions: [...]
 *     }
 */
export default function TasksetTranscript({ transcript }) {
  if (!transcript) {
    return <div style={{ padding: 16 }}>No transcript loaded.</div>;
  }

  const { roomCode, tasksetName, tasks, teams, submissions } = transcript;

  const teamsById = Object.fromEntries((teams || []).map((t) => [t.teamId, t]));

  // Group submissions by taskIndex
  const subsByTask = {};
  (submissions || []).forEach((sub) => {
    const idx = sub.taskIndex ?? 0;
    if (!subsByTask[idx]) subsByTask[idx] = [];
    subsByTask[idx].push(sub);
  });

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header>
        <h1 style={{ marginBottom: 4 }}>Session transcript</h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
          Room: <strong>{roomCode}</strong>
        </p>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
          Task set: <strong>{tasksetName}</strong>
        </p>
      </header>

      {(tasks || []).map((task) => {
        const idx = task.index ?? 0;
        const taskSubs = subsByTask[idx] || [];

        return (
          <section
            key={idx}
            style={{
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 12,
              background: "#f9fafb",
            }}
          >
            <h2 style={{ margin: "0 0 4px" }}>
              Task {idx + 1}: {task.title || task.taskType}
            </h2>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "0.9rem",
                color: "#4b5563",
              }}
            >
              {task.prompt}
            </p>

            {taskSubs.length === 0 ? (
              <p style={{ color: "#9ca3af", margin: 0 }}>No submissions for this task.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {taskSubs.map((sub) => {
                  const team = teamsById[sub.teamId];

                  const displayScore =
                    sub.teacherOverride?.isOverridden && typeof sub.teacherOverride.overrideScore === "number"
                      ? sub.teacherOverride.overrideScore
                      : sub.aiScore?.totalScore ?? null;

                  const maxPoints = sub.aiScore?.maxPoints ?? task.points ?? null;

                  return (
                    <div
                      key={`${sub.teamId}-${sub.playerId}-${sub.taskIndex}`}
                      style={{
                        borderRadius: 10,
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              textTransform: "uppercase",
                              letterSpacing: 1,
                              color: "#6b7280",
                            }}
                          >
                            {team?.teamName || "Team"}
                          </div>
                          {sub.playerId && (
                            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{sub.playerId}</div>
                          )}
                        </div>

                        {displayScore != null && maxPoints != null && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                              {displayScore} / {maxPoints}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Answer / media */}
                      {sub.mediaUrl && (
                        <div style={{ marginTop: 4 }}>
                          {task.taskType === "record-audio" ? (
                            <audio controls src={sub.mediaUrl} style={{ width: "100%" }} />
                          ) : (
                            <img
                              src={sub.mediaUrl}
                              alt="Student submission"
                              style={{
                                maxWidth: "100%",
                                maxHeight: 180,
                                objectFit: "contain",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                              }}
                            />
                          )}
                        </div>
                      )}

                      {/* Narration Synthesize peer ratings (if present) */}
                      {(() => {
                        const isNarration =
                          task.taskType === "narration-synthesize" ||
                          task.taskType === "narration_synthesize" ||
                          task.taskType === "narrationSynthesize" ||
                          task.taskType === "narrationSynthesizeTask";
                        if (!isNarration) return null;

                        const summary = summarizeNarrationRatings(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid #bae6fd",
                              background: "#ecfeff",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#075985",
                                marginBottom: 4,
                              }}
                            >
                              Narration ratings
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: "0.85rem", color: "#0f172a", fontWeight: 800 }}>
                                Avg: {summary.avg.toFixed(1)} / {summary.max}
                              </div>
                              <div style={{ fontSize: "0.8rem", color: "#0f172a" }}>
                                {summary.count} ratings • scale {summary.min}–{summary.max}
                              </div>
                            </div>

                            {Array.isArray(summary.detailed) && summary.detailed.length > 0 && (
                              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                {summary.detailed.slice(0, 12).map((r, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      padding: "6px 8px",
                                      borderRadius: 8,
                                      border: "1px solid #e2e8f0",
                                      background: "rgba(255,255,255,0.85)",
                                      fontSize: "0.82rem",
                                    }}
                                  >
                                    <div style={{ fontWeight: 800, color: "#0f172a" }}>
                                      {r.playerName || (r.playerIndex != null ? `Player ${r.playerIndex + 1}` : "Player")}
                                    </div>
                                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{r.score}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Script Play performance summary (if present) */}
                      {(() => {
                        const isScriptPlay =
                          task.taskType === "script-play" ||
                          task.taskType === "script_play" ||
                          task.taskType === "scriptplay" ||
                          task.taskType === "script";
                        if (!isScriptPlay) return null;

                        const summary = summarizeScriptPlay(sub, task);
                        if (!summary) return null;

                        const hasAny =
                          summary.rating != null ||
                          summary.expressive != null ||
                          summary.totalTurns != null ||
                          summary.rolesCount != null;

                        if (!hasAny) return null;

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid rgba(245,158,11,0.35)",
                              background: "rgba(255,247,237,0.9)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#92400e",
                                marginBottom: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  background: "rgba(245,158,11,0.14)",
                                  border: "1px solid rgba(245,158,11,0.25)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🎭
                              </span>
                              Script Play details
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              {summary.rolesCount != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Roles:</strong> {summary.rolesCount}
                                </div>
                              )}
                              {summary.totalTurns != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Lines:</strong> {summary.totalTurns}
                                </div>
                              )}
                              {summary.rating != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Expressiveness:</strong> {summary.rating}/5
                                </div>
                              )}
                              {summary.expressive != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Expressive:</strong> {summary.expressive ? "Yes" : "No"}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Role Play Deck summary (scenario / roles / mode) */}
                      {(() => {
                        const isRolePlay =
                          task.taskType === "role-play-deck" ||
                          task.taskType === "role_play_deck" ||
                          task.taskType === "roleplaydeck" ||
                          task.taskType === "role-play" ||
                          task.taskType === "role_play" ||
                          task.taskType === "roleplay";
                        if (!isRolePlay) return null;

                        const summary = summarizeRolePlayDeck(sub, task);
                        if (!summary) return null;

                        const modeLabel =
                          summary.mode === "mystery"
                            ? "Mystery (hidden)"
                            : summary.mode === "classic"
                            ? "Classic (open)"
                            : summary.mode
                            ? String(summary.mode)
                            : "Choose";

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid rgba(59,130,246,0.28)",
                              background: "rgba(239,246,255,0.9)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#1d4ed8",
                                marginBottom: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  background: "rgba(59,130,246,0.12)",
                                  border: "1px solid rgba(59,130,246,0.22)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🎴
                              </span>
                              Role Play Deck
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                <strong>Mode:</strong> {modeLabel}
                              </div>
                              {summary.rolesCount != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Roles:</strong> {summary.rolesCount}
                                </div>
                              )}
                            </div>

                            {summary.scenario && (
                              <div style={{ marginTop: 6, fontSize: "0.84rem", color: "#0f172a" }}>
                                <strong>Scenario:</strong> {summary.scenario}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      
{/* Fake Out (bluffing / listening) summary */}
{(() => {
  const isFakeOut =
    task.taskType === "fake-out" ||
    task.taskType === "fake_out" ||
    task.taskType === "fakeout" ||
    task.taskType === "fakeOut";
  if (!isFakeOut) return null;

  const summary = summarizeFakeOut(sub, task);
  if (!summary) return null;

  const first = summary.rounds[0];
  const correctLabel =
    first.correctIndex != null ? `Option ${first.correctIndex + 1}` : "—";

  const fooledCount =
    first.correctIndex != null
      ? summary.votes.filter((v) => v.optionIndex != null && v.optionIndex !== first.correctIndex).length
      : null;

  return (
    <div
      style={{
        marginTop: 4,
        padding: 10,
        borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.28)",
        background: "rgba(254,242,242,0.9)",
      }}
    >
      <div
        style={{
          fontSize: "0.78rem",
          fontWeight: 900,
          color: "#b91c1c",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.22)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🤥
        </span>
        Fake Out – votes &amp; reveal
      </div>

      <div style={{ fontSize: "0.84rem", color: "#111827" }}>
        <strong>Correct:</strong> {correctLabel}
        {fooledCount != null && (
          <>
            {" "}
            • <strong>Fooled:</strong> {fooledCount}
          </>
        )}
      </div>

      {Array.isArray(first.options) && first.options.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {first.options.slice(0, 4).map((opt, i) => {
            const isCorrect = first.correctIndex === i;
            return (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: isCorrect ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.8)",
                  fontSize: "0.82rem",
                }}
              >
                <strong>Option {i + 1}:</strong> {opt}
              </div>
            );
          })}
        </div>
      )}

      {summary.votes.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {summary.votes.slice(0, 12).map((v, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(255,255,255,0.85)",
                fontSize: "0.82rem",
              }}
            >
              <div style={{ fontWeight: 800, color: "#111827" }}>{v.playerName || "Player"}</div>
              <div style={{ fontWeight: 900, color: "#111827" }}>
                Option {Number(v.optionIndex) + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
})()}

                      {sub.answerText && (
                        <div style={{ fontSize: "0.85rem", color: "#111827", marginTop: 4 }}>
                          <strong>Response:</strong> {sub.answerText}
                        </div>
                      )}

                      {/* AI rubric breakdown (if present) */}
                      {sub.aiScore?.criteria && sub.aiScore.criteria.length > 0 && (
                        <details style={{ marginTop: 6, fontSize: "0.8rem" }}>
                          <summary style={{ cursor: "pointer", color: "#2563eb" }}>
                            View rubric breakdown
                          </summary>
                          <ul style={{ paddingLeft: 18, margin: "4px 0 0" }}>
                            {sub.aiScore.criteria.map((c) => (
                              <li key={c.id}>
                                <strong>
                                  {c.id} ({c.score}/{c.maxPoints})
                                </strong>
                                {c.comment ? ` – ${c.comment}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {sub.aiScore?.overallComment && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: "0.8rem",
                            color: "#4b5563",
                            fontStyle: "italic",
                          }}
                        >
                          {sub.aiScore.overallComment}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
