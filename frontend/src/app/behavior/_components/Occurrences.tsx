"use client";

// Dashboard "tap a student" pattern, shared by Needs a decision and Students to
// encourage:
//   • single tap on the name  → expand a compact list (date · offence · teacher)
//   • double tap on the name  → open the student's full history
//   • tap a row in that list  → open the history scrolled to that offence
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../_lib/api";

export type Occ = { id: string; date: string; name: string; teacher?: string; noStrike?: boolean };

export function useOccurrences() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [occById, setOccById] = useState<Record<string, Occ[] | "loading">>({});

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (occById[id] && occById[id] !== "loading") return;
    setOccById((m) => ({ ...m, [id]: "loading" }));
    try {
      const d = await api<{ incidents: Array<{ _id: string; behaviorSnapshot: { name: string; kind?: string; points?: number; triggerMode?: string }; teacherName?: string; timestamp: string }> }>(`/students/${id}`);
      const occ: Occ[] = (d.incidents || [])
        // Offences only: no encouragements, no documentation-only interactions.
        .filter((inc) => inc.behaviorSnapshot?.kind !== "positive" && (inc.behaviorSnapshot?.points || 0) <= 0 && inc.behaviorSnapshot?.triggerMode !== "INTERACTION")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 12)
        .map((inc) => ({ id: inc._id, date: inc.timestamp, name: inc.behaviorSnapshot?.name || "Offence", teacher: inc.teacherName || "", noStrike: inc.behaviorSnapshot?.triggerMode === "NOTE" }));
      setOccById((m) => ({ ...m, [id]: occ }));
    } catch {
      setOccById((m) => ({ ...m, [id]: [] }));
    }
  }
  return { openId, occById, toggle };
}

// Tap = expand, double tap = open history. A short wait tells the two apart.
export function StudentNameTap({ studentId, open, onToggle, children }: { studentId: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onClick() {
    if (timer.current) {
      clearTimeout(timer.current); timer.current = null;
      router.push(`/behavior/student/${studentId}`);
      return;
    }
    timer.current = setTimeout(() => { timer.current = null; onToggle(); }, 250);
  }
  return (
    <button type="button" onClick={onClick} aria-expanded={open}
      title="Tap: recent offences · Double-tap: full history"
      className="min-w-0 text-left hover:text-slate-600">
      <span aria-hidden className="mr-1 inline-block w-3 text-slate-500">{open ? "▾" : "▸"}</span>
      {children}
    </button>
  );
}

export function OccurrenceList({ studentId, occ }: { studentId: string; occ: Occ[] | "loading" | undefined }) {
  if (occ === "loading" || occ === undefined) return <p className="pl-4 text-xs text-slate-500">Loading…</p>;
  if (!occ.length) return <p className="pl-4 text-xs text-slate-500">No recent offences.</p>;
  return (
    <ul className="mt-1 space-y-0.5 pl-4 text-xs">
      {occ.map((o) => (
        <li key={o.id}>
          <Link href={`/behavior/student/${studentId}#inc-${o.id}`}
            title="Open this offence in the student's history"
            className="-mx-1 flex flex-wrap items-baseline gap-x-1.5 rounded px-1 py-0.5 text-slate-700 hover:bg-slate-100">
            <span className="tabular-nums text-slate-500">{new Date(o.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
            <span className="font-medium">{o.name}</span>
            {o.noStrike ? <span className="text-slate-500">(no strike)</span> : null}
            {o.teacher ? <span className="text-slate-500">· {o.teacher}</span> : null}
            <span aria-hidden className="text-slate-400">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
