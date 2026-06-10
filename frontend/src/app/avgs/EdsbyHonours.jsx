"use client";

/**
 * Honour roll, live from Edsby — the signed-in panel on /avgs.
 *
 * Backed by /api/behavior/avgs (behaviours auth + the school's synced Edsby
 * session). Probe discovers every class by sampling students per grade; each
 * class gets a guessed days/week → weight (Math 4×=0.8, Art 2×=0.4, PE 1×=0.2,
 * CE daily-but-half=0.5) that the teacher can edit. Refresh pulls every
 * in-range student's current grades and buckets them into Honours /
 * High Honours by the configured thresholds.
 */

import { useEffect, useState } from "react";
import { api, getToken, loginHref, ApiError } from "../behavior/_lib/api";

const TIER_LABEL = { "high-honours": "High Honours", honours: "Honours" };

function fmtWhen(d) {
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}

function groupStudents(students) {
  const groups = new Map();
  for (const s of students) {
    const label = s.grade ? `Grade ${s.grade}` : "Grade not set";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(s);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );
  for (const [, list] of ordered) list.sort((a, b) => (b.weightedAvg ?? -1) - (a.weightedAvg ?? -1));
  return ordered;
}

export default function EdsbyHonours() {
  const [signedIn, setSignedIn] = useState(null); // null until mounted (SSR-safe)
  const [cfg, setCfg] = useState(null);
  const [roster, setRoster] = useState({ inRange: 0, missingNid: 0 });
  const [snapshot, setSnapshot] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null); // { kind: "ok"|"err", text }
  const [diagnostics, setDiagnostics] = useState(null); // raw Edsby diagnostics to show on a parse miss
  const [showClasses, setShowClasses] = useState(false);

  useEffect(() => {
    const token = getToken();
    setSignedIn(!!token);
    if (!token) return;
    (async () => {
      try {
        const c = await api("/avgs/config");
        setCfg(c.config);
        setRoster({ inRange: c.rosterInRange, missingNid: c.rosterMissingNid });
        const r = await api("/avgs/results");
        setSnapshot(r.snapshot);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setNeedsSetup(true);
        else if (e instanceof ApiError && e.status === 401) setSignedIn(false);
        else setNotice({ kind: "err", text: e.message });
      }
    })();
  }, []);

  function setClassField(i, field, value) {
    setCfg((c) => {
      const classes = c.classes.map((cl, j) => {
        if (j !== i) return cl;
        const next = { ...cl, [field]: value };
        // Editing days/week re-derives the weight (days ÷ 5); weight stays
        // directly editable for special cases like CE (daily but 0.5).
        if (field === "daysPerWeek") next.weight = Math.round((Number(value) / 5) * 100) / 100;
        return next;
      });
      return { ...c, classes };
    });
  }

  async function saveConfig() {
    setBusy("save");
    setNotice(null);
    try {
      const r = await api("/avgs/config", { method: "PUT", body: cfg });
      setCfg(r.config);
      setNotice({ kind: "ok", text: "Setup saved." });
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy("");
    }
  }

  async function extractIds() {
    setBusy("extract");
    setNotice(null);
    setDiagnostics(null);
    try {
      // Route path stays /harvest-nids (internal, never shown) so the button
      // doesn't 404 during the backend's deploy lag; the UI says "Extract".
      const r = await api("/avgs/harvest-nids", { method: "POST", body: {}, timeoutMs: 120000 });
      if (!r.ok) {
        // Keep the diagnostics Edsby returned so the parser can be tuned.
        if (r.diagnostics) setDiagnostics(r.diagnostics);
        throw new Error(r.error);
      }
      const left = r.unmatchedRosterCount;
      setNotice({
        kind: left ? "warn" : "ok",
        text:
          `Edsby listed ${r.edsbyPeople} students — matched ${r.matched} to the roster by name` +
          (r.alreadyHadNid ? ` (${r.alreadyHadNid} already had IDs)` : "") +
          (left ? `. ${left} still unmatched: ${r.unmatchedRoster.join(", ")}${left > r.unmatchedRoster.length ? "…" : ""}` : ". All set — run Probe next."),
      });
      const c = await api("/avgs/config");
      setRoster({ inRange: c.rosterInRange, missingNid: c.rosterMissingNid });
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy("");
    }
  }

  async function probe() {
    setBusy("probe");
    setNotice(null);
    try {
      const r = await api("/avgs/probe", { method: "POST", body: {}, timeoutMs: 120000 });
      if (!r.ok) throw new Error(r.error);
      setCfg(r.config);
      setShowClasses(true);
      setNotice({
        kind: "ok",
        text: `Probed ${r.sampled} students — found ${r.classesDiscovered} classes (${r.classesAdded} new). Check the weights below, then Save.`,
      });
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy("");
    }
  }

  async function refresh() {
    setBusy("refresh");
    setNotice(null);
    try {
      const r = await api("/avgs/refresh", { method: "POST", body: {}, timeoutMs: 300000 });
      if (!r.ok) throw new Error(r.error);
      setSnapshot(r.snapshot);
      const d = r.snapshot.diagnostics || {};
      setNotice({ kind: "ok", text: `Refreshed ${d.succeeded ?? "?"} of ${d.requested ?? "?"} students from Edsby.` });
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy("");
    }
  }

  function downloadCsv() {
    if (!snapshot) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Grade", "Rank", "Student", "Class group", "Weighted Average", "Tier"]];
    for (const [label, list] of groupStudents(snapshot.students)) {
      list.forEach((s, i) =>
        rows.push([label, i + 1, s.name, s.classGroup, s.weightedAvg?.toFixed(1) ?? "", TIER_LABEL[s.tier] || ""])
      );
    }
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "honour-roll.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── render ──────────────────────────────────────────────────────────────────

  if (signedIn === null) return null;

  const shell = (children) => (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-800">
        Honour roll — live from Edsby <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">beta</span>
      </h2>
      {children}
    </section>
  );

  if (!signedIn) {
    return shell(
      <p className="mt-2 text-sm text-slate-600">
        Skip the PDF: pull every student&apos;s current grades straight from Edsby and compute the honour roll on
        demand. Uses your school&apos;s Behaviours account and its synced Edsby session —{" "}
        <a className="font-medium text-blue-600 hover:underline" href={loginHref("/avgs")}>sign in</a> to use it.
      </p>
    );
  }

  if (needsSetup) {
    return shell(
      <p className="mt-2 text-sm text-slate-600">
        Your account isn&apos;t part of a Behaviours school yet. This panel reuses the Behaviours roster and Edsby
        connection — set that up first at{" "}
        <a className="font-medium text-blue-600 hover:underline" href="/behavior/setup">/behavior/setup</a>.
      </p>
    );
  }

  if (!cfg) return shell(<p className="mt-2 animate-pulse text-sm text-slate-500">Loading…</p>);

  const groups = snapshot ? groupStudents(snapshot.students) : null;
  const diag = snapshot?.diagnostics || {};

  return shell(
    <>
      <p className="mt-2 text-sm text-slate-600">
        Pulls current grades from Edsby for every student in the grade range and computes weighted averages on
        demand. <strong>Probe</strong> discovers the classes; Edsby doesn&apos;t expose how often each one meets,
        so days/week start as a guess from the class name — edit any of them, then <strong>Save</strong>.
      </p>

      {/* Setup */}
      <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col text-slate-600">
          Grades
          <span className="mt-1 flex items-center gap-1">
            <input type="number" min={0} max={12} value={cfg.gradeMin}
              onChange={(e) => setCfg({ ...cfg, gradeMin: +e.target.value })}
              className="w-16 rounded border border-slate-300 p-1.5" />
            –
            <input type="number" min={0} max={12} value={cfg.gradeMax}
              onChange={(e) => setCfg({ ...cfg, gradeMax: +e.target.value })}
              className="w-16 rounded border border-slate-300 p-1.5" />
          </span>
        </label>
        <label className="flex flex-col text-slate-600">
          Honours ≥
          <input type="number" min={0} max={100} value={cfg.honours}
            onChange={(e) => setCfg({ ...cfg, honours: +e.target.value })}
            className="mt-1 w-20 rounded border border-slate-300 p-1.5" />
        </label>
        <label className="flex flex-col text-slate-600">
          High Honours ≥
          <input type="number" min={0} max={100} value={cfg.highHonours}
            onChange={(e) => setCfg({ ...cfg, highHonours: +e.target.value })}
            className="mt-1 w-20 rounded border border-slate-300 p-1.5" />
        </label>
        <span className="text-xs text-slate-400">
          {roster.inRange} students in range{roster.missingNid ? ` · ${roster.missingNid} missing an Edsby ID` : ""}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {roster.missingNid > 0 && (
          <button type="button" onClick={extractIds} disabled={!!busy}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40">
            {busy === "extract" ? "Extracting from Edsby…" : `Extract student IDs (${roster.missingNid} missing)`}
          </button>
        )}
        <button type="button" onClick={probe} disabled={!!busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          {busy === "probe" ? "Probing Edsby…" : "Probe classes"}
        </button>
        <button type="button" onClick={saveConfig} disabled={!!busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          {busy === "save" ? "Saving…" : "Save setup"}
        </button>
        <button type="button" onClick={refresh} disabled={!!busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          {busy === "refresh" ? "Pulling grades from Edsby…" : "Refresh from Edsby"}
        </button>
      </div>

      {notice && (
        <p className={`mt-3 rounded-lg p-3 text-sm ${
          notice.kind === "ok" ? "bg-green-50 text-green-700"
          : notice.kind === "warn" ? "bg-amber-50 text-amber-800"
          : "bg-red-50 text-red-700"
        }`}>
          {notice.text}
        </p>
      )}

      {diagnostics && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600">
            Edsby diagnostics — copy this and send it to get the parser tuned:
          </p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-slate-700">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </div>
      )}

      {/* Class weights */}
      {cfg.classes?.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowClasses((v) => !v)}
            className="text-sm font-medium text-blue-600 hover:underline">
            {showClasses ? "▾" : "▸"} Class weights ({cfg.classes.length})
          </button>
          {showClasses && (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-2">Class</th>
                  <th className="py-1 pr-2 text-right">Days/wk</th>
                  <th className="py-1 pr-2 text-right">Weight</th>
                  <th className="py-1 pr-2 text-center">Count</th>
                  <th className="py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {cfg.classes.map((c, i) => (
                  <tr key={c.name} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2 text-slate-700">{c.name}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min={0} max={5} step={0.5} value={c.daysPerWeek}
                        onChange={(e) => setClassField(i, "daysPerWeek", +e.target.value)}
                        className="w-16 rounded border border-slate-300 p-1 text-right" />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min={0} max={1} step={0.05} value={c.weight}
                        onChange={(e) => setClassField(i, "weight", +e.target.value)}
                        className="w-16 rounded border border-slate-300 p-1 text-right" />
                    </td>
                    <td className="py-1.5 pr-2 text-center">
                      <input type="checkbox" checked={c.include !== false}
                        onChange={(e) => setClassField(i, "include", e.target.checked)} />
                    </td>
                    <td className="py-1.5 text-xs text-amber-600">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Results */}
      {snapshot && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-700">
              Honour roll <span className="text-sm font-normal text-slate-400">— refreshed {fmtWhen(snapshot.takenAt)}</span>
            </h3>
            <button type="button" onClick={downloadCsv}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Download CSV
            </button>
          </div>

          {(diag.missingNid?.length > 0 || (diag.requested ?? 0) > (diag.succeeded ?? 0)) && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
              {diag.requested > diag.succeeded && `${diag.requested - diag.succeeded} students returned no grade data. `}
              {diag.missingNid?.length > 0 && `Missing Edsby ID: ${diag.missingNid.join(", ")}.`}
            </p>
          )}

          {groups.map(([label, list]) => (
            <div key={label} className="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">{label}</div>
              <table className="w-full text-sm">
                <tbody>
                  {list.map((s, i) => (
                    <tr key={`${label}-${s.name}-${i}`} className="border-t border-slate-100">
                      <td className="w-10 px-4 py-2 text-slate-400">{i + 1}</td>
                      <td className="py-2 font-medium text-slate-800">
                        {s.name} <span className="text-xs font-normal text-slate-400">{s.classGroup}</span>
                        {s.error && <span className="ml-2 text-xs text-red-500">{s.error}</span>}
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-800">
                        {s.weightedAvg === null || s.weightedAvg === undefined ? "—" : `${s.weightedAvg.toFixed(1)}%`}
                      </td>
                      <td className="w-32 px-4 py-2 text-right">
                        {s.tier && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            s.tier === "high-honours" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {TIER_LABEL[s.tier]}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
