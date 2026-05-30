// teacher-app/src/components/ui/PageHeader.jsx
//
// Shared page header for the teacher app. Audit found each page rolls its
// own title + actions row with inconsistent max-width (1180 vs 960), margin
// (sometimes 0, sometimes implicit), and spacing.
//
// Usage:
//   <PageHeader
//     title="Task Sets"
//     subtitle="Manage and run your generated sets"
//     actions={<Button onClick={create}>+ New</Button>}
//   />

import React from "react";
import { COLORS, SPACING } from "./tokens";

export default function PageHeader({
  title,
  subtitle,
  actions,
  style,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: SPACING.lg,
        marginBottom: SPACING.xl,
        flexWrap: "wrap",
        ...style,
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        {title && (
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 800,
              color: COLORS.textPrimary,
              lineHeight: 1.2,
            }}
          >
            {title}
          </h1>
        )}
        {subtitle && (
          <div
            style={{
              marginTop: SPACING.xs,
              fontSize: "0.9rem",
              color: COLORS.textMuted,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: SPACING.sm,
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

// Optional page-shell wrapper for consistent container width + padding.
// Use around the page body so every page sits at the same max-width.
export function PageShell({ children, maxWidth = 1180, style }) {
  return (
    <div
      style={{
        maxWidth,
        margin: "0 auto",
        padding: SPACING.xl,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
