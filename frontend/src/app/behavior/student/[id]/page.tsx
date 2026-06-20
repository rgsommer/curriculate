"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../../_lib/api";
import { Markdown } from "../../_lib/Markdown";
import { Timeline, buildByMonth } from "../../_components/Timeline";
import SendNoticeModal from "../../_components/SendNoticeModal";

type TeacherNote = { name?: string; text: string; at: string };
type StudentDetail = {
  student: { firstName: string; lastName: string; preferredName?: string; classGroup?: string; grade?: string };
  activeCount: number;
  triggerCount: number;
  noticesHomeCount: number;
  incidents: Array<{
    _id: string;
    teacherId?: string;
    behaviorSnapshot: { name: string; triggerMode: string; kind?: string; points?: number };
    detailText?: string;
    teacherName?: string;
    teacherNotes?: TeacherNote[];
    timestamp: string;
    countedInNoticeId?: string | null;
    attachments?: Array<{ key: string; kind: "image" | "video"; contentType?: string; at?: string; url?: string | null }>;
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
    sentAt?: string;
    legacyImport?: boolean;
    triggeringIncidentIds?: string[];
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
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  // Incident edit/delete
  const [editIncId, setEditIncId] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState("");

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
  // Per-notice "request a meeting" toggle
  const [meetingFor, setMeetingFor] = useState<Record<string, boolean>>({});
  // Confirm-before-send preview pop-up
  const [sendModal, setSendModal] = useState<{ id: string; text: string; edited: boolean; evidenceCount: number } | null>(null);
  const [sendingModal, setSendingModal] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(false);

  // Log a parent meeting / contact (an interaction — no strike, nothing sent home)
  const [meetingNote, setMeetingNote] = useState("");
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [meetingMsg, setMeetingMsg] = useState("");

  const load = useCallback(() => {
    if (!params?.id) return;
    api<StudentDetail>(`/students/${params.id}`).then(setData).catch((e) => setError(e.message));
  }, [params?.id]);

  useEffect(() => {
    if (getToken()) api<Me>("/me").then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken() || !params?.id) return;
    load();
  }, [params?.id, load]);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior")}>sign in</Link>.</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const s = data.student;
  const pct = Math.min(100, Math.round((data.activeCount / Math.max(1, data.triggerCount)) * 100));
  const myId = me?.membership?._id;
  const isAdmin = me?.membership?.role === "originator" || me?.membership?.role === "admin";
  const canEditInc = (inc: { teacherId?: string }) => isAdmin || (!!myId && String(inc.teacherId) === String(myId));
  const byMonth = buildByMonth(data.incidents as any, data.notices as any);

  async function adminSummary(scope: "all" | "current") {
    setSummaryBusy(scope);
    setSummaryMsg("");
    setSummary("");
    try {
      const r = await api<{ summary: string; aiUsed: boolean }>(`/students/${params.id}/admin-summary`, { body: { scope }, timeoutMs: 45000 });
      setSummary(r.summary);
      setSummaryScope(scope);
      // Don't await the clipboard — a hung write must not block the busy reset.
      navigator.clipboard?.writeText(r.summary).then(
        () => setSummaryMsg(`Copied to clipboard${r.aiUsed ? "" : " (template — no AI key set)"}.`),
        () => setSummaryMsg("Generated below (clipboard blocked — copy manually)."),
      );
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

  // Save the edited wording but keep the notice queued (don't send yet).
  async function saveNoticeEdit(id: string) {
    try {
      await api(`/notices/${id}`, { method: "PUT", body: { renderedText: editText } });
      setEditId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Save the edited wording AND send it now.
  async function sendNoticeEdited(id: string) {
    try {
      await api(`/notices/${id}`, { method: "PUT", body: { renderedText: editText } });
      await api(`/notices/${id}/send`, { body: { requestMeeting: !!meetingFor[id], includeEvidence } });
      setEditId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function sendNotice(id: string) {
    try {
      await api(`/notices/${id}/send`, { body: { requestMeeting: !!meetingFor[id], includeEvidence } });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Count photo/video evidence on the incidents that triggered a given notice.
  function evidenceCountForNotice(n: { triggeringIncidentIds?: string[] }): number {
    const ids = new Set((n.triggeringIncidentIds || []).map(String));
    return (data?.incidents || [])
      .filter((i) => ids.has(String(i._id)))
      .reduce((sum, i) => sum + (i.attachments?.length || 0), 0);
  }
  function openSend(m: { id: string; text: string; edited: boolean; evidenceCount: number }) {
    setIncludeEvidence(false); // default: keep evidence teacher-side
    setSendModal(m);
  }

  // Confirm-before-send: runs the right send (edited or as-is) then closes the
  // preview pop-up.
  async function confirmSend() {
    if (!sendModal) return;
    setSendingModal(true);
    try {
      if (sendModal.edited) await sendNoticeEdited(sendModal.id);
      else await sendNotice(sendModal.id);
      setSendModal(null);
    } finally {
      setSendingModal(false);
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

  async function saveIncidentEdit(id: string) {
    try {
      await api(`/incidents/${id}`, { method: "PUT", body: { detailText: editDetail } });
      setEditIncId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function deleteIncident(id: string) {
    if (!window.confirm("Delete this incident? This removes it from the student's strikes and history.")) return;
    try {
      await api(`/incidents/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function logMeeting() {
    const text = meetingNote.trim();
    if (!text) return;
    setMeetingBusy(true);
    setMeetingMsg("");
    try {
      await api(`/students/${params.id}/meeting`, { body: { detailText: text } });
      setMeetingNote("");
      setMeetingMsg("Logged — kept in this student's record. No strike, nothing sent home.");
      load();
    } catch (e: any) {
      setMeetingMsg(e.message);
    } finally {
      setMeetingBusy(false);
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
      {/* Hide controls + chrome when printing this record. */}
      <style>{`@media print {
        .no-print { display: none !important; }
        nav, header, footer { display: none !important; }
        body { background: #fff !important; }
        section { break-inside: avoid; border-color: #cbd5e1 !important; }
      }`}</style>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href="/behavior/log" className="no-print text-sm text-slate-500 underline">← back to logging</Link>
          <h1 className="mt-1 text-xl font-semibold">{s.preferredName || s.firstName} {s.lastName}</h1>
          <p className="text-sm text-slate-400">{[s.classGroup, s.grade].filter(Boolean).join(" · ")}</p>
        </div>
        <button onClick={() => window.print()}
          className="no-print shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          Print / export ⎙
        </button>
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

      {/* Log a parent meeting / contact (interaction — no strike, nothing home) */}
      <section className="no-print rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Log a parent meeting / contact</h2>
        <p className="text-xs text-slate-400">Keeps a dated record (e.g. phone call, conference). Does not count as a strike and sends nothing home.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={meetingNote}
            onChange={(e) => setMeetingNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && logMeeting()}
            placeholder="e.g. Called mum re: homework — agreed to check planner nightly"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button onClick={logMeeting} disabled={meetingBusy || !meetingNote.trim()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
            {meetingBusy ? "Logging…" : "Log meeting"}
          </button>
        </div>
        {meetingMsg && <p className="mt-2 text-sm text-green-700">{meetingMsg}</p>}
      </section>

      {/* Trend over time */}
      {Object.keys(byMonth).length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Trend over time</h2>
          <div className="mt-3">
            <Timeline byMonth={byMonth} />
          </div>
        </section>
      )}

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
                      {(n.status === "queued" || n.status === "failed") && (
                        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={!!meetingFor[n._id]} onChange={(e) => setMeetingFor((m) => ({ ...m, [n._id]: e.target.checked }))} />
                          Also request a meeting with the parents
                        </label>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(n.status === "queued" || n.status === "failed") && (
                          <button onClick={() => openSend({ id: n._id, text: editText, edited: true, evidenceCount: evidenceCountForNotice(n) })} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">
                            {n.status === "failed" ? "Save & retry send" : "Send now"}
                          </button>
                        )}
                        <button onClick={() => saveNoticeEdit(n._id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Save (keep queued)</button>
                        <button onClick={() => setEditId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Save keeps the note in the queue until you press Send.</p>
                    </div>
                  ) : (
                    <>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{n.renderedText}</pre>
                      {(n.status === "queued" || n.status === "failed") && (
                        <>
                          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                            <input type="checkbox" checked={!!meetingFor[n._id]} onChange={(e) => setMeetingFor((m) => ({ ...m, [n._id]: e.target.checked }))} />
                            Also request a meeting with the parents
                          </label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button onClick={() => openSend({ id: n._id, text: n.renderedText, edited: false, evidenceCount: evidenceCountForNotice(n) })} className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white">
                              {n.status === "failed" ? "Retry send" : "Send now"}
                            </button>
                            <button onClick={() => dontSend(n._id)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Don’t send</button>
                            <button onClick={() => { setEditId(n._id); setEditText(n.renderedText); }} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Edit note</button>
                          </div>
                        </>
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
              <div className="flex items-start justify-between gap-2">
                <span>
                  {inc.behaviorSnapshot.name}
                  {inc.behaviorSnapshot.triggerMode === "IMMEDIATE" && <span className="ml-2 text-xs text-amber-600">immediate</span>}
                  {inc.teacherName ? <span className="text-slate-400"> · {inc.teacherName}</span> : null}
                  {editIncId !== inc._id && inc.detailText ? <span className="text-slate-400"> — {inc.detailText}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 pl-2 text-slate-400">
                  {fmtDT(inc.timestamp)}
                  {canEditInc(inc) && editIncId !== inc._id && (
                    <>
                      <button onClick={() => { setEditIncId(inc._id); setEditDetail(inc.detailText || ""); }} className="text-xs text-slate-500 underline">edit</button>
                      <button onClick={() => deleteIncident(inc._id)} className="text-xs text-red-600 underline">delete</button>
                    </>
                  )}
                </span>
              </div>
              {editIncId === inc._id && (
                <div className="mt-1 flex gap-2 pl-3">
                  <input value={editDetail} onChange={(e) => setEditDetail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveIncidentEdit(inc._id)}
                    placeholder="Detail / comment…" className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs" autoFocus />
                  <button onClick={() => saveIncidentEdit(inc._id)} className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white">Save</button>
                  <button onClick={() => setEditIncId(null)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Cancel</button>
                </div>
              )}

              {(inc.attachments || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2 pl-3">
                  {inc.attachments!.map((a, i) =>
                    a.url ? (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100" title="Open evidence">
                        {a.kind === "video" ? (
                          <video src={a.url} className="h-full w-full object-cover" muted />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.url} alt="evidence" className="h-full w-full object-cover" />
                        )}
                      </a>
                    ) : (
                      <span key={i} className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">{a.kind}</span>
                    )
                  )}
                </div>
              )}

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

      <SendNoticeModal
        open={!!sendModal}
        studentName={s.preferredName || s.firstName}
        channelLabel="Edsby"
        noteText={sendModal?.text || ""}
        requestMeeting={!!(sendModal && meetingFor[sendModal.id])}
        onToggleMeeting={(v) => sendModal && setMeetingFor((m) => ({ ...m, [sendModal.id]: v }))}
        evidenceCount={sendModal?.evidenceCount || 0}
        includeEvidence={includeEvidence}
        onToggleEvidence={setIncludeEvidence}
        busy={sendingModal}
        onConfirm={confirmSend}
        onClose={() => setSendModal(null)}
      />
    </div>
  );
}
