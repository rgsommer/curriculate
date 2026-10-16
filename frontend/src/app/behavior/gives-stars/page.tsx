"use client";

// "I gave stars this week" — opened from the encouragement nudge email (no
// login). The teacher reports how many physical ⭐ stars they handed out; they
// count toward this week's encouragements. Not an opt-out: next week the nudge
// comes again unless they log encouragements or report stars again.
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../_lib/api";
import { Button } from "../_components/ui";

const QUICK = [{ label: "1–2", n: 2 }, { label: "3–4", n: 4 }, { label: "5 or more", n: 5 }];

function StarsInner() {
  const params = useSearchParams();
  const s = params.get("s") || "", t = params.get("t") || "", k = params.get("k") || "";
  const [custom, setCustom] = useState("");
  const [state, setState] = useState<"ask" | "busy" | "done" | "error">("ask");
  const [msg, setMsg] = useState("");
  const [count, setCount] = useState(0);

  async function report(n: number) {
    if (!n || n < 1) { setMsg("How many stars?"); return; }
    setState("busy"); setMsg("");
    try {
      await api("/public/stars-report", { body: { s, t, k, count: n } });
      setCount(n); setState("done");
    } catch (e: any) { setMsg(e?.message || "Couldn't save — please try again."); setState("error"); }
  }

  if (!s || !t || !k) {
    return <Card><h1 className="text-xl font-semibold">Link incomplete</h1><p className="mt-2 text-slate-600">Please use the link from your Compass email.</p></Card>;
  }
  if (state === "done") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-green-700">Thanks — {count} ⭐ recorded</h1>
        <p className="mt-2 text-slate-600">They count toward your encouragements this week. Next week, report again (or log encouragements in Compass) so they keep counting.</p>
        <Link href="/behavior" className="mt-4 inline-block underline">Open Compass</Link>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="text-xl font-semibold">⭐ How many stars did you hand out this week?</h1>
      <p className="mt-1 text-sm text-slate-600">Compass can&apos;t see the physical stars students drop in their house bottle, so a quick count here makes sure your recognition counts.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK.map((q) => <Button key={q.label} onClick={() => report(q.n)} disabled={state === "busy"} variant="secondary">{q.label}</Button>)}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} max={200} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Exact number" aria-label="Exact number of stars" className="w-36 rounded-lg border border-slate-300 px-3 py-2" />
        <Button onClick={() => report(Math.round(Number(custom)))} disabled={state === "busy" || !custom}>Save</Button>
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      <p className="mt-4 text-xs text-slate-500">This doesn&apos;t switch reminders off — it just counts this week.</p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6">{children}</div>;
}

export default function GivesStarsPage() {
  return <Suspense fallback={<p className="text-slate-500">Loading…</p>}><StarsInner /></Suspense>;
}
