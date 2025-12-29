import React from "react";
import { TOOLTIP_COPY } from "../shared/billingCopy.js";

/**
 * Minimal banner you can drop above locked UI sections.
 * Props:
 *  - kind: one of TOOLTIP_COPY keys
 *  - onUpgrade: callback to open your UpgradeModal
 */
export default function BillingGateBanner({ kind = "exportsPdf", onUpgrade }) {
  const copy = TOOLTIP_COPY[kind] || TOOLTIP_COPY.exportsPdf;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        background: "#fff",
        borderRadius: 14,
        padding: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{copy.title}</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>{copy.body}</div>
      </div>
      {onUpgrade && copy.cta && copy.cta !== "OK" && (
        <button
          type="button"
          onClick={onUpgrade}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          {copy.cta}
        </button>
      )}
    </div>
  );
}
