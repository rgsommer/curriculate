// Red/green monthly timeline (negative vs positive events). byMonth is
// { "YYYY-MM": { neg, pos } }.
export function Timeline({ byMonth }: { byMonth: Record<string, { neg: number; pos: number }> }) {
  const keys = Object.keys(byMonth).sort();
  if (!keys.length) return <p className="text-sm text-slate-400">No events to chart yet.</p>;
  const max = Math.max(1, ...keys.map((k) => byMonth[k].neg + byMonth[k].pos));
  return (
    <div className="space-y-1.5">
      {keys.map((k) => {
        const { neg, pos } = byMonth[k];
        return (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-slate-500">{k}</span>
            <span className="flex h-3 flex-1 overflow-hidden rounded bg-slate-100">
              <span className="bg-red-500" style={{ width: `${(neg / max) * 100}%` }} />
              <span className="bg-green-500" style={{ width: `${(pos / max) * 100}%` }} />
            </span>
            <span className="w-14 shrink-0 text-right text-slate-500 tabular-nums">
              {neg ? `${neg}✕` : ""}{neg && pos ? " " : ""}{pos ? `${pos}✓` : ""}
            </span>
          </div>
        );
      })}
      <div className="text-[11px] text-slate-400">
        <span className="text-red-500">■</span> negative · <span className="text-green-600">■</span> positive
      </div>
    </div>
  );
}

// Build { "YYYY-MM": { neg, pos } } from a student's incidents + notices.
// Incidents are coloured by kind/points; legacy/standalone notices count as
// negative offences (they're the only record of those events).
export function buildByMonth(
  incidents: Array<{ timestamp: string; behaviorSnapshot?: { kind?: string; points?: number; triggerMode?: string } }>,
  notices: Array<{ sentAt?: string; createdAt: string; legacyImport?: boolean; triggeringIncidentIds?: string[] }>,
): Record<string, { neg: number; pos: number }> {
  const by: Record<string, { neg: number; pos: number }> = {};
  const bump = (d: string, kind: "neg" | "pos") => {
    const k = new Date(d).toISOString().slice(0, 7);
    (by[k] ||= { neg: 0, pos: 0 })[kind] += 1;
  };
  for (const i of incidents) {
    const pos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
    // Documented interactions (e.g. a logged parent meeting) are neutral — not
    // an offence, so keep them off the red/green chart.
    if (!pos && i.behaviorSnapshot?.triggerMode === "INTERACTION") continue;
    bump(i.timestamp, pos ? "pos" : "neg");
  }
  for (const n of notices) {
    const backed = Array.isArray(n.triggeringIncidentIds) && n.triggeringIncidentIds.length > 0;
    if (n.legacyImport || !backed) bump(n.sentAt || n.createdAt, "neg");
  }
  return by;
}
