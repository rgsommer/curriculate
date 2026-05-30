// teacher-app/src/components/ui/Modal.jsx
//
// Shared modal primitive for the teacher app. The audit found the
// position:fixed/inset:0/backdrop/card pattern duplicated inline in at least
// 4 places (TaskSets's Regenerate modal, Fix dialog, Report modal;
// LiveSession's quick-task modal) — each with subtly different shadow/width.
// Standardize them all here.
//
// API:
//   <Modal open={isOpen} onClose={close} title="Confirm" size="md">
//     <p>Are you sure?</p>
//     <Modal.Footer>
//       <Button variant="ghost" onClick={close}>Cancel</Button>
//       <Button onClick={confirm}>OK</Button>
//     </Modal.Footer>
//   </Modal>
//
// Sizes: sm (380px) | md (560px) | lg (920px) | xl (1180px)
// - Click outside or press Esc to close (closeOnBackdrop / closeOnEsc props
//   default true; set false for high-stakes dialogs).

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { COLORS, RADII, SHADOWS, SPACING } from "./tokens";

const SIZE_MAX = {
  sm: 380,
  md: 560,
  lg: 920,
  xl: 1180,
};

function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true,
  hideClose = false,
}) {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  const maxWidth = SIZE_MAX[size] || SIZE_MAX.md;

  return createPortal(
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: COLORS.bgOverlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: SPACING.lg,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        style={{
          background: COLORS.bg,
          borderRadius: RADII.lg,
          boxShadow: SHADOWS.modal,
          width: `min(${maxWidth}px, 100%)`,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {(title || !hideClose) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${SPACING.lg}px ${SPACING.xl}px`,
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: COLORS.textPrimary,
              }}
            >
              {title || ""}
            </h2>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.5rem",
                  color: COLORS.textMuted,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "4px 8px",
                  borderRadius: RADII.sm,
                }}
              >
                ×
              </button>
            )}
          </div>
        )}

        <div style={{ padding: `${SPACING.lg}px ${SPACING.xl}px`, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalFooter({ children, align = "right" }) {
  return (
    <div
      style={{
        display: "flex",
        gap: SPACING.sm,
        justifyContent: align === "right" ? "flex-end" : align === "between" ? "space-between" : "flex-start",
        marginTop: SPACING.lg,
        paddingTop: SPACING.lg,
        borderTop: `1px solid ${COLORS.borderSubtle}`,
      }}
    >
      {children}
    </div>
  );
}

Modal.Footer = ModalFooter;

export default Modal;
