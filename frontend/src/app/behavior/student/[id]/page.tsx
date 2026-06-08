"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, getToken, loginHref } from "../../_lib/api";

type StudentDetail = {
  student: { firstName: string; lastName: string; preferredName?: string; classGroup?: string; grade?: string };
  activeCount: number;
  triggerCount: number;
  noticesHomeCount: number;
  incidents: Array<{
    _id: string;
    behaviorSnapshot: { name: string; triggerMode: string };
    detailText?: string;
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
    fromTeachers: Array<{ name: string; behaviorName: string }>;
  }>;
};

export default function StudentPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken() || !params?.id) return;
    api<StudentDetail>(`/students/${params.id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params?.id]);

  if (!getToken()) {
    return <p>Please <Link className="underline" href={loginHref("/behavior")}>sign in</Link>.</p>;
  }
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const s = data.student;
  const pct = Math.min(100, Math.round((data.activeCount / Math.max(1, data.triggerCount)) * 100));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior/log" className="text-sm text-slate-500 underline">
          ← back to logging
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {s.preferredName || s.firstName} {s.lastName}
        </h1>
        <p className="text-sm text-slate-400">{[s.classGroup, s.grade].filter(Boolean).join(" · ")}</p>
      </div>

      {/* Shared cross-teacher strike count. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Current strikes (all teachers)</h2>
          <span className="text-2xl font-bold">
            {data.activeCount}
            <span className="text-base font-normal text-slate-400"> / {data.triggerCount}</span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 66 ? "bg-amber-500" : "bg-slate-700"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-slate-500">{data.noticesHomeCount} notice(s) home this period.</p>
      </section>

      {/* Communication history. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Communication history</h2>
        {data.notices.length === 0 && <p className="mt-1 text-sm text-slate-400">No notices yet.</p>}
        <ul className="mt-2 space-y-2">
          {data.notices.map((n) => (
            <li key={n._id} className="rounded-lg border border-slate-200">
              <button
                onClick={() => setOpenNotice(openNotice === n._id ? null : n._id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="text-sm">
                  Notice #{n.sequenceNo} · {n.reason}
                  {n.ccVp ? " · VP CC" : ""}
                  <span className="ml-2 text-slate-400">{new Date(n.createdAt).toLocaleDateString()}</span>
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    n.status === "sent"
                      ? "bg-green-100 text-green-700"
                      : n.status === "cancelled"
                      ? "bg-slate-100 text-slate-500"
                      : n.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {n.status}
                </span>
              </button>
              {openNotice === n._id && (
                <div className="border-t border-slate-100 px-3 py-2">
                  <p className="text-xs text-slate-400">
                    {n.channels.join(", ")} · {n.aiUsed ? "AI-composed" : "template"} · from{" "}
                    {n.fromTeachers.map((t) => t.name || "teacher").join(", ")}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">
                    {n.renderedText}
                  </pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Incident log. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Incident log</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {data.incidents.map((inc) => (
            <li key={inc._id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {inc.behaviorSnapshot.name}
                {inc.behaviorSnapshot.triggerMode === "IMMEDIATE" && (
                  <span className="ml-2 text-xs text-amber-600">immediate</span>
                )}
                {inc.detailText ? <span className="text-slate-400"> — {inc.detailText}</span> : null}
              </span>
              <span className="text-slate-400">{new Date(inc.timestamp).toLocaleDateString()}</span>
            </li>
          ))}
          {data.incidents.length === 0 && <li className="py-2 text-slate-400">No incidents.</li>}
        </ul>
      </section>
    </div>
  );
}
