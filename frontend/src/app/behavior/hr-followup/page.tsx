"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../_lib/api";
import { Button } from "../_components/ui";

function FollowupInner() {
  const params = useSearchParams();
  const school = params.get("school") || "";
  const student = params.get("student") || "";
  const token = params.get("token") || "";
  const [state, setState] = useState<"loading" | "confirm" | "invalid" | "busy" | "done" | "error">("loading");
  const [studentName, setStudentName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!school || !student || !token) { setState("invalid"); return; }
    api<{ ok: boolean; valid: boolean; studentName?: string; schoolName?: string }>(`/hr-followup/info?school=${encodeURIComponent(school)}&student=${encodeURIComponent(student)}&token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.valid) { setState("invalid"); return; }
        setStudentName(r.studentName || "this student");
        setSchoolName(r.schoolName || "");
        setState("confirm");
      })
      .catch(() => setState("invalid"));
  }, [school, student, token]);

  async function log() {
    setState("busy");
    try {
      await api("/hr-followup/log", { body: { school, student, token } });
      setState("done");
    } catch (e: any) {
      setMessage(e?.message || "Could not log the follow-up.");
      setState("error");
    }
  }

  if (state === "loading") return <p className="text-slate-500">Checking the link…</p>;

  if (state === "invalid") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-slate-800">Link expired</h1>
        <p className="mt-2 text-slate-600">This link is no longer valid (links expire a few weeks after the email is sent). You can still log the check-in from the app — tap the blue homeroom follow-up button beside the student.</p>
        <Link href="/behavior" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white">Open Compass</Link>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-green-700">Logged ✓</h1>
        <p className="mt-2 text-slate-600">Thanks for checking in with {studentName}. It&apos;s recorded as a supportive homeroom follow-up{schoolName ? ` at ${schoolName}` : ""} — not a strike, and nothing goes home.</p>
        <Link href="/behavior" className="mt-4 inline-block underline">Open Compass</Link>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-red-700">Couldn&apos;t log it</h1>
        <p className="mt-2 text-slate-600">{message}</p>
        <Link href="/behavior" className="mt-4 inline-block underline">Log it in the app instead</Link>
      </Card>
    );
  }

  // confirm / busy
  return (
    <Card>
      <h1 className="text-xl font-semibold">Mark that you&apos;ve talked to {studentName}?</h1>
      <p className="mt-2 text-slate-600">This logs a supportive homeroom follow-up — a documented check-in that never counts as a strike and sends nothing home.</p>
      <div className="mt-4 flex gap-2">
        <Button onClick={log} disabled={state === "busy"}>
          {state === "busy" ? "Logging…" : "✓ I've talked to them"}
        </Button>
        <Link href="/behavior" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600">Cancel</Link>
      </div>
    </Card>
  );
}

export default function HrFollowupPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <FollowupInner />
    </Suspense>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto mt-6 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
