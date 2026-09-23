"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../_lib/api";

function ResetInner() {
  const params = useSearchParams();
  const school = params.get("school") || "";
  const token = params.get("token") || "";
  const [state, setState] = useState<"loading" | "confirm" | "invalid" | "busy" | "done" | "error">("loading");
  const [schoolName, setSchoolName] = useState("");
  const [name, setName] = useState("GUDD");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!school || !token) { setState("invalid"); return; }
    api<{ ok: boolean; valid: boolean; schoolName?: string; name?: string }>(`/gudd/reset-info?school=${encodeURIComponent(school)}&token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.valid) { setState("invalid"); return; }
        setSchoolName(r.schoolName || "");
        setName(r.name || "GUDD");
        setState("confirm");
      })
      .catch(() => setState("invalid"));
  }, [school, token]);

  async function doReset() {
    setState("busy");
    try {
      await api("/gudd/reset-link", { body: { school, token } });
      setState("done");
    } catch (e: any) {
      setMessage(e?.message || "Could not reset the list.");
      setState("error");
    }
  }

  if (state === "loading") return <p className="text-slate-500">Checking the link…</p>;

  if (state === "invalid") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-slate-800">Link expired</h1>
        <p className="mt-2 text-slate-600">
          This reset link is no longer valid (links expire a few weeks after the report is sent). You can still reset the list from Setup.
        </p>
        <Link href="/behavior/setup" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white">Open Setup</Link>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-green-700">{name} list reset ✓</h1>
        <p className="mt-2 text-slate-600">
          A fresh period has started{schoolName ? ` for ${schoolName}` : ""}. Earlier uniform infractions stay in the history but no longer count toward the {name}.
        </p>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-red-700">Couldn&apos;t reset the list</h1>
        <p className="mt-2 text-slate-600">{message}</p>
        <Link href="/behavior/setup" className="mt-4 inline-block underline">Reset it from Setup instead</Link>
      </Card>
    );
  }

  // confirm / busy
  return (
    <Card>
      <h1 className="text-xl font-semibold">Reset the {name} list?</h1>
      <p className="mt-2 text-slate-600">
        This starts a fresh {name} period{schoolName ? ` for ${schoolName}` : ""}. Earlier uniform infractions stay in the history but stop counting toward the {name}. This is what &ldquo;clearing the list&rdquo; does.
      </p>
      <div className="mt-4 flex gap-2">
        <button onClick={doReset} disabled={state === "busy"}
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {state === "busy" ? "Resetting…" : `Reset the ${name} list`}
        </button>
        <Link href="/behavior" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600">Cancel</Link>
      </div>
    </Card>
  );
}

export default function GuddResetPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <ResetInner />
    </Suspense>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto mt-6 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
