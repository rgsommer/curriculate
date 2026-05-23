// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect, useMemo, useState } from "react";
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
 *
 * ENHANCED: Showstopper-quality experience with animations, visual personality, and interactive cards
 */
export default function BrainSparkNotesTask({ task, onAdvance, onSkip }) {
  const notes = useMemo(() => {
    // Prefer explicit notes payload; fallback to config.notes; final fallback empty object
    const raw = task?.notes || task?.config?.notes || {};

    // If the AI generated a flat "bullets" array instead of structured notes, convert it
    if (
      (!raw?.keyTerms || raw.keyTerms.length === 0) &&
      (!raw?.mainPoints || raw.mainPoints.length === 0) &&
      Array.isArray(task?.bullets) && task.bullets.length > 0
    ) {
      const bullets = task.bullets.map((b) => String(b).trim()).filter(Boolean);
      // Try to split "Term: definition" bullets into keyTerms
      const converted = bullets.map((b) => {
        const colonIdx = b.indexOf(":");
        if (colonIdx > 0 && colonIdx < 60) {
          return { term: b.slice(0, colonIdx).trim(), definition: b.slice(colonIdx + 1).trim(), points: [] };
        }
        return { term: "", definition: b, points: [] };
      });
      return {
        ...raw,
        heading: raw?.heading || task?.title || "Brain Spark Notes",
        keyTerms: converted,
        mainPoints: raw?.mainPoints || [],
        summary: raw?.summary || [],
      };
    }
    return raw;
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

  // Track expansion state for each note card
  const [expandedCards, setExpandedCards] = useState({});
  const [reviewedCount, setReviewedCount] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);

  const totalNotes = keyTerms.length + mainPoints.length + (summary.length > 0 ? 1 : 0);

  const toggleCard = (cardId) => {
    setExpandedCards((prev) => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
    // Increment reviewed count when expanding a card
    if (!expandedCards[cardId]) {
      setReviewedCount((prev) => Math.min(prev + 1, totalNotes));
    }
  };

  const playSound = () => {
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.volume = 0.6;
      audio.play().catch(() => {
        // Silently fail if sound doesn't exist
      });
    } catch (e) {
      // Silently fail
    }
  };

  const styles = {
    container: {
      display: "grid",
      gap: 16,
      padding: "0 4px",
    },
    heroSection: {
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      borderRadius: 16,
      padding: 24,
      color: "white",
      animation: "slideDown 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
      boxShadow: "0 10px 30px rgba(102, 126, 234, 0.3)",
    },
    heroTitle: {
      fontSize: "24px",
      fontWeight: "900",
      margin: "0 0 8px 0",
      letterSpacing: "-0.5px",
    },
    heroSubtitle: {
      fontSize: "14px",
      opacity: 0.95,
      margin: 0,
      lineHeight: 1.5,
    },
    pillContainer: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginTop: 16,
    },
    progressBar: {
      background: "rgba(255,255,255,0.3)",
      height: 8,
      borderRadius: 100,
      marginTop: 16,
      overflow: "hidden",
    },
    progressFill: {
      background: "#4ade80",
      height: "100%",
      width: `${totalNotes > 0 ? (reviewedCount / totalNotes) * 100 : 0}%`,
      transition: "width 0.4s ease-out",
      borderRadius: 100,
    },
    progressText: {
      fontSize: "12px",
      marginTop: 8,
      opacity: 0.9,
    },
    instructionCard: {
      background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
      borderRadius: 12,
      padding: 16,
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      animation: "fadeInUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both",
    },
    instructionIcon: {
      fontSize: "28px",
      flexShrink: 0,
    },
    instructionContent: {
      flex: 1,
    },
    instructionTitle: {
      fontWeight: 700,
      fontSize: "16px",
      margin: "0 0 6px 0",
      color: "#78350f",
    },
    instructionText: {
      fontSize: "14px",
      color: "#92400e",
      margin: 0,
      lineHeight: 1.5,
    },
    sectionsContainer: {
      display: "grid",
      gap: 20,
    },
    sectionLabel: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontSize: "18px",
      fontWeight: "800",
      marginBottom: 12,
    },
    sectionIcon: {
      fontSize: "24px",
    },
    notesGrid: {
      display: "grid",
      gap: 10,
    },
    noteCard: (isExpanded, index, color) => ({
      background: `linear-gradient(135deg, ${color.light} 0%, ${color.medium} 100%)`,
      borderRadius: 14,
      padding: 16,
      cursor: "pointer",
      transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
      border: `2px solid ${color.border}`,
      animation: `fadeInUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.1 + index * 0.08}s both`,
      boxShadow: isExpanded
        ? `0 12px 24px rgba(0,0,0,0.15)`
        : `0 4px 12px rgba(0,0,0,0.08)`,
      transform: isExpanded ? "translateY(-4px)" : "translateY(0)",
    }),
    noteCardHeader: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: "0",
    },
    noteCardTitle: {
      fontSize: "16px",
      fontWeight: "800",
      margin: 0,
      flex: 1,
    },
    noteCardToggle: {
      fontSize: "20px",
      transition: "transform 0.3s ease-out",
      display: "inline-block",
      flexShrink: 0,
    },
    noteCardToggleOpen: {
      transform: "rotate(180deg)",
    },
    noteCardContent: (isExpanded) => ({
      display: isExpanded ? "block" : "none",
      animation: isExpanded ? "expandContent 0.3s ease-out" : undefined,
      marginTop: 12,
      paddingTop: 12,
      borderTop: "2px solid rgba(255,255,255,0.3)",
    }),
    definition: {
      fontSize: "14px",
      lineHeight: 1.6,
      opacity: 0.95,
      marginBottom: 10,
    },
    bulletList: {
      margin: 0,
      paddingLeft: 20,
    },
    keyPoint: {
      fontSize: "13px",
      lineHeight: 1.6,
      marginBottom: 6,
    },
    summaryCard: (isExpanded, color) => ({
      background: `linear-gradient(135deg, ${color.light} 0%, ${color.medium} 100%)`,
      borderRadius: 14,
      padding: 16,
      cursor: "pointer",
      transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
      border: `2px solid ${color.border}`,
      animation: `fadeInUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.1 + (keyTerms.length + mainPoints.length) * 0.08}s both`,
      boxShadow: isExpanded
        ? `0 12px 24px rgba(0,0,0,0.15)`
        : `0 4px 12px rgba(0,0,0,0.08)`,
      transform: isExpanded ? "translateY(-4px)" : "translateY(0)",
    }),
    celebrationOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.7)",
      zIndex: 1000,
      animation: "fadeIn 0.3s ease-out",
    },
    celebrationBox: {
      background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
      borderRadius: 24,
      padding: 40,
      color: "white",
      textAlign: "center",
      animation: "popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
      boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
    },
    celebrationEmoji: {
      fontSize: "64px",
      marginBottom: 16,
      animation: "bounce 1s ease-in-out infinite",
    },
    celebrationText: {
      fontSize: "28px",
      fontWeight: "900",
      margin: "0 0 12px 0",
    },
    celebrationSubtext: {
      fontSize: "16px",
      opacity: 0.95,
      margin: 0,
    },
    errorCard: {
      background: "linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)",
      borderRadius: 12,
      padding: 20,
      border: "2px solid #f87171",
      animation: "fadeInUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both",
    },
    errorTitle: {
      fontSize: "18px",
      fontWeight: "800",
      color: "#7f1d1d",
      margin: "0 0 8px 0",
    },
    errorText: {
      fontSize: "14px",
      color: "#991b1b",
      margin: 0,
      lineHeight: 1.5,
    },
  };

  // Color palette for different card types
  const colors = {
    keyTerms: {
      light: "#dbeafe",
      medium: "#bfdbfe",
      border: "#3b82f6",
      icon: "📚",
    },
    mainPoints: {
      light: "#dcfce7",
      medium: "#bbf7d0",
      border: "#22c55e",
      icon: "⭐",
    },
    summary: {
      light: "#fce7f3",
      medium: "#fbcfe8",
      border: "#ec4899",
      icon: "✨",
    },
  };

  return (
    <TaskChrome task={task} onAdvance={onAdvance} onSkip={onSkip} canSkip={true}>
      {({ setCanSubmit, registerSubmitHandler }) => {
        useEffect(() => {
          // This is a "completion" task: students do the work off-screen (in notebooks).
          setCanSubmit(true);
          registerSubmitHandler(async () => {
            setShowCelebration(true);
            playSound();
            // Celebration display lasts 2 seconds before advancing
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return {
              ok: true,
              advance: true,
              feedback: { type: "success", message: "Nice work — notes captured." },
            };
          });
        }, [setCanSubmit, registerSubmitHandler]);

        return (
          <>
            <style>{`
              @keyframes slideDown {
                from {
                  opacity: 0;
                  transform: translateY(-20px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }

              @keyframes fadeInUp {
                from {
                  opacity: 0;
                  transform: translateY(16px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }

              @keyframes fadeIn {
                from {
                  opacity: 0;
                }
                to {
                  opacity: 1;
                }
              }

              @keyframes popIn {
                0% {
                  opacity: 0;
                  transform: scale(0.8);
                }
                100% {
                  opacity: 1;
                  transform: scale(1);
                }
              }

              @keyframes bounce {
                0%, 100% {
                  transform: translateY(0);
                }
                50% {
                  transform: translateY(-12px);
                }
              }

              @keyframes expandContent {
                from {
                  opacity: 0;
                  maxHeight: 0;
                }
                to {
                  opacity: 1;
                  maxHeight: 1000px;
                }
              }

              @media (max-width: 640px) {
                * { box-sizing: border-box; }
              }
            `}</style>

            <div style={styles.container}>
              {/* Hero Section */}
              <div style={styles.heroSection}>
                <h1 style={styles.heroTitle}>🧠 Brain Spark Notes</h1>
                <p style={styles.heroSubtitle}>Copy these exact notes into your notebook. Keep it neat and complete.</p>
                <div style={styles.pillContainer}>
                  <Pill style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "1px solid rgba(255,255,255,0.5)" }}>
                    📝 WRITE THIS IN YOUR NOTEBOOK!
                  </Pill>
                  <Pill style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "1px solid rgba(255,255,255,0.5)" }}>
                    ⭐ +10 POINTS FOR EVERYONE!
                  </Pill>
                </div>

                {/* Progress Tracker */}
                {totalNotes > 0 && (
                  <>
                    <div style={styles.progressBar}>
                      <div style={styles.progressFill} />
                    </div>
                    <div style={styles.progressText}>
                      {reviewedCount} of {totalNotes} notes reviewed
                    </div>
                  </>
                )}
              </div>

              {/* Instruction Card */}
              <div style={styles.instructionCard}>
                <div style={styles.instructionIcon}>📖</div>
                <div style={styles.instructionContent}>
                  <p style={styles.instructionTitle}>How to Use These Notes</p>
                  <p style={styles.instructionText}>
                    Click on each card below to expand it. Read carefully, then write everything into your notebook. This helps you retain the information!
                  </p>
                </div>
              </div>

              {/* Content Sections */}
              {!hasAnyContent ? (
                <div style={styles.errorCard}>
                  <p style={styles.errorTitle}>⚠️ Notes Not Available</p>
                  <p style={styles.errorText}>
                    This task is missing its notes payload. Expected <code>task.notes</code> or <code>task.config.notes</code>.
                  </p>
                </div>
              ) : (
                <div style={styles.sectionsContainer}>
                  {/* Key Terms Section */}
                  {keyTerms.length > 0 && (
                    <div>
                      <div style={styles.sectionLabel}>
                        <span style={styles.sectionIcon}>{colors.keyTerms.icon}</span>
                        Key Terms
                      </div>
                      <div style={styles.notesGrid}>
                        {keyTerms.map((kt, idx) => {
                          const term = kt?.term ?? "";
                          const def = kt?.definition ?? "";
                          const points = Array.isArray(kt?.points) ? kt.points : [];
                          const cardId = `kt-${idx}`;
                          const isExpanded = expandedCards[cardId];

                          return (
                            <div
                              key={cardId}
                              style={styles.noteCard(isExpanded, idx, colors.keyTerms)}
                              onClick={() => toggleCard(cardId)}
                            >
                              <div style={styles.noteCardHeader}>
                                <p style={styles.noteCardTitle}>
                                  {term || `Term ${idx + 1}`}
                                </p>
                                <span
                                  style={{
                                    ...styles.noteCardToggle,
                                    ...(isExpanded ? styles.noteCardToggleOpen : {}),
                                  }}
                                >
                                  ▼
                                </span>
                              </div>

                              <div style={styles.noteCardContent(isExpanded)}>
                                {def && (
                                  <div style={styles.definition}>{def}</div>
                                )}
                                {points.length > 0 && (
                                  <ul style={styles.bulletList}>
                                    {points.map((p, i) => (
                                      <li key={`kt-${idx}-p-${i}`} style={styles.keyPoint}>
                                        {p}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Main Points Section */}
                  {mainPoints.length > 0 && (
                    <div>
                      <div style={styles.sectionLabel}>
                        <span style={styles.sectionIcon}>{colors.mainPoints.icon}</span>
                        Main Points
                      </div>
                      <div style={styles.notesGrid}>
                        {mainPoints.map((mp, idx) => {
                          const h = mp?.heading ?? `Point ${idx + 1}`;
                          // Handle BOTH shapes the validator can produce:
                          //   {heading, bullets:[...]} (flat)
                          //   {heading, sections:[{title, bullets:[...]}]} (nested)
                          // The previous renderer only read `bullets`, so the
                          // nested-sections shape rendered as "No bullets
                          // provided" — Bernadette: "there were no main
                          // points." Now we flatten sections into a single
                          // bullet list (with section titles as sub-headings)
                          // so SOMETHING always shows.
                          const rawBullets = Array.isArray(mp?.bullets) ? mp.bullets : [];
                          const rawSections = Array.isArray(mp?.sections) ? mp.sections : [];
                          const flatBullets = rawBullets.length > 0
                            ? rawBullets.map((b) => ({ text: String(b || "").trim(), sub: null }))
                            : rawSections.flatMap((sec) => {
                                const secTitle = String(sec?.title || sec?.heading || "").trim();
                                const secBullets = Array.isArray(sec?.bullets) ? sec.bullets : [];
                                return secBullets
                                  .map((b) => String(b || "").trim())
                                  .filter(Boolean)
                                  .map((text) => ({ text, sub: secTitle || null }));
                              });
                          const cardId = `mp-${idx}`;
                          const isExpanded = expandedCards[cardId];

                          return (
                            <div
                              key={cardId}
                              style={styles.noteCard(isExpanded, keyTerms.length + idx, colors.mainPoints)}
                              onClick={() => toggleCard(cardId)}
                            >
                              <div style={styles.noteCardHeader}>
                                <p style={styles.noteCardTitle}>{h}</p>
                                <span
                                  style={{
                                    ...styles.noteCardToggle,
                                    ...(isExpanded ? styles.noteCardToggleOpen : {}),
                                  }}
                                >
                                  ▼
                                </span>
                              </div>

                              <div style={styles.noteCardContent(isExpanded)}>
                                {flatBullets.length > 0 ? (
                                  <ul style={styles.bulletList}>
                                    {flatBullets.map((b, i) => (
                                      <li key={`mp-${idx}-b-${i}`} style={styles.keyPoint}>
                                        {b.sub ? (
                                          <>
                                            <strong style={{ color: "#475569", fontSize: 12, display: "block" }}>
                                              {b.sub}
                                            </strong>
                                            {b.text}
                                          </>
                                        ) : (
                                          b.text
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p style={{ fontSize: "13px", color: "#666", fontStyle: "italic", margin: 0 }}>
                                    No bullets provided.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary Section */}
                  {summary.length > 0 && (
                    <div>
                      <div style={styles.sectionLabel}>
                        <span style={styles.sectionIcon}>{colors.summary.icon}</span>
                        Summary
                      </div>
                      <div
                        style={styles.summaryCard(expandedCards["summary"], colors.summary)}
                        onClick={() => toggleCard("summary")}
                      >
                        <div style={styles.noteCardHeader}>
                          <p style={styles.noteCardTitle}>Quick Summary</p>
                          <span
                            style={{
                              ...styles.noteCardToggle,
                              ...(expandedCards["summary"] ? styles.noteCardToggleOpen : {}),
                            }}
                          >
                            ▼
                          </span>
                        </div>

                        <div style={styles.noteCardContent(expandedCards["summary"])}>
                          <ul style={styles.bulletList}>
                            {summary.map((s, idx) => (
                              <li key={`sum-${idx}`} style={styles.keyPoint}>
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Celebration Modal */}
            {showCelebration && (
              <div style={styles.celebrationOverlay}>
                <div style={styles.celebrationBox}>
                  <div style={styles.celebrationEmoji}>🎉</div>
                  <p style={styles.celebrationText}>Amazing!</p>
                  <p style={styles.celebrationSubtext}>Your notes are ready to go!</p>
                </div>
              </div>
            )}
          </>
        );
      }}
    </TaskChrome>
  );
}
