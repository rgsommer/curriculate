// node --test backend/behavior/tests/schoolCalendar.test.mjs
//
// Tests "next school day" logic (brief §8b): skip weekends + Ontario stat
// holidays + admin-specified non-school days.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ymd,
  easterSunday,
  ontarioStatHolidaySet,
  isNonSchoolDay,
  nextSchoolDay,
} from "../lib/schoolCalendar.js";

test("easterSunday computus is correct (2026 = Apr 5)", () => {
  assert.equal(ymd(easterSunday(2026)), "2026-04-05");
  assert.equal(ymd(easterSunday(2024)), "2024-03-31");
});

test("Ontario stat holiday set includes the fixed-date holidays", () => {
  const s = ontarioStatHolidaySet(2026);
  assert.ok(s.has("2026-01-01")); // New Year
  assert.ok(s.has("2026-07-01")); // Canada Day
  assert.ok(s.has("2026-12-25")); // Christmas
  assert.ok(s.has("2026-12-26")); // Boxing Day
  assert.ok(s.has("2026-04-03")); // Good Friday (Easter - 2)
  assert.ok(s.size >= 10);
});

test("weekends are non-school days", () => {
  assert.equal(isNonSchoolDay(new Date(2026, 0, 3), new Set()), true); // Sat
  assert.equal(isNonSchoolDay(new Date(2026, 0, 4), new Set()), true); // Sun
  assert.equal(isNonSchoolDay(new Date(2026, 0, 5), new Set()), false); // Mon
});

test("nextSchoolDay skips the weekend (Fri -> Mon) at 9am", () => {
  const d = nextSchoolDay(new Date(2026, 0, 2, 14, 0)); // Fri Jan 2 2026, 2pm
  assert.equal(d.getDate(), 5); // Mon Jan 5
  assert.equal(d.getDay(), 1);
  assert.equal(d.getHours(), 9);
});

test("nextSchoolDay skips a stat holiday too", () => {
  // Thu Dec 24 2026 → Fri Dec 25 (Christmas) + Sat/Sun + ... → next school day.
  const d = nextSchoolDay(new Date(2026, 11, 24));
  assert.equal(isNonSchoolDay(d, new Set()), false);
  assert.equal(d.getHours(), 9);
  assert.ok(d > new Date(2026, 11, 24));
});

test("admin manual non-school days are honoured", () => {
  // Mon Jan 5 2026 declared a PA day → next school day is Tue Jan 6.
  const d = nextSchoolDay(new Date(2026, 0, 2), { manualNonSchoolDays: ["2026-01-05"] });
  assert.equal(d.getDate(), 6);
  assert.equal(d.getDay(), 2);
});
