// student-app/src/components/tasks/taskStyles.js
// Centralized, kid-friendly “Curriculate” task styling tokens + small helpers.
// Goal: keep TaskRunner lean and let tasks share a consistent look without a UI framework.

export const COLORS = {
  ink: "#0f172a",
  inkSoft: "#334155",
  muted: "#64748b",
  border: "rgba(15, 23, 42, 0.10)",
  borderStrong: "rgba(15, 23, 42, 0.14)",
  cardBg: "rgba(255,255,255,0.86)",
  cardBgStrong: "rgba(255,255,255,0.92)",
  wash: "rgba(255,255,255,0.60)",
  accentA: "rgba(34,197,94,0.70)",   // green
  accentB: "rgba(14,165,233,0.70)",  // sky
  danger: "rgba(239,68,68,0.18)",
  success: "rgba(34,197,94,0.18)",
};

export const RADII = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
};

export const SHADOWS = {
  soft: "0 14px 44px rgba(15, 23, 42, 0.10)",
  pop: "0 18px 55px rgba(15, 23, 42, 0.16)",
};

export const UI = {
  card: (overrides = {}) => ({
    borderRadius: RADII.lg,
    border: `1px solid ${COLORS.border}`,
    background: COLORS.cardBg,
    boxShadow: SHADOWS.soft,
    ...overrides,
  }),

  header: (overrides = {}) => ({
    fontWeight: 950,
    fontSize: 22,
    letterSpacing: 0.2,
    color: COLORS.ink,
    margin: 0,
    ...overrides,
  }),

  subheader: (overrides = {}) => ({
    fontWeight: 800,
    color: COLORS.inkSoft,
    opacity: 0.92,
    marginTop: 6,
    lineHeight: 1.25,
    ...overrides,
  }),

  sectionLabel: (overrides = {}) => ({
    fontWeight: 950,
    fontSize: 13,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: COLORS.muted,
    ...overrides,
  }),

  pill: (overrides = {}) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: RADII.pill,
    border: `1px solid ${COLORS.border}`,
    background: COLORS.wash,
    color: COLORS.ink,
    fontWeight: 900,
    fontSize: 12,
    ...overrides,
  }),

  button: ({ kind = "primary", disabled = false } = {}, overrides = {}) => {
    const base = {
      borderRadius: RADII.pill,
      padding: "10px 14px",
      fontWeight: 950,
      cursor: disabled ? "not-allowed" : "pointer",
      border: `1px solid ${COLORS.borderStrong}`,
      userSelect: "none",
      transition: "transform 120ms ease, filter 120ms ease, opacity 120ms ease",
      opacity: disabled ? 0.6 : 1,
    };

    if (kind === "ghost") {
      return {
        ...base,
        background: "rgba(255,255,255,0.65)",
        color: COLORS.ink,
        ...overrides,
      };
    }

    if (kind === "danger") {
      return {
        ...base,
        background: "rgba(239,68,68,0.18)",
        color: COLORS.ink,
        ...overrides,
      };
    }

    // primary
    return {
      ...base,
      background: disabled
        ? "rgba(255,255,255,0.55)"
        : `linear-gradient(135deg, ${COLORS.accentA}, ${COLORS.accentB})`,
      color: COLORS.ink,
      ...overrides,
    };
  },

  input: (overrides = {}) => ({
    width: "100%",
    padding: "12px 12px",
    borderRadius: RADII.md,
    border: `1px solid ${COLORS.borderStrong}`,
    background: "rgba(255,255,255,0.92)",
    color: COLORS.ink,
    fontWeight: 800,
    outline: "none",
    ...overrides,
  }),
};

// Small utility for task titles / labels (no dashes, proper case)
export function toProperCaseLabel(raw) {
  const words = String(raw || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
