"use client";

// One-click: pull every class's current/Final grade from Edsby (admin session)
// and download a student × subject CSV. No setup screens — it just runs the
// honour-roll refresh and exports the subject grid in a single click.

import { useState } from "react";
import { api, getToken, loginHref } from "../behavior/_lib/api";
import { buildSubjectGridCsv, downloadCsvString } from "./gridCsv";

export default function OneClickFinalGrades() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind, text }

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/avgs/refresh", { method: "POST", body: {}, timeoutMs: 300000 });
      if (!r.ok) throw new Error(r.error);
      const students = r.snapshot?.students || [];
      const got = students.filter((s) => !s.error).length;
      if (!got) throw new Error("Edsby returned no grades. Make sure the admin session is connected and students have Edsby IDs.");
      downloadCsvString(buildSubjectGridCsv(students), "edsby-final-grades.csv");
      setMsg({ kind: "ok", text: `Pulled ${got} students → edsby-final-grades.csv downloaded.` });
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!getToken()) {
    return (
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Pull all final grades → CSV</h2>
        <p className="mt-1 text-sm text-slate-500">
          <a className="font-medium text-blue-600 hover:underline" href={loginHref("/avgs")}>Sign in</a> to pull grades from your school&apos;s Edsby.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-800">Pull all final grades → CSV</h2>
      <p className="mt-1 text-sm text-slate-500">
        One click: pulls every class&apos;s current/Final average from Edsby (admin session) and downloads a
        student × subject CSV. Uses your saved grade range and class weights from the Honour-roll setup below.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-4 rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Pulling from Edsby…" : "Pull final grades → CSV"}
      </button>
      {msg && (
        <p className={`mt-3 rounded-lg p-3 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
