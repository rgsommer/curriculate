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
// The list IS the strikes. It used to come straight out of history with no
// window at all, so a student showing "2/3" had three offences listed under
// them — one from September, past the thirty-day fade, and one from June,
// from the previous school year — on a card that says in its own words that
// strikes fade after thirty days. Anything no longer counting is a number at
// the foot of the list and a tap away in the record, not a line that reads
// like a strike.
export type OccList = { shown: Occ[]; earlier: number };

export function useOccurrences() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [occById, setOccById] = useState<Record<string, OccList | "loading">>({});

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (occById[id] && occById[id] !== "loading") return;
    setOccById((m) => ({ ...m, [id]: "loading" }));
    try {
      const d = await api<{ incidents: Array<{ _id: string; behaviorSnapshot: { name: string; kind?: string; points?: number; triggerMode?: string }; teacherName?: string; timestamp: string; countsNow?: boolean; thisPeriod?: boolean }> }>(`/students/${id}`);
      const offences = (d.incidents || [])
        // Offences only: no encouragements, no documentation-only interactions.
        .filter((inc) => inc.behaviorSnapshot?.kind !== "positive" && (inc.behaviorSnapshot?.points || 0) <= 0 && inc.behaviorSnapshot?.triggerMode !== "INTERACTION")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      // This school year only. The server says which year each belongs to
      // and which are still behind the strike count, so this list and the
      // "2/3" beside it are the same test rather than two.
      // countsNow is the server's own strike test — the same one behind the
      // number on the card — so the two cannot drift apart. A NOTE is
      // deliberately kept: it is this term's record and says "no strike"
      // on its face.
      const live = offences.filter((inc) =>
        inc.countsNow === true || inc.behaviorSnapshot?.triggerMode === "NOTE");
      const shown: Occ[] = live.slice(0, 12).map((inc) => ({
        id: inc._id,
        date: inc.timestamp,
        name: inc.behaviorSnapshot?.name || "Offence",
        teacher: inc.teacherName || "",
        noStrike: inc.behaviorSnapshot?.triggerMode === "NOTE",
      }));
      setOccById((m) => ({ ...m, [id]: { shown, earlier: offences.length - live.length } }));
    } catch {
      setOccById((m) => ({ ...m, [id]: { shown: [], earlier: 0 } }));
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

export function OccurrenceList({ studentId, occ }: { studentId: string; occ: OccList | "loading" | undefined }) {
  if (occ === "loading" || occ === undefined) return <p className="pl-4 text-xs text-slate-500">Loading…</p>;
  if (!occ.shown.length) {
    return (
      <p className="pl-4 text-xs text-slate-500">
        Nothing counting now.
        {occ.earlier ? <> <Link href={`/behavior/student/${studentId}`} className="underline underline-offset-2">{occ.earlier} older offence{occ.earlier === 1 ? "" : "s"} in the record</Link>.</> : null}
      </p>
    );
  }
  return (
    <ul className="mt-1 space-y-0.5 pl-4 text-xs">
      {occ.shown.map((o) => (
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
      {occ.earlier > 0 && (
        <li className="pt-0.5 text-slate-400">
          <Link href={`/behavior/student/${studentId}`} className="underline underline-offset-2 hover:text-slate-600">
            {occ.earlier} older offence{occ.earlier === 1 ? "" : "s"}, no longer counting
          </Link>
        </li>
      )}
    </ul>
  );
}
