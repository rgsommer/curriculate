"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";

const FOLLOWUPS = [
  { v: "none", label: "No follow-up" },
  { v: "next_school_day", label: "Due next school day" },
  { v: "custom_deadline", label: "Custom deadline" },
];
const MODES = [
  { v: "INTERACTION", label: "Interaction — document only (no note home)" },
  { v: "THRESHOLD", label: "Counts toward strikes" },
  { v: "IMMEDIATE", label: "Notify immediately" },
];

// Interaction first, then alphabetical by keyword (falling back to name).
function sortBehaviors(list: any[]) {
  return [...list].sort((a, b) => {
    const ai = a.triggerMode === "INTERACTION" ? 0 : 1;
    const bi = b.triggerMode === "INTERACTION" ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return String(a.keyword || a.name).toLowerCase().localeCompare(String(b.keyword || b.name).toLowerCase());
  });
}

export default function BehavioursPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api<{ behaviors: any[] }>("/behaviors").then((d) => setItems(d.behaviors || [])).catch((e) => setErr(e.message));
  }
  useEffect(() => {
    if (!getToken()) return;
    api<Me>("/me").then(setMe).catch((e) => setErr(e.message));
    load();
  }, []);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/behaviours")}>sign in</Link>.</p>;
  if (err) return <p className="text-red-600">{err}</p>;
  if (!me?.membership || items === null) return <p className="text-slate-500">Loading…</p>;

  const role = me.membership.role;
  const isAdmin = role === "originator" || role === "admin";
  const myId = me.membership._id;
  const canManage = (b: any) =>
    (b.scope === "standard" && isAdmin) || (b.scope === "custom" && String(b.ownerTeacherId) === String(myId));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior/log" className="text-sm text-slate-500 underline">← back to logging</Link>
        <h1 className="mt-1 text-xl font-semibold">Behaviours</h1>
        <p className="text-sm text-slate-400">
          <span className="rounded bg-green-100 px-1.5 text-green-800">green</span> = shared/standard ·{" "}
          <span className="rounded bg-blue-100 px-1.5 text-blue-800">blue</span> = your own. Sorted by keyword; “Interaction” logs without a note home.
          Set <span className="font-medium">house points</span> on any behaviour — negative deducts for an offence, positive rewards a good one.
        </p>
      </div>

      <div className="space-y-2">
        {sortBehaviors(items).map((b) => (
          <BehaviorRow key={b._id} b={b} editable={canManage(b)} onChanged={load} />
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Add a behaviour</h2>
        <p className="text-xs text-slate-400">{isAdmin ? "Standard (shared) by default; toggle to make it your private one." : "Your private behaviour (only you see it)."}</p>
        <BehaviorRow add allowStandard={isAdmin} onChanged={load} />
      </section>
    </div>
  );
}

function BehaviorRow({ b, add, editable, allowStandard, onChanged }: { b?: any; add?: boolean; editable?: boolean; allowStandard?: boolean; onChanged: () => void }) {
  const [name, setName] = useState(b?.name || "");
  const [keyword, setKeyword] = useState(b?.keyword || "");
  const [triggerMode, setTriggerMode] = useState(b?.triggerMode || (add ? "THRESHOLD" : "THRESHOLD"));
  const [consequenceText, setConsequenceText] = useState(b?.consequenceText || "");
  const [followUpType, setFollowUpType] = useState(b?.followUpType || "none");
  const [points, setPoints] = useState<number | string>(b?.points ?? 0);
  const [scopeStandard, setScopeStandard] = useState(!!allowStandard);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tint = add
    ? "border-dashed border-slate-300"
    : b?.scope === "standard"
    ? "border-green-200 bg-green-50/40"
    : "border-blue-200 bg-blue-50/40";

  // Read-only display for behaviours this teacher can't manage.
  if (!add && !editable) {
    return (
      <div className={`rounded-lg border p-3 ${tint}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {b.name}
            {b.keyword ? <span className="ml-2 text-xs text-slate-400">#{b.keyword}</span> : null}
            {b.points ? <PointsBadge points={b.points} /> : null}
          </span>
          <span className="text-xs text-slate-400">{MODES.find((m) => m.v === b.triggerMode)?.label?.split(" —")[0]}</span>
        </div>
        {b.consequenceText && <p className="mt-1 text-xs text-slate-500">{b.consequenceText}</p>}
      </div>
    );
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      if (add) {
        await api("/behaviors", { body: { name, keyword, triggerMode, consequenceText, followUpType, points: Number(points) || 0, scope: scopeStandard ? "standard" : "custom" } });
        setName(""); setKeyword(""); setConsequenceText(""); setTriggerMode("THRESHOLD"); setFollowUpType("none"); setPoints(0);
      } else {
        await api(`/behaviors/${b._id}`, { method: "PUT", body: { name, keyword, triggerMode, consequenceText, followUpType, points: Number(points) || 0 } });
      }
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Remove "${b.name}"?`)) return;
    try {
      await api(`/behaviors/${b._id}`, { method: "DELETE" });
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const interaction = triggerMode === "INTERACTION";
  return (
    <div className={`rounded-lg border p-3 ${tint}`}>
      {err && <p className="mb-1 text-xs text-red-600">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={add ? "New behaviour name…" : "Name"} className={inputCls} />
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword (e.g. disrespect)" className={inputCls} />
        <select value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)} className={`${inputCls} col-span-2`}>
          {MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
        {!interaction && (
          <>
            <input value={consequenceText} onChange={(e) => setConsequenceText(e.target.value)} placeholder="Consequence (in the note home)" className={`${inputCls} col-span-2`} />
            <select value={followUpType} onChange={(e) => setFollowUpType(e.target.value)} className={inputCls}>
              {FOLLOWUPS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
          </>
        )}
        <label className={`flex flex-wrap items-center gap-2 text-xs text-slate-500 col-span-2`}>
          House points
          <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <span className="text-slate-400">
            positive rewards the student&apos;s house, negative deducts.
            {interaction ? " Good for positive behaviours — won’t count as a strike or notify home." : " For a positive behaviour, set the mode to “Interaction” so it doesn’t count as a strike."}
          </span>
        </label>
        <div className={`flex items-center justify-end gap-2 ${interaction ? "col-span-2" : ""}`}>
          {add && allowStandard && (
            <label className="mr-auto flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={!scopeStandard} onChange={(e) => setScopeStandard(!e.target.checked)} /> private to me
            </label>
          )}
          <button onClick={save} disabled={!name.trim() || busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {add ? "Add" : busy ? "Saving…" : "Save"}
          </button>
          {!add && <button onClick={remove} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700">Remove</button>}
        </div>
      </div>
    </div>
  );
}

function PointsBadge({ points }: { points: number }) {
  const positive = points > 0;
  return (
    <span className={`ml-2 rounded px-1.5 text-xs font-medium ${positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {positive ? `+${points}` : points} pts
    </span>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
