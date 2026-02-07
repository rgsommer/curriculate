export const CHROME_THEME = {
  page: {
    width: "100%",
    minHeight: "100%",
    display: "flex",
    justifyContent: "center",
    padding: "18px 14px",
    boxSizing: "border-box",
  },

  shell: {
    width: "100%",
    maxWidth: 980,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    borderRadius: 18,
    boxShadow: "0 10px 40px rgba(0,0,0,0.10)",
    border: "1px solid rgba(0,0,0,0.08)",
    overflow: "hidden",
    background: "rgba(255,255,255,0.96)",
    backdropFilter: "blur(8px)",
  },

  // --- Intro video
  introWrap: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "black",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  introVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  introOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    padding: 24,
    boxSizing: "border-box",
    background:
      "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.25), rgba(0,0,0,0.0))",
    color: "white",
  },
  introTitle: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    marginBottom: 4,
  },
  introSub: {
    opacity: 0.85,
    fontSize: 14,
    marginBottom: 14,
    textTransform: "capitalize",
  },
  introActions: {
    display: "flex",
    gap: 10,
    marginBottom: 6,
  },

  // --- Top bar
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "14px 16px 0 16px",
  },
  topLeft: { display: "flex", flexDirection: "column", gap: 6 },
  topRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  badges: { display: "flex", gap: 8, flexWrap: "wrap" },
  badge: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(0,0,0,0.04)",
    textTransform: "capitalize",
  },
  progress: { fontSize: 12, opacity: 0.8 },
  timer: { fontSize: 12, opacity: 0.9 },

  // --- Prompt zone
  promptZone: {
    padding: "10px 16px 0 16px",
  },
  promptText: {
    fontSize: 14,
    lineHeight: 1.45,
    opacity: 0.92,
  },

  // --- Body
  body: {
    padding: "12px 16px",
  },

  // --- Feedback
  feedbackZone: {
    padding: "0 16px",
    minHeight: 40,
    display: "flex",
    alignItems: "center",
  },
  feedbackPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    border: "1px solid rgba(0,0,0,0.10)",
    boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
  },
  feedbackSuccess: { background: "rgba(34,197,94,0.15)" },
  feedbackError: { background: "rgba(239,68,68,0.15)" },
  feedbackWarn: { background: "rgba(245,158,11,0.15)" },
  feedbackInfo: { background: "rgba(59,130,246,0.15)" },

  // --- Controls
  controlBar: {
    padding: "12px 16px 16px 16px",
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  controlsLeft: { display: "flex", gap: 10 },
  controlsRight: { display: "flex", gap: 10 },

  buttonPrimary: {
    border: "none",
    background: "black",
    color: "white",
    padding: "12px 16px",
    borderRadius: 14,
    fontSize: 14,
    fontWeight: 800,
    minWidth: 120,
  },
  buttonSecondary: {
    border: "1px solid rgba(0,0,0,0.14)",
    background: "rgba(0,0,0,0.03)",
    color: "black",
    padding: "12px 14px",
    borderRadius: 14,
    fontSize: 14,
    fontWeight: 700,
  },

  // --- Task body common primitives
  stack: { display: "flex", flexDirection: "column", gap: 12 },

  card: {
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "white",
    padding: "14px 14px",
    boxShadow: "0 8px 18px rgba(0,0,0,0.06)",
  },
  cardTitle: { fontSize: 14, fontWeight: 900, marginBottom: 6 },
  cardSub: { fontSize: 14, opacity: 0.9, lineHeight: 1.45 },

  optionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10,
  },
  option: {
    width: "100%",
    textAlign: "left",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "white",
    padding: "14px 14px",
    boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  optionSelected: {
    border: "1px solid rgba(0,0,0,0.35)",
    boxShadow: "0 12px 26px rgba(0,0,0,0.12)",
  },
  optionBullet: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "rgba(0,0,0,0.04)",
    fontWeight: 900,
    fontSize: 12,
    flex: "0 0 auto",
  },
  optionText: { fontSize: 14, lineHeight: 1.35, fontWeight: 700 },

  microHelp: {
    fontSize: 12,
    opacity: 0.72,
    padding: "0 2px",
  },
};

export default CHROME_THEME;
