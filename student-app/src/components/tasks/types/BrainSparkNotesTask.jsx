// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect, useMemo } from "react";
import TaskChrome from "../TaskChrome";
import {
  TaskPanel,
  TaskTitle,
  TaskSubtitle,
  TaskBodyText,
  Divider,
  Pill,
  HelpText,
} from "../taskStyles";

/**
 * Brain Spark Notes
 * Renders a "copy these notes" task from either:
 * - task.notes
 * - task.config.notes
 *
 * No teacher involvement, no templates, no waiting.
 */
export default function BrainSparkNotesTask({ task, onAdvance, onSkip }) {
  const notes = useMemo(() => {
    // Prefer explicit notes payload; fallback to config.notes; final fallback empty object
    return task?.notes || task?.config?.notes || {};
  }, [task]);

  const heading = notes?.heading || task?.title || "Brain Spark Notes";

  const keyTerms = Array.isArray(notes?.keyTerms) ? notes.keyTerms : [];
  const mainPoints = Array.isArray(notes?.mainPoints) ? notes.mainPoints : [];
  const summary = Array.isArray(notes?.summary) ? notes.summary : [];

  const hasAnyContent =
    (heading && String(heading).trim().length > 0) ||
    keyTerms.length > 0 ||
    mainPoints.length > 0 ||
    summary.length > 0;

  return (
    <TaskChrome task={task} onAdvance={onAdvance} onSkip={onSkip} canSkip={true}>
      {({ setCanSubmit, registerSubmitHandler }) => {
        useEffect(() => {
          // This is a "completion" task: students do the work off-screen (in notebooks).
          setCanSubmit(true);
          registerSubmitHandler(async () => {
            return {
              ok: true,
              advance: true,
              feedback: { type: "success", message: "Nice work — notes captured." },
            };
          });
        }, [setCanSubmit, registerSubmitHandler]);

        return (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill>WRITE THIS IN YOUR NOTEBOOK!</Pill>
              <Pill>+10 POINTS FOR EVERYONE!</Pill>
            </div>

            <TaskPanel>
              <TaskTitle>Instructions</TaskTitle>
              <TaskBodyText>
                Copy these exact notes into your notebook. Keep it neat and complete.
              </TaskBodyText>
            </TaskPanel>

            <Divider />

            {!hasAnyContent ? (
              <TaskPanel>
                <TaskTitle>Notes not available</TaskTitle>
                <HelpText>
                  This task is missing its <code>notes</code> payload. Expected{" "}
                  <code>task.notes</code> or <code>task.config.notes</code>.
                </HelpText>
              </TaskPanel>
            ) : (
              <TaskPanel>
                <TaskTitle>{heading}</TaskTitle>

                {keyTerms.length > 0 && (
                  <>
                    <TaskSubtitle style={{ marginTop: 10 }}>Key Terms</TaskSubtitle>
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      {keyTerms.map((kt, idx) => {
                        const term = kt?.term ?? "";
                        const def = kt?.definition ?? "";
                        const points = Array.isArray(kt?.points) ? kt.points : [];
                        return (
                          <div
                            key={`kt-${idx}`}
                            style={{
                              border: "1px solid rgba(0,0,0,0.08)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,255,255,0.7)",
                            }}
                          >
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>
                              {term || `Term ${idx + 1}`}
                            </div>
                            {def ? (
                              <div style={{ opacity: 0.9, marginBottom: points.length ? 8 : 0 }}>
                                {def}
                              </div>
                            ) : null}
                            {points.length ? (
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {points.map((p, i) => (
                                  <li key={`kt-${idx}-p-${i}`}>{p}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {mainPoints.length > 0 && (
                  <>
                    <TaskSubtitle style={{ marginTop: 14 }}>Main Points</TaskSubtitle>
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      {mainPoints.map((mp, idx) => {
                        const h = mp?.heading ?? `Point ${idx + 1}`;
                        const bullets = Array.isArray(mp?.bullets) ? mp.bullets : [];
                        return (
                          <div
                            key={`mp-${idx}`}
                            style={{
                              border: "1px solid rgba(0,0,0,0.08)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,255,255,0.7)",
                            }}
                          >
                            <div style={{ fontWeight: 800, marginBottom: bullets.length ? 8 : 0 }}>
                              {h}
                            </div>
                            {bullets.length ? (
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {bullets.map((b, i) => (
                                  <li key={`mp-${idx}-b-${i}`}>{b}</li>
                                ))}
                              </ul>
                            ) : (
                              <HelpText>No bullets provided.</HelpText>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {summary.length > 0 && (
                  <>
                    <TaskSubtitle style={{ marginTop: 14 }}>Summary</TaskSubtitle>
                    <ul style={{ margin: 0, paddingLeft: 18, marginTop: 8 }}>
                      {summary.map((s, idx) => (
                        <li key={`sum-${idx}`}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </TaskPanel>
            )}
          </div>
        );
      }}
    </TaskChrome>
  );
}
