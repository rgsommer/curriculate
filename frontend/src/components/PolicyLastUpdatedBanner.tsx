// frontend/src/components/PolicyLastUpdatedBanner.tsx
export default function PolicyLastUpdatedBanner({
  dateLabel,
  highlightDays = 30,
}: {
  dateLabel: string; // e.g. "December 29, 2025"
  highlightDays?: number;
}) {
  const last = new Date(dateLabel);
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysAgo = Math.floor((now.getTime() - last.getTime()) / msPerDay);
  const isRecent = Number.isFinite(daysAgo) && daysAgo >= 0 && daysAgo <= highlightDays;

  return (
    <div
      className={[
        "mb-6 rounded-2xl border px-4 py-3 text-sm",
        isRecent
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-neutral-50 text-neutral-700",
      ].join(" ")}
    >
      <span className="font-semibold">Last updated:</span> {dateLabel}
      {isRecent ? (
        <span className="ml-2 opacity-80">
          (updated within the last {highlightDays} days)
        </span>
      ) : null}
    </div>
  );
}
