"use client";

// A confirm-before-send pop-up that shows the EXACT note a parent will receive,
// so a teacher always sees the final wording (greeting + signature) before it
// goes out. Used wherever a notice can be sent.

type Props = {
  open: boolean;
  studentName?: string;
  channelLabel?: string; // e.g. "Edsby"
  noteText: string;
  requestMeeting: boolean;
  onToggleMeeting: (v: boolean) => void;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export default function SendNoticeModal({
  open, studentName, channelLabel, noteText, requestMeeting, onToggleMeeting, busy, onConfirm, onClose,
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">Send this note to the parent?</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            This is exactly what {studentName ? `${studentName}'s` : "the"} parent will receive{channelLabel ? ` via ${channelLabel}` : ""}. Please read it before sending.
          </p>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3">
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{noteText || "(no content)"}</pre>
        </div>
        <div className="border-t border-slate-200 px-5 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={requestMeeting} onChange={(e) => onToggleMeeting(e.target.checked)} />
            Also request a meeting with the parents
          </label>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
              Cancel
            </button>
            <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Sending…" : "Confirm & send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
