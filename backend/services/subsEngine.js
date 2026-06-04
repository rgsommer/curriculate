// backend/services/subsEngine.js
//
// The sequential escalation engine for /subs — the heart of the app.
//
// It contacts a school's preferred substitutes one at a time, in rank
// order, and moves to the next one when the current offer expires (no
// response within the request's interval) or is declined. The first
// teacher to accept wins; all further contact stops.
//
// The engine is deliberately decoupled from MongoDB and from any
// notification provider. It talks to two injected collaborators:
//
//   store    — persistence (Mongo in prod, in-memory in tests). See the
//              method list in subsMongoStore.js for the contract.
//   notifier — sendOffer / notifyFilled / notifyExhausted (subsNotify.js)
//
// `now` is injected (defaults to Date.now) so tests can drive a virtual
// clock through urgent (5-min) and advance (multi-hour) timelines without
// waiting in real time.
//
// Idempotency: the engine keeps exactly one pending offer per open
// request. processRequest() is safe to call repeatedly (the cron sweep,
// the create hook, and decline-driven escalation all funnel through it),
// because it acts only on the request's current state.

import crypto from "crypto";
import { isEligible } from "./subsMatching.js";

export function createEngine({ store, notifier, now = () => Date.now() }) {
  function nowDate() {
    return new Date(now());
  }

  // Decide and apply the next action for a single open request:
  //   • a pending offer still within its interval → wait (no-op)
  //   • a pending offer past its interval         → expire it, escalate
  //   • no pending offer                          → dispatch to next sub
  //   • no remaining ranked subs                  → mark exhausted
  async function processRequest(request) {
    if (!request || request.status !== "open") return;

    const offers = await store.getOffersForRequest(request._id);
    const pending = offers.find((o) => o.status === "pending");

    if (pending) {
      const expiresAt = pending.expiresAt ? new Date(pending.expiresAt).getTime() : Infinity;
      if (nowDate().getTime() < expiresAt) {
        return; // still waiting on this teacher
      }
      // Interval elapsed with no response → expire and escalate.
      await store.updateOffer(pending._id, { status: "expired", respondedAt: nowDate() });
    }

    await dispatchNext(request, offers);
  }

  // The ranked teachers who satisfy the request's HARD requirements
  // (role, qualifications, faith fit). Only these are ever offered the job
  // — challenge #1/#5/#10/#11. Order follows the school's ranking.
  async function eligibleRanked(request) {
    const ranked = await store.getRankedTeachers(request.schoolId, request.gradeLevelId);
    return ranked.filter((r) => isEligible(r.teacher, request));
  }

  // Send an offer to the next-ranked ELIGIBLE teacher who hasn't been
  // contacted yet for this request. If none remain, mark the request
  // exhausted (distinguishing "nobody qualified" from "all qualified
  // declined") and notify the school.
  async function dispatchNext(request, knownOffers) {
    const offers = knownOffers || (await store.getOffersForRequest(request._id));
    const contacted = new Set(offers.map((o) => String(o.teacherId)));

    const eligible = await eligibleRanked(request);
    const next = eligible.find((r) => !contacted.has(String(r.teacherId)));

    if (!next) {
      // No eligible candidates at all vs. everyone qualified passed — the
      // morning dashboard nudges the admin differently for each.
      const reason = eligible.length === 0 ? "no_eligible" : "all_declined";
      await store.updateRequest(request._id, { status: "exhausted", exhaustedReason: reason });
      const ctx = await store.getRequestContext(request._id);
      await notifier.notifyExhausted({ ...ctx, reason });
      return null;
    }

    const offer = await store.createOffer({
      requestId: request._id,
      teacherId: next.teacherId,
      rank: next.rank,
      status: "pending",
      token: crypto.randomBytes(24).toString("hex"),
      sentAt: nowDate(),
      expiresAt: new Date(nowDate().getTime() + request.escalationIntervalMs),
    });
    await store.updateRequest(request._id, { currentRank: next.rank });

    const ctx = await store.getRequestContext(request._id);
    const channels = await notifier.sendOffer({ ...ctx, offer, teacher: next.teacher });
    if (channels && channels.length) {
      await store.updateOffer(offer._id, { channels });
    }
    return offer;
  }

  return {
    // Called right after an admin posts a request: fire the first offer.
    async onRequestCreated(requestId) {
      const request = await store.getRequest(requestId);
      await processRequest(request);
    },

    // The periodic sweep — scans every open request and advances any whose
    // pending offer has elapsed (and (re)dispatches any with none pending).
    async sweep() {
      const open = await store.getOpenRequests();
      let advanced = 0;
      for (const request of open) {
        const before = await store.getOffersForRequest(request._id);
        await processRequest(request);
        const after = await store.getRequest(request._id);
        const afterOffers = await store.getOffersForRequest(request._id);
        if (after?.status !== "open" || afterOffers.length !== before.length) advanced++;
      }
      return { scanned: open.length, advanced };
    },

    // Teacher accepts an offer (from the dashboard or a token link). First
    // acceptance wins; siblings are expired and contacting stops.
    async accept(offer) {
      if (!offer || offer.status !== "pending") return { ok: false, reason: "offer_not_pending" };
      const request = await store.getRequest(offer.requestId);
      if (!request || request.status !== "open") return { ok: false, reason: "request_closed" };

      await store.updateOffer(offer._id, { status: "accepted", respondedAt: nowDate() });
      await store.updateRequest(request._id, {
        status: "filled",
        coverageType: "external",
        filledByTeacherId: offer.teacherId,
        filledOfferId: offer._id,
        filledAt: nowDate(),
      });
      // Expire any other still-pending offers for this request.
      const siblings = await store.getOffersForRequest(request._id);
      for (const o of siblings) {
        if (String(o._id) !== String(offer._id) && o.status === "pending") {
          await store.updateOffer(o._id, { status: "expired", respondedAt: nowDate() });
        }
      }
      const ctx = await store.getRequestContext(request._id);
      const teacher = await store.getTeacher(offer.teacherId);
      await notifier.notifyFilled({ ...ctx, teacher });
      return { ok: true };
    },

    // How many ranked subs actually qualify for this request right now.
    // Used at post time (eligibleCountAtPost) and by the morning dashboard
    // to flag "0 qualified candidates" before anyone is even contacted.
    async countEligible(request) {
      return (await eligibleRanked(request)).length;
    },

    // Internal-coverage fallback (challenge #8). When no external sub is
    // found (or the admin chooses to), record that existing staff will
    // cover and close the request as internally covered. Contacting has
    // already stopped (request is exhausted/open with no further eligible
    // subs); this just flips it to filled with coverageType "internal".
    async assignInternalCoverage(request, { internalCoverageId } = {}) {
      if (!request) return { ok: false, reason: "no_request" };
      if (request.status === "filled") return { ok: false, reason: "already_filled" };
      // Stop any still-pending offer so nobody gets contacted after this.
      const offers = await store.getOffersForRequest(request._id);
      for (const o of offers) {
        if (o.status === "pending") await store.updateOffer(o._id, { status: "expired", respondedAt: nowDate() });
      }
      await store.updateRequest(request._id, {
        status: "filled",
        coverageType: "internal",
        internalCoverageId: internalCoverageId || null,
        filledAt: nowDate(),
      });
      return { ok: true };
    },

    // Teacher declines — escalate immediately rather than waiting out the
    // interval.
    async decline(offer) {
      if (!offer || offer.status !== "pending") return { ok: false, reason: "offer_not_pending" };
      await store.updateOffer(offer._id, { status: "declined", respondedAt: nowDate() });
      const request = await store.getRequest(offer.requestId);
      if (request && request.status === "open") {
        await processRequest(request);
      }
      return { ok: true };
    },

    // Exposed for tests / dev tooling.
    _processRequest: processRequest,
  };
}
