// teacher-app/src/components/ThemePicker.jsx
//
// Pass-4. Persistent theme selector for Game Master Mode. The same
// underlying session — but the teacher picks the world the broadcast
// layer dresses itself in (Ancient Egypt, Mission Control, Game
// Show, Dragon Realm). Lives next to the SessionModeToggle.
//
// Persists via localStorage so the teacher's go-to theme survives
// page reloads + cross-tab.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { THEMES, DEFAULT_THEME_ID, getTheme, listThemes } from "./themes";

const STORAGE_KEY = "curriculate.sessionTheme";

export function useTheme() {
  const [themeId, setThemeIdState] = useState(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      return v && THEMES[v] ? v : DEFAULT_THEME_ID;
    } catch {
      return DEFAULT_THEME_ID;
    }
  });

  const setThemeId = useCallback((next) => {
    const safe = THEMES[next] ? next : DEFAULT_THEME_ID;
    setThemeIdState(safe);
    try { window.localStorage.setItem(STORAGE_KEY, safe); } catch {}
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue && THEMES[e.newValue]) {
        setThemeIdState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [themeId, setThemeId, getTheme(themeId)];
}

/**
 * ThemePicker — a compact dropdown. Closed: shows the active theme
 * emoji + name in a pill. Open: lists every theme with blurb. The
 * dropdown uses the active theme's accent colour for the highlight
 * so the visual feels coherent with whichever world the teacher is
 * currently in.
 */
export default function ThemePicker({ themeId, onChange }) {
  const theme = getTheme(themeId);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      ref={ref}
      data-testid="theme-picker"
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          border: `1px solid ${theme.surfaceBorder}`,
          background: theme.chipBg,
          color: theme.text,
          fontWeight: 800,
          fontSize: "0.85rem",
          cursor: "pointer",
          letterSpacing: 0.2,
          transition: "transform 0.16s ease-out, background 0.2s ease-out",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
      >
        <span aria-hidden="true">{theme.emoji}</span>
        <span>{theme.name}</span>
        <span style={{ opacity: 0.6, fontSize: "0.7rem" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          role="listbox"
          data-testid="theme-picker-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 260,
            padding: 6,
            borderRadius: 14,
            background: "#0f172a",
            border: `1px solid ${theme.accent}`,
            boxShadow: `0 16px 36px rgba(15,23,42,0.45), 0 0 18px ${theme.streakGlow}`,
            zIndex: 90,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {listThemes().map((t) => {
            const active = t.id === themeId;
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange?.(t.id); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: active ? t.chipBg : "transparent",
                  color: "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: 700,
                  transition: "background 0.15s ease-out",
                  outline: active ? `1px solid ${t.accent}` : "none",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span aria-hidden="true" style={{ fontSize: "1.15rem" }}>{t.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "0.9rem" }}>{t.name}</span>
                  <span style={{ display: "block", fontSize: "0.72rem", opacity: 0.65, fontWeight: 500 }}>
                    {t.blurb}
                  </span>
                </span>
                {active && <span aria-hidden="true" style={{ color: t.accent }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
