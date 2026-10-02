"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../_lib/api";

function ActionInner() {
  const params = useSearchParams();
  const school = params.get("school") || "";
  const id = params.get("id") || "";
  const action = params.get("action") || "";
  const token = params.get("token") || "";
  const [state, setState] = useState<"loading" | "confirm" | "invalid" | "busy" | "done" | "error">("loading");
  const [studentName, setStudentName] = useState("");
  const [type, setType] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [message, setMessage] = useState("");

  const isIssue = action === "issue";
  const verb = isIssue ? "issued" : "done";
  const cta = isIssue ? "✓ Mark white slip as issued" : "✓ Mark as done";

  useEffect(() => {
    if (!school || !id || !token) { setState("invalid"); return; }
    api<{ ok: boolean; valid: boolean; studentName?: string; type?: string; schoolName?: string }>(
      `/consequence-action/info?school=${encodeURIComponent(school)}&id=${encodeURIComponent(id)}&action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.valid) { setState("invalid"); return; }
        setStudentName(r.studentName || "this student");
        setType(r.type || "");
        setSchoolName(r.schoolName || "");
        setState("confirm");
      })
      .catch(() => setState("invalid"));
  }, [school, id, action, token]);

  async function log() {
    setState("busy");
    try {
      await api("/consequence-action/log", { body: { school, id, action, token } });
      setState("done");
    } catch (e: any) {
      setMessage(e?.message || "Could not record it.");
      setState("error");
    }
  }

  if (state === "loading") return <p className="text-slate-500">Checking the link…</p>;

  if (state === "invalid") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-slate-800">Link expired</h1>
        <p className="mt-2 text-slate-600">This link is no longer valid (links expire a few weeks after the email is sent). You can still action it in the app.</p>
        <Link href="/behavior" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white">Open Compass</Link>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-green-700">Recorded ✓</h1>
        <p className="mt-2 text-slate-600">{type || "The consequence"} for {studentName} is marked as {verb}{schoolName ? ` at ${schoolName}` : ""}. Thank you.</p>
        <Link href="/behavior" className="mt-4 inline-block underline">Open Compass</Link>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-red-700">Couldn&apos;t record it</h1>
        <p className="mt-2 text-slate-600">{message}</p>
        <Link href="/behavior" className="mt-4 inline-block underline">Action it in the app instead</Link>
      </Card>
    );
  }

  // confirm / busy
  return (
    <Card>
      <h1 className="text-xl font-semibold">Confirm: {type || "consequence"} {verb} for {studentName}?</h1>
      <p className="mt-2 text-slate-600">
        {isIssue
          ? `This records that the white slip for ${studentName} has been issued.`
          : `This marks the consequence for ${studentName} as completed.`}
      </p>
      <div className="mt-4 flex gap-2">
        <button onClick={log} disabled={state === "busy"} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {state === "busy" ? "Recording…" : cta}
        </button>
        <Link href="/behavior" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600">Cancel</Link>
      </div>
    </Card>
  );
}

export default function ConsequenceActionPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <ActionInner />
    </Suspense>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto mt-6 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
