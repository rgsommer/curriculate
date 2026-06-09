// backend/behavior/lib/schoolCalendar.js
//
// "Next school day" logic for consequence due-dates (brief §8b). A school day is
// any weekday that isn't an Ontario statutory holiday or an admin-specified
// non-school day (PA days, March break, etc., stored in config or imported from
// the school's calendar). Pure + testable.

const WEEKEND = new Set([0, 6]); // Sun, Sat

/** Local YYYY-MM-DD for a Date (no timezone drift). */
export function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Anonymous Gregorian computus → Easter Sunday for a year. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// n-th (1-based) `weekday` of a month.
function nthWeekday(year, month0, weekday, n) {
  const first = new Date(year, month0, 1);
  const shift = (7 + weekday - first.getDay()) % 7;
  return new Date(year, month0, 1 + shift + (n - 1) * 7);
}

// Latest `weekday` on or before (year, month0, day).
function weekdayOnOrBefore(year, month0, day, weekday) {
  const d = new Date(year, month0, day);
  const back = (7 + d.getDay() - weekday) % 7;
  return new Date(year, month0, day - back);
}

const statCache = new Map();

/** Ontario statutory holidays for a year as a Set of YYYY-MM-DD. */
export function ontarioStatHolidaySet(year) {
  if (statCache.has(year)) return statCache.get(year);
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
  const days = [
    new Date(year, 0, 1), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Family Day — 3rd Monday of Feb
    goodFriday, // Good Friday
    weekdayOnOrBefore(year, 4, 24, 1), // Victoria Day — Monday on/before May 24
    new Date(year, 6, 1), // Canada Day
    nthWeekday(year, 7, 1, 1), // Civic Holiday — 1st Monday of Aug
    nthWeekday(year, 8, 1, 1), // Labour Day — 1st Monday of Sep
    nthWeekday(year, 9, 1, 2), // Thanksgiving — 2nd Monday of Oct
    new Date(year, 11, 25), // Christmas
    new Date(year, 11, 26), // Boxing Day
  ];
  const set = new Set(days.map(ymd));
  statCache.set(year, set);
  return set;
}

/**
 * Is `date` a non-school day?
 * @param {Date} date
 * @param {Set<string>} manualSet  admin-specified non-school YYYY-MM-DD dates
 */
export function isNonSchoolDay(date, manualSet) {
  if (WEEKEND.has(date.getDay())) return true;
  if (ontarioStatHolidaySet(date.getFullYear()).has(ymd(date))) return true;
  if (manualSet && manualSet.has(ymd(date))) return true;
  return false;
}

/**
 * The next school day strictly AFTER `from`, at the given hour (default 9am).
 * @param {Date} from
 * @param {object} opts { manualNonSchoolDays?: string[], hour?: number }
 */
export function nextSchoolDay(from, opts = {}) {
  const manualSet = new Set(opts.manualNonSchoolDays || []);
  const hour = opts.hour ?? 9;
  let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); // midnight of from's day
  let guard = 0;
  do {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    guard += 1;
  } while (isNonSchoolDay(d, manualSet) && guard < 60);
  d.setHours(hour, 0, 0, 0);
  return d;
}
