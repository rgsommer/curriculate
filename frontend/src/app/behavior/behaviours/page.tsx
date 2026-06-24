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

const behKind = (b: any): "negative" | "positive" =>
  b?.kind === "positive" || (b?.points ?? 0) > 0 ? "positive" : "negative";

// Negatives first (grouped), then positives; within each, alphabetical by
// keyword (falling back to name).
function sortBehaviors(list: any[]) {
  return [...list].sort((a, b) => {
    const ak = behKind(a) === "positive" ? 1 : 0;
    const bk = behKind(b) === "positive" ? 1 : 0;
    if (ak !== bk) return ak - bk;
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
  const housesOn = !!me.config?.housesEnabled;
  const myId = me.membership._id;
  const canManage = (b: any) =>
    (b.scope === "standard" && isAdmin) || (b.scope === "custom" && String(b.ownerTeacherId) === String(myId));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior/log" className="text-sm text-slate-500 underline">← back to logging</Link>
        <h1 className="mt-1 text-xl font-semibold">Behaviours</h1>
        <p className="text-sm text-slate-400">
          Each behaviour is <span className="text-red-600 font-medium">✕ negative</span> (an offence) or{" "}
          <span className="text-green-600 font-medium">✓ positive</span> (a reward — never counts as a strike). Negatives are listed first, then positives.
          {housesOn && " Set "}{housesOn && <span className="font-medium">house points</span>}{housesOn && " on any behaviour."}
        </p>
        {isAdmin && <SeedStandard onSeeded={load} />}
      </div>

      <div className="space-y-2">
        {sortBehaviors(items).map((b) => (
          <BehaviorRow key={b._id} b={b} editable={canManage(b)} housesOn={housesOn} onChanged={load} />
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Add a behaviour</h2>
        <p className="text-xs text-slate-400">{isAdmin ? "Standard (shared) by default; toggle to make it your private one." : "Your private behaviour (only you see it)."}</p>
        <BehaviorRow add allowStandard={isAdmin} housesOn={housesOn} onChanged={load} />
      </section>
    </div>
  );
}

function BehaviorRow({ b, add, editable, allowStandard, housesOn, onChanged }: { b?: any; add?: boolean; editable?: boolean; allowStandard?: boolean; housesOn?: boolean; onChanged: () => void }) {
  const [name, setName] = useState(b?.name || "");
  const [keyword, setKeyword] = useState(b?.keyword || "");
  const [kind, setKind] = useState<"negative" | "positive">(b?.kind || ((b?.points ?? 0) > 0 ? "positive" : "negative"));
  const [triggerMode, setTriggerMode] = useState(b?.triggerMode || (add ? "THRESHOLD" : "THRESHOLD"));
  const [consequenceText, setConsequenceText] = useState(b?.consequenceText || "");
  const [followUpType, setFollowUpType] = useState(b?.followUpType || "none");
  const [points, setPoints] = useState<number | string>(b?.points ?? 0);
  const [categories, setCategories] = useState<string[]>(
    Array.isArray(b?.categories) ? b.categories : (b?.uniform ? ["uniform"] : [])
  );
  const toggleCat = (c: string) => setCategories((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const [immediateWhiteSlip, setImmediateWhiteSlip] = useState<boolean>(!!b?.immediateWhiteSlip);
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
            <span className={(b.kind === "positive" || (b.points ?? 0) > 0) ? "text-green-600" : "text-red-600"}>{(b.kind === "positive" || (b.points ?? 0) > 0) ? "✓" : "✕"}</span>{" "}
            {b.name}
            {b.keyword ? <span className="ml-2 text-xs text-slate-400">#{b.keyword}</span> : null}
            {b.points ? <PointsBadge points={b.points} /> : null}
            {(b.categories || (b.uniform ? ["uniform"] : [])).map((c: string) => (
              <span key={c} className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${c === "uniform" ? "bg-indigo-100 text-indigo-700" : c === "behaviour" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
                {c === "uniform" ? "Uniform" : c === "behaviour" ? "Behaviour" : "Prep"}
              </span>
            ))}
            {b.immediateWhiteSlip ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">White slip</span> : null}
          </span>
          <span className="text-xs text-slate-400">{(b.kind === "positive" || (b.points ?? 0) > 0) ? "positive" : MODES.find((m) => m.v === b.triggerMode)?.label?.split(" —")[0]}</span>
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
        await api("/behaviors", { body: { name, keyword, kind, triggerMode, consequenceText, followUpType, points: Number(points) || 0, categories, immediateWhiteSlip, scope: scopeStandard ? "standard" : "custom" } });
        setName(""); setKeyword(""); setKind("negative"); setConsequenceText(""); setTriggerMode("THRESHOLD"); setFollowUpType("none"); setPoints(0); setCategories([]); setImmediateWhiteSlip(false);
      } else {
        await api(`/behaviors/${b._id}`, { method: "PUT", body: { name, keyword, kind, triggerMode, consequenceText, followUpType, points: Number(points) || 0, categories, immediateWhiteSlip } });
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
  const positive = kind === "positive";
  return (
    <div className={`rounded-lg border p-3 ${tint}`}>
      {err && <p className="mb-1 text-xs text-red-600">{err}</p>}
      {/* Positive or negative — sets the whole shape of the behaviour. */}
      <div className="mb-2 inline-flex gap-1.5 text-xs font-semibold">
        <button type="button" onClick={() => setKind("negative")}
          className={`rounded-lg border px-3 py-1.5 ${!positive ? "border-red-600 bg-red-600 text-white" : "border-red-200 bg-white text-red-600"}`}>✕ Negative</button>
        <button type="button" onClick={() => { setKind("positive"); if (Number(points) <= 0) setPoints(1); }}
          className={`rounded-lg border px-3 py-1.5 ${positive ? "border-green-600 bg-green-600 text-white" : "border-green-200 bg-white text-green-700"}`}>✓ Positive</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={add ? (positive ? "New positive behaviour…" : "New behaviour name…") : "Name"} className={`${inputCls} bg-slate-100 font-medium text-slate-900`} />
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword (e.g. kindness)" className={inputCls} />
        {!positive && (
          <select value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)} className={`${inputCls} col-span-2`}>
            {MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        )}
        {!positive && !interaction && (
          <>
            <input value={consequenceText} onChange={(e) => setConsequenceText(e.target.value)} placeholder="Consequence (in the note home)" className={`${inputCls} col-span-2`} />
            <select value={followUpType} onChange={(e) => setFollowUpType(e.target.value)} className={inputCls}>
              {FOLLOWUPS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
          </>
        )}
        {/* Points are the reward value for positives, so always shown there;
            for negatives they're a house deduction, shown only with Houses on. */}
        {(positive || housesOn) && (
          <label className={`flex flex-wrap items-center gap-2 text-xs text-slate-500 col-span-2`}>
            {positive ? "Points" : "House points"}
            <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <span className="text-slate-400">
              {positive
                ? "added to the student’s house when logged. Positive behaviours never count as a strike."
                : "negative deducts from the student’s house; leave 0 for no points."}
            </span>
          </label>
        )}
        {!positive && (
          <div className="col-span-2 text-xs text-slate-600">
            <span className="font-medium">Category</span> <span className="text-slate-400">(teachers don&apos;t pick this — it shapes reporting &amp; rules)</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {[["preparedness", "Class preparedness"], ["behaviour", "Behaviour"], ["uniform", "Uniform (GUDD)"]].map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={categories.includes(v)} onChange={() => toggleCat(v)} />
                  {label}
                </label>
              ))}
            </div>
            {categories.includes("uniform") && (
              <p className="mt-1 text-slate-400">Uniform → counts as a strike <em>and</em> toward losing the Good Uniform Dress Down (threshold/fade/escalations in Setup).</p>
            )}
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" checked={immediateWhiteSlip} onChange={(e) => setImmediateWhiteSlip(e.target.checked)} className="mt-0.5" />
              <span><span className="font-medium">Immediate white slip</span> — logging this emails you (CC the VP) a “White Slip: reason, teacher, date” and records it. Tags the offence as Behaviour.</span>
            </label>
          </div>
        )}
        <div className={`flex items-center justify-end gap-2 ${interaction || positive ? "col-span-2" : ""}`}>
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

function SeedStandard({ onSeeded }: { onSeeded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function seed() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ created: number; skipped: number }>("/behaviors/seed-standard", { body: {} });
      setMsg(`✓ Added ${r.created}${r.skipped ? `, skipped ${r.skipped} already present` : ""}.`);
      onSeeded();
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button onClick={seed} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40">
        {busy ? "Adding…" : "Add standard behaviour set"}
      </button>
      {msg && <span className={`text-xs ${msg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{msg}</span>}
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
