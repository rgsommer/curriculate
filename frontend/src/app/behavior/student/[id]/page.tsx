"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, getToken, loginHref } from "../../_lib/api";
import { Markdown } from "../../_lib/Markdown";

type TeacherNote = { name?: string; text: string; at: string };
type StudentDetail = {
  student: { firstName: string; lastName: string; preferredName?: string; classGroup?: string; grade?: string };
  activeCount: number;
  triggerCount: number;
  noticesHomeCount: number;
  incidents: Array<{
    _id: string;
    behaviorSnapshot: { name: string; triggerMode: string };
    detailText?: string;
    teacherName?: string;
    teacherNotes?: TeacherNote[];
    timestamp: string;
    countedInNoticeId?: string | null;
  }>;
  notices: Array<{
    _id: string;
    sequenceNo: number;
    reason: string;
    ccVp: boolean;
    channels: string[];
    status: string;
    aiUsed: boolean;
    renderedText: string;
    createdAt: string;
    cancelUntil?: string;
    autoDispatch?: boolean;
    deliveries?: Array<{ channel: string; ok: boolean; error?: string }>;
    fromTeachers: Array<{ name: string; behaviorName: string }>;
  }>;
};

const fmtDT = (d: string) =>
  new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function StudentPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  // Admin summary
  const [summary, setSummary] = useState<string>("");
  const [summaryScope, setSummaryScope] = useState<"all" | "current">("all");
  const [summaryMsg, setSummaryMsg] = useState<string>("");
  const [summaryBusy, setSummaryBusy] = useState<"" | "all" | "current">("");
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  // Notice editing
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Per-incident note inputs
  const [noteText, setNoteText] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!params?.id) return;
    api<StudentDetail>(`/students/${params.id}`).then(setData).catch((e) => setError(e.message));
  }, [params?.id]);

  useEffect(() => {
    if (!getToken() || !params?.id) return;
    load();
  }, [params?.id, load]);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior")}>sign in</Link>.</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const s = data.student;
  const pct = Math.min(100, Math.round((data.activeCount / Math.max(1, data.triggerCount)) * 100));

  async function adminSummary(scope: "all" | "current") {
    setSummaryBusy(scope);
    setSummaryMsg("");
    setSummary("");
    try {
      const r = await api<{ summary: string; aiUsed: boolean }>(`/students/${params.id}/admin-summary`, { body: { scope }, timeoutMs: 45000 });
      setSummary(r.summary);
      setSummaryScope(scope);
      try {
        await navigator.clipboard.writeText(r.summary);
        setSummaryMsg(`Copied to clipboard${r.aiUsed ? "" : " (template — no AI key set)"}.`);
      } catch {
        setSummaryMsg("Generated below (clipboard blocked — copy manually).");
      }
    } catch (e: any) {
      setSummaryMsg(e.message);
    } finally {
      setSummaryBusy("");
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setSummaryMsg("Copied to clipboard.");
    } catch {
      setSummaryMsg("Clipboard blocked — select and copy manually.");
    }
  }

  async function emailSummary() {
    setEmailBusy(true);
    setSummaryMsg("");
    try {
      const r = await api<{ emailed: boolean; emailError?: string }>(`/students/${params.id}/admin-summary`, {
        body: { scope: summaryScope, email: true, to: emailTo.trim(), summaryText: summary },
      });
      setSummaryMsg(r.emailed ? `Emailed to you${emailTo.trim() ? ` + ${emailTo.trim()}` : ""}.` : `Email failed: ${r.emailError || "check email settings"}`);
    } catch (e: any) {
      setSummaryMsg(e.message);
    } finally {
      setEmailBusy(false);
    }
  }

  async function saveNoticeEdit(id: string) {
    try {
      await api(`/notices/${id}`, { method: "PUT", body: { renderedText: editText } });
      setEditId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function sendNotice(id: string) {
    try {
      await api(`/notices/${id}/send`, { body: {} });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function dontSend(id: string) {
    try {
      await api(`/notices/${id}/cancel`, { body: {} });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addNote(incidentId: string) {
    const text = (noteText[incidentId] || "").trim();
    if (!text) return;
    try {
      await api(`/incidents/${incidentId}/notes`, { body: { text } });
      setNoteText((p) => ({ ...p, [incidentId]: "" }));
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior/log" className="text-sm text-slate-500 underline">← back to logging</Link>
        <h1 className="mt-1 text-xl font-semibold">{s.preferredName || s.firstName} {s.lastName}</h1>
        <p className="text-sm text-slate-400">{[s.classGroup, s.grade].filter(Boolean).join(" · ")}</p>
      </div>

      {/* Strikes + admin summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Current strikes (all teachers)</h2>
          <span className="text-2xl font-bold">
            {data.activeCount}
            <span className="text-base font-normal text-slate-400"> / {data.triggerCount}</span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 66 ? "bg-amber-500" : "bg-slate-700"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-500">{data.noticesHomeCount} notice(s) home this period.</p>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-700">Admin summary (AI) → clipboard</p>
          <p className="text-xs text-slate-400">Includes private teacher notes. For VP/principal — not sent to parents.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => adminSummary("all")} disabled={!!summaryBusy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
              {summaryBusy === "all" ? "Generating…" : "Full history"}
            </button>
            <button onClick={() => adminSummary("current")} disabled={!!summaryBusy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
              {summaryBusy === "current" ? "Generating…" : "Current trigger only"}
            </button>
          </div>
          {summaryMsg && <p className="mt-2 text-sm text-green-700">{summaryMsg}</p>}
          {summary && (
            <>
              <button
                onClick={copySummary}
                title="Click to copy"
                className="mt-2 block w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                <Markdown text={summary} />
                <span className="mt-2 block text-xs text-slate-400">Tap to copy ⧉</span>
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="also email to (optional), e.g. VP's address"
                  className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button onClick={emailSummary} disabled={emailBusy}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
                  {emailBusy ? "Emailing…" : "Email to me"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Communication history */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Communication history</h2>
        {data.notices.length === 0 && <p className="mt-1 text-sm text-slate-400">No notices yet.</p>}
        <ul className="mt-2 space-y-2">
          {data.notices.map((n) => (
            <li key={n._id} className="rounded-lg border border-slate-200">
              <button onClick={() => setOpenNotice(openNotice === n._id ? null : n._id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left">
                <span className="text-sm">
                  Notice #{n.sequenceNo} · {n.reason}{n.ccVp ? " · VP CC" : ""}
                  <span className="ml-2 text-slate-400">{new Date(n.createdAt).toLocaleDateString()}</span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${
                  n.status === "sent" ? "bg-green-100 text-green-700"
                  : n.status === "cancelled" ? "bg-slate-100 text-slate-500"
                  : n.status === "failed" ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"}`}>
                  {n.status}
                </span>
              </button>
              {openNotice === n._id && (
                <div className="border-t border-slate-100 px-3 py-2">
                  <p className="text-xs text-slate-400">
                    {n.channels.join(", ")} · {n.aiUsed ? "AI-composed" : "template"} · from{" "}
                    {n.fromTeachers.map((t) => t.name || "teacher").join(", ")}
                  </p>
                  {n.status === "queued" && (
                    <p className="mt-1 text-xs text-amber-700">
                      {n.autoDispatch
                        ? `Sends automatically${n.cancelUntil ? ` around ${fmtDT(n.cancelUntil)}` : " shortly"} (within a minute after the review window).`
                        : "Awaiting manual send."}
                    </p>
                  )}
                  {editId === n._id ? (
                    <div className="mt-2">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={10}
                        className="w-full rounded-lg border border-slate-300 p-2 font-sans text-sm" />
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => saveNoticeEdit(n._id)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">Save</button>
                        <button onClick={() => setEditId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{n.renderedText}</pre>
                      {(n.status === "queued" || n.status === "failed") && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button onClick={() => sendNotice(n._id)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white">
                            {n.status === "failed" ? "Retry send" : "Send now"}
                          </button>
                          <button onClick={() => dontSend(n._id)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Don’t send</button>
                          <button onClick={() => { setEditId(n._id); setEditText(n.renderedText); }} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Edit note</button>
                        </div>
                      )}
                      {n.status === "failed" && (
                        <p className="mt-1 text-xs text-red-600">
                          Delivery failed{n.deliveries?.some((d: any) => !d.ok) ? `: ${n.deliveries.find((d: any) => !d.ok)?.error || ""}` : ""}. Fix the channel (e.g. re-paste the Edsby cookie + Test connection in Setup) and Retry send.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Incident log + teacher notes */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Incident log</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {data.incidents.map((inc) => (
            <li key={inc._id} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <span>
                  {inc.behaviorSnapshot.name}
                  {inc.behaviorSnapshot.triggerMode === "IMMEDIATE" && <span className="ml-2 text-xs text-amber-600">immediate</span>}
                  {inc.teacherName ? <span className="text-slate-400"> · {inc.teacherName}</span> : null}
                  {inc.detailText ? <span className="text-slate-400"> — {inc.detailText}</span> : null}
                </span>
                <span className="shrink-0 pl-2 text-slate-400">{fmtDT(inc.timestamp)}</span>
              </div>

              {(inc.teacherNotes || []).length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-3">
                  {inc.teacherNotes!.map((tn, i) => (
                    <li key={i} className="text-xs text-slate-500">
                      📝 {tn.text} <span className="text-slate-400">— {tn.name || "teacher"}, {new Date(tn.at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-1 flex gap-2 pl-3">
                <input
                  value={noteText[inc._id] || ""}
                  onChange={(e) => setNoteText((p) => ({ ...p, [inc._id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addNote(inc._id)}
                  placeholder="Add a private teacher note (not sent to parents)…"
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <button type="button" onClick={() => addNote(inc._id)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  Add note
                </button>
              </div>
            </li>
          ))}
          {data.incidents.length === 0 && <li className="py-2 text-slate-400">No incidents.</li>}
        </ul>
      </section>
    </div>
  );
}
