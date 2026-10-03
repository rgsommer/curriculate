// Human-readable date for deadlines, reveals and open dates. Adds the year whenever
// it isn't the current year, so a deadline a year out can't pass for next week (the
// "Thu, Sep 30" that was really 2027). Follows the device's locale.
export function formatWhen(
  when: string | Date,
  opts: { time?: boolean; weekday?: boolean } = {}
): string {
  const d = typeof when === "string" ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) return "";
  const { time = true, weekday = true } = opts;
  return d.toLocaleString(undefined, {
    ...(weekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
    ...(time ? { hour: "numeric" as const, minute: "2-digit" as const } : {}),
  });
}
