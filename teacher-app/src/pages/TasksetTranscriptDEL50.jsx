// teacher-app/src/pages/TasksetTranscript.jsx
import React from "react";

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

  const teamsById = Object.fromEntries(
    (teams || []).map((t) => [t.teamId, t])
  );

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

      {tasks.map((task) => {
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
              <p style={{ color: "#9ca3af", margin: 0 }}>
                No submissions for this task.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {taskSubs.map((sub) => {
                  const team = teamsById[sub.teamId];
                  const displayScore =
                    sub.teacherOverride?.isOverridden &&
                    typeof sub.teacherOverride.overrideScore ===
                      "number"
                      ? sub.teacherOverride.overrideScore
                      : sub.aiScore?.totalScore ?? null;

                  const maxPoints =
                    sub.aiScore?.maxPoints ?? task.points ?? null;

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
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#6b7280",
                              }}
                            >
                              {sub.playerId}
                            </div>
                          )}
                        </div>
                        {displayScore != null && maxPoints != null && (
                          <div style={{ textAlign: "right" }}>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#6b7280",
                              }}
                            >
                              Score
                            </div>
                            <div
                              style={{
                                fontSize: "1.1rem",
                                fontWeight: 700,
                              }}
                            >
                              {displayScore} / {maxPoints}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Answer / media */}
                      {sub.mediaUrl && (
                        <div style={{ marginTop: 4 }}>
                          {task.taskType === "record-audio" ? (
                            <audio
                              controls
                              src={sub.mediaUrl}
                              style={{ width: "100%" }}
                            />
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

                      {sub.answerText && (
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "#111827",
                            marginTop: 4,
                          }}
                        >
                          <strong>Response:</strong>{" "}
                          {sub.answerText}
                        </div>
                      )}

                      {/* AI rubric breakdown (if present) */}
                      {sub.aiScore?.criteria &&
                        sub.aiScore.criteria.length > 0 && (
                          <details
                            style={{
                              marginTop: 6,
                              fontSize: "0.8rem",
                            }}
                          >
                            <summary
                              style={{
                                cursor: "pointer",
                                color: "#2563eb",
                              }}
                            >
                              View rubric breakdown
                            </summary>
                            <ul
                              style={{
                                paddingLeft: 18,
                                margin: "4px 0 0",
                              }}
                            >
                              {sub.aiScore.criteria.map((c) => (
                                <li key={c.id}>
                                  <strong>
                                    {c.id} ({c.score}/{c.maxPoints})
                                  </strong>
                                  {c.comment
                                    ? ` – ${c.comment}`
                                    : ""}
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
