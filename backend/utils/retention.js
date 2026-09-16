// backend/utils/retention.js
//
// How long a published result survives without anyone looking at it.
//
// This is one number in three places (created in resultsRoutes, refreshed by a
// student/parent login in studentProgress, and set again when Homework Check
// publishes), and they MUST agree. When they drifted apart the symptom was
// invisible: results simply weren't there any more, with nothing in any log to
// say why.
//
// Mechanism worth remembering: PublishedResult carries a MongoDB TTL index on
// expiresAt (expireAfterSeconds: 0), so Mongo hard-deletes the document the
// moment it passes. There is no archive and no recovery. The clock is reset
// every time a student or parent opens /progress, so an actively-watched
// result effectively lives forever; a quiet one dies.
//
// Why 90 days: 30 was shorter than a summer break, so an entire year's results
// were silently deleted between June and September — including the ref codes
// printed on paper reports, which then resolved to "not found". 90 days
// survives a summer without holding student work indefinitely.
//
// Override with RESULT_RETENTION_DAYS if a school needs a different window.

const DEFAULT_RETENTION_DAYS = 90;

const parsed = parseInt(process.env.RESULT_RETENTION_DAYS || "", 10);
export const RESULT_RETENTION_DAYS =
  Number.isFinite(parsed) && parsed > 0 && parsed <= 3650 ? parsed : DEFAULT_RETENTION_DAYS;

export const RESULT_RETENTION_MS = RESULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The expiry stamp to write on a result being created or refreshed. */
export function resultExpiryDate(from = Date.now()) {
  return new Date(from + RESULT_RETENTION_MS);
}
