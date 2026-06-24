// A small, always-visible GUDD (Good Uniform Dress Down) indicator.
// Green = clean, amber = at risk, red = lost. When the GUDD is lost and a
// next-step consequence is known, it's shown alongside.
//
// Pass a full status (`gudd`) where available (student/log pages), or just
// `count` + `threshold` (the student list, where only the count is fetched).

export type GuddChipInput = {
  name?: string;
  count: number;
  threshold: number;
  consequence?: string; // escalation already incurred (past the loss point)
};

export default function GuddChip({
  name = "GUDD",
  count,
  threshold,
  consequence,
  size = "sm",
}: GuddChipInput & { size?: "sm" | "xs" }) {
  if (count == null || threshold == null) return null;
  const lost = count >= threshold;
  const atRisk = count > 0 && !lost;
  const tone = lost
    ? "border-red-300 bg-red-50 text-red-700"
    : atRisk
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : "border-emerald-300 bg-emerald-50 text-emerald-700";
  const label = lost
    ? `${name} lost (${count}/${threshold})`
    : atRisk
    ? `${name} ${count}/${threshold} — at risk`
    : `${name} ✓`;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${tone} ${pad}`}>
      {label}
      {lost && consequence ? <span className="font-normal opacity-80">· {consequence}</span> : null}
    </span>
  );
}
