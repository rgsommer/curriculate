"use client";

import { useEffect, useRef, useState } from "react";

// In-app replacements for window.alert / confirm / prompt. The native ones look broken
// inside the iOS/Android apps (their title is the page URL) and block the page. These
// return promises, so call sites read almost the same:
//   cfAlert("Saved!")                      ← fire-and-forget is fine
//   if (!(await cfConfirm("Delete it?"))) return;
//   const v = await cfPrompt("Amount?", { inputMode: "decimal" });   // null = cancelled
// <DialogHost/> (mounted once in the Campfire layout) renders them one at a time. If
// it isn't mounted, calls fall back to the native dialogs so nothing is ever lost.

type ConfirmOpts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = {
  defaultValue?: string;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric" | "email";
  confirmLabel?: string;
};

type Req =
  | { kind: "alert"; message: string; resolve: () => void }
  | ({ kind: "confirm"; message: string; resolve: (v: boolean) => void } & ConfirmOpts)
  | ({ kind: "prompt"; message: string; resolve: (v: string | null) => void } & PromptOpts);

let push: ((r: Req) => void) | null = null;

export function cfAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (push) push({ kind: "alert", message, resolve });
    else {
      if (typeof window !== "undefined") window.alert(message);
      resolve();
    }
  });
}

export function cfConfirm(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (push) push({ kind: "confirm", message, resolve, ...opts });
    else resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  });
}

export function cfPrompt(message: string, opts: PromptOpts = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (push) push({ kind: "prompt", message, resolve, ...opts });
    else
      resolve(typeof window !== "undefined" ? window.prompt(message, opts.defaultValue) : null);
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [value, setValue] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => {
      push = null;
    };
  }, []);

  const cur = queue[0];

  // Reset the field and move focus into the dialog each time a new one appears.
  useEffect(() => {
    if (!cur) return;
    setValue(cur.kind === "prompt" ? cur.defaultValue ?? "" : "");
    const t = setTimeout(() => (cur.kind === "prompt" ? inputRef.current : okRef.current)?.focus(), 30);
    return () => clearTimeout(t);
  }, [cur]);

  if (!cur) return null;

  const close = (result: "ok" | "cancel") => {
    if (cur.kind === "alert") cur.resolve();
    else if (cur.kind === "confirm") cur.resolve(result === "ok");
    else cur.resolve(result === "ok" ? value : null);
    setQueue((q) => q.slice(1));
  };

  const danger = cur.kind === "confirm" && cur.danger;
  const okLabel =
    cur.kind === "alert" ? "OK" : cur.confirmLabel ?? (cur.kind === "confirm" ? "Yes" : "OK");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onKeyDown={(e) => {
        if (e.key === "Escape") close("cancel");
      }}
    >
      <div
        role={cur.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="cf-dialog-msg"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <p id="cf-dialog-msg" className="whitespace-pre-line text-base text-slate-800">
          {cur.message}
        </p>
        {cur.kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && close("ok")}
            inputMode={cur.inputMode}
            placeholder={cur.placeholder}
            className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {cur.kind !== "alert" && (
            <button
              type="button"
              onClick={() => close("cancel")}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {cur.kind === "confirm" ? cur.cancelLabel ?? "Cancel" : "Cancel"}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => close("ok")}
            className={`rounded-xl px-5 py-3 text-sm font-semibold text-white ${
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90"
            }`}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
