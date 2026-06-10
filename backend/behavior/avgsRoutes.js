// backend/behavior/avgsRoutes.js
//
// Honour-roll routes backing the public /avgs page's "live from Edsby" panel.
// Mounted from routes.js at /api/behavior/avgs behind authAny + loadMembership,
// so every handler has req.schoolId / req.membership. Reuses the behaviours
// app's encrypted Edsby session (BehaviorConfig.edsby — kept fresh by the
// Cookie Sync extension) and its student roster (BehaviorStudent.edsbyStudentId
// is each student's Edsby nid).
//
//   GET  /config        — setup: grade range, thresholds, class weights
//   PUT  /config        — save setup (admin)
//   POST /probe         — sample a few students per grade from Edsby, discover
//                         classes, guess weights, merge into config (admin)
//   POST /refresh       — pull every in-range student's current grades from
//                         Edsby, compute weighted averages + tiers, snapshot
//   GET  /results       — latest snapshot
//
// Edsby's per-student grade view is NOT verified yet (no public API). probe and
// refresh therefore return rich diagnostics — view tried, HTTP status, JSON
// shape — so the right view/parse can be pinned down from a real session.

import express from "express";
import BehaviorConfig from "./models/BehaviorConfig.js";
import BehaviorStudent from "./models/BehaviorStudent.js";
import { HonourRollConfig, HonourRollSnapshot } from "./models/HonourRoll.js";
import { decrypt, encrypt } from "./lib/secretBox.js";
import {
  fetchZoomStudents,
  fetchClassGradebook,
  guessWeight,
  normalizeClassKey,
  computeStudent,
  mapPool,
} from "./lib/edsbyRead.js";

const MAX_STUDENTS_PER_REFRESH = 600;
const FETCH_CONCURRENCY = 4;

async function loadEdsbySession(schoolId) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  const e = config?.edsby || {};
  if (!e.baseUrl || !e.cookieEnc) {
    return { error: "Edsby is not connected for this school — connect it in Behaviours Setup first (base URL + session cookie, ideally via the Cookie Sync extension)." };
  }
  return {
    session: {
      baseUrl: e.baseUrl,
      cookie: decrypt(e.cookieEnc),
      jver: e.jver || "",
      cver: e.cver || "",
      userNid: e.userNid || "", // used to refresh the formkey from the bootstrap
    },
  };
}

async function getOrCreateConfig(schoolId) {
  let cfg = await HonourRollConfig.findOne({ schoolId });
  if (!cfg) cfg = await HonourRollConfig.create({ schoolId });
  return cfg;
}

/**
 * Load the Edsby student roster (ZoomMyStudents) across the configured node(s),
 * unioned by nid. Each person carries name, grade, Edsby's overall average, and
 * their class list (id+name). Refreshes/persists the formkey along the way.
 * Returns { people, view, diagnostics } or { error } / { sessionExpired }.
 */
async function loadZoomRoster(schoolId, session, bodyZoomId) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  const e = config?.edsby || {};
  const hrCfg = await HonourRollConfig.findOne({ schoolId }).lean();
  const nodeSpec = String(bodyZoomId || hrCfg?.zoomNid || e.zoomId || "").trim();
  const nodeIds = nodeSpec.split(",").map((s) => s.trim()).filter(Boolean);
  if (!nodeIds.length) {
    return { error: "No Edsby “My Students” node id set. In Edsby open My Students — the number in the page URL (/p/ZoomMyStudents/NUMBER) is it. Paste it in the “My Students node” box and Save." };
  }
  let savedFormkey = e.formkeyEnc ? decrypt(e.formkeyEnc) : "";
  const diagnostics = [];
  const peopleByNid = new Map();
  let view = null;
  for (const nodeId of nodeIds) {
    const r = await fetchZoomStudents(session, nodeId, savedFormkey);
    if (r.formkey && r.formkey !== savedFormkey) {
      savedFormkey = r.formkey;
      await BehaviorConfig.updateOne({ schoolId }, { $set: { "edsby.formkeyEnc": encrypt(r.formkey) } });
    }
    if (r.sessionExpired) return { sessionExpired: true };
    if (r.view) view = r.view;
    for (const p of r.people || []) if (p?.nid && !peopleByNid.has(p.nid)) peopleByNid.set(p.nid, p);
    if (nodeIds.length > 1) diagnostics.push({ step: `node ${nodeId}`, note: `${(r.people || []).length} people` });
    diagnostics.push(...(r.diagnostics || []));
  }
  return { people: [...peopleByNid.values()], view, diagnostics };
}

function gradeInRange(grade, min, max) {
  const n = parseInt(String(grade || "").replace(/\D+/g, ""), 10);
  return Number.isFinite(n) && n >= min && n <= max;
}

async function inRangeStudents(schoolId, cfg) {
  const all = await BehaviorStudent.find({ schoolId })
    .select("firstName lastName preferredName grade classGroup edsbyStudentId")
    .lean();
  return all.filter((s) => gradeInRange(s.grade, cfg.gradeMin, cfg.gradeMax));
}

const displayName = (s) =>
  `${(s.preferredName || s.firstName || "").trim()} ${(s.lastName || "").trim()}`.trim() || "(unnamed)";

export function buildAvgsRouter({ requireAdmin }) {
  const router = express.Router();

  router.get("/config", async (req, res, next) => {
    try {
      const cfg = await getOrCreateConfig(req.schoolId);
      const students = await inRangeStudents(req.schoolId, cfg);
      res.json({
        ok: true,
        config: cfg,
        rosterInRange: students.length,
        rosterMissingNid: students.filter((s) => !s.edsbyStudentId).length,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put("/config", requireAdmin, async (req, res, next) => {
    try {
      const { gradeMin, gradeMax, honours, highHonours, zoomNid, classes } = req.body || {};
      const $set = {};
      if (Number.isFinite(+gradeMin)) $set.gradeMin = Math.max(0, Math.min(12, +gradeMin));
      if (Number.isFinite(+gradeMax)) $set.gradeMax = Math.max(0, Math.min(12, +gradeMax));
      if (Number.isFinite(+honours)) $set.honours = Math.max(0, Math.min(100, +honours));
      if (Number.isFinite(+highHonours)) $set.highHonours = Math.max(0, Math.min(100, +highHonours));
      if (typeof zoomNid === "string") {
        // Keep only digits and commas (one or more Edsby Zoom node ids).
        $set.zoomNid = zoomNid.replace(/[^\d,]/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "").slice(0, 200);
      }
      if (Array.isArray(classes)) {
        $set.classes = classes
          .filter((c) => c && String(c.name || "").trim())
          .slice(0, 200)
          .map((c) => ({
            name: String(c.name).trim().slice(0, 80),
            daysPerWeek: Number.isFinite(+c.daysPerWeek) ? Math.max(0, Math.min(5, +c.daysPerWeek)) : 2,
            weight: Number.isFinite(+c.weight) ? Math.max(0, Math.min(1, +c.weight)) : 0.4,
            include: c.include !== false,
            source: c.source === "probe" ? "probe" : "manual",
            note: String(c.note || "").slice(0, 120),
          }));
      }
      const cfg = await HonourRollConfig.findOneAndUpdate(
        { schoolId: req.schoolId },
        { $set },
        { new: true, upsert: true }
      );
      res.json({ ok: true, config: cfg });
    } catch (err) {
      next(err);
    }
  });

  // Harvest student Edsby nids: pull the students listing from Edsby via the
  // session, match people to the roster by name, and fill in edsbyStudentId.
  // This is the prerequisite the probe/refresh error messages point at.
  router.post("/harvest-nids", requireAdmin, async (req, res, next) => {
    try {
      const { session, error } = await loadEdsbySession(req.schoolId);
      if (error) return res.json({ ok: false, error });

      const r = await loadZoomRoster(req.schoolId, session, req.body?.zoomId);
      if (r.error) return res.json({ ok: false, error: r.error });
      if (r.sessionExpired) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }
      if (!r.people.length) {
        return res.json({
          ok: false,
          error: "Edsby answered, but no student list could be read from the response. Diagnostics attached — share them to get the parser tuned to your school.",
          diagnostics: r.diagnostics,
        });
      }

      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

      // First-name variants for one person: preferred, legal, the first token of
      // the full name, plus any parenthetical nickname and the pre-paren legal
      // name — Edsby stores "Oluwatobiloba(Tobi)" where a roster has "Tobi".
      const firstVariants = (cands) => {
        const out = new Set();
        const add = (s) => { const t = String(s || "").trim(); if (t) out.add(t); };
        for (const c of cands) add(c);
        for (const c of [...out]) {
          const m = String(c).match(/\(([^)]+)\)/);
          if (m) add(m[1]);                       // the "(Tobi)" nickname
          add(String(c).replace(/\([^)]*\)/g, "")); // the name minus parens
        }
        return [...out];
      };

      // Exact-key index: "first+last" and "last+first" across every first-name
      // variant, plus the whole name. Ambiguous keys (two people) are dropped.
      const byKey = new Map();
      const claim = (key, nid) => {
        if (!key) return;
        if (byKey.has(key) && byKey.get(key) !== nid) byKey.set(key, "AMBIGUOUS");
        else byKey.set(key, nid);
      };
      // Same-lastname buckets for the fuzzy fallback.
      const byLast = new Map();
      for (const p of r.people) {
        const last = p.last || String(p.name).split(/\s+/).slice(1).join(" ");
        const firsts = firstVariants([p.first, p.firstName, p.prefName, String(p.name).split(/\s+/)[0]]);
        for (const f of firsts) {
          claim(norm(f + last), p.nid);
          claim(norm(last + f), p.nid);
        }
        claim(norm(p.name), p.nid);
        const lk = norm(last);
        if (lk) {
          if (!byLast.has(lk)) byLast.set(lk, []);
          byLast.get(lk).push({ nid: p.nid, firsts: firsts.map(norm).filter(Boolean) });
        }
      }

      const students = await BehaviorStudent.find({ schoolId: req.schoolId })
        .select("firstName lastName preferredName edsbyStudentId")
        .lean();

      // Two first names are "compatible" if one is a prefix of, or contained in,
      // the other (≥3 chars) — covers Tobi⊂Oluwatobiloba(Tobi) and Max/Maxwell.
      const compatible = (a, b) => {
        if (!a || !b || a.length < 3 || b.length < 3) return false;
        return a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
      };

      let matched = 0, already = 0, fuzzy = 0;
      const unmatched = [];
      const ops = [];
      const usedNids = new Set();
      const claimNid = (s, nid) => {
        matched++;
        usedNids.add(nid);
        ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { edsbyStudentId: nid } } } });
      };
      for (const s of students) {
        if (s.edsbyStudentId) { already++; continue; }
        const keys = [
          norm((s.firstName || "") + (s.lastName || "")),
          norm((s.preferredName || "") + (s.lastName || "")),
          norm((s.lastName || "") + (s.firstName || "")),
          norm((s.lastName || "") + (s.preferredName || "")),
        ];
        const nid = keys.map((k) => byKey.get(k)).find((v) => v && v !== "AMBIGUOUS");
        if (nid) {
          claimNid(s, nid);
          continue;
        }
        // Fuzzy fallback: among Edsby people with the SAME last name, find the
        // unique one whose first name is compatible and not already taken.
        const lk = norm(s.lastName);
        const sFirsts = [norm(s.firstName), norm(s.preferredName)].filter(Boolean);
        const cands = (byLast.get(lk) || []).filter(
          (p) => !usedNids.has(p.nid) && p.firsts.some((ef) => sFirsts.some((sf) => compatible(ef, sf)))
        );
        const uniqueNids = [...new Set(cands.map((c) => c.nid))];
        if (uniqueNids.length === 1) {
          fuzzy++;
          claimNid(s, uniqueNids[0]);
        } else {
          unmatched.push(displayName(s));
        }
      }
      if (ops.length) await BehaviorStudent.bulkWrite(ops);

      res.json({
        ok: true,
        edsbyView: r.view, // which Edsby view actually listed the students
        edsbyPeople: r.people.length,
        matched,
        fuzzyMatched: fuzzy,
        alreadyHadNid: already,
        unmatchedRoster: unmatched.slice(0, 40),
        unmatchedRosterCount: unmatched.length,
        diagnostics: r.diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // Discover classes: read the student roster from Edsby and union every class
  // each student is enrolled in. Each gets a name-based weight guess to edit.
  router.post("/probe", requireAdmin, async (req, res, next) => {
    try {
      const cfg = await getOrCreateConfig(req.schoolId);
      const { session, error } = await loadEdsbySession(req.schoolId);
      if (error) return res.json({ ok: false, error });

      const roster = await loadZoomRoster(req.schoolId, session, req.body?.zoomId);
      if (roster.error) return res.json({ ok: false, error: roster.error });
      if (roster.sessionExpired) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }
      if (!roster.people.length) {
        return res.json({ ok: false, error: "Edsby returned no students. Diagnostics attached — share them to get the parser tuned.", diagnostics: roster.diagnostics });
      }

      // Only consider classes belonging to students in the configured grade range.
      const inRange = roster.people.filter((p) => gradeInRange(p.grade, cfg.gradeMin, cfg.gradeMax));
      const people = inRange.length ? inRange : roster.people;

      // Union of class names, merged into config. Existing entries keep their
      // (possibly hand-edited) weights; new ones get a name-based guess.
      const existing = new Map(cfg.classes.map((c) => [normalizeClassKey(c.name), c]));
      let added = 0;
      const discovered = new Set();
      for (const p of people) {
        for (const c of p.classes || []) {
          const key = normalizeClassKey(c.name);
          if (!key) continue;
          discovered.add(key);
          if (!existing.has(key)) {
            const g = guessWeight(c.name);
            existing.set(key, {
              name: c.name,
              daysPerWeek: g.daysPerWeek,
              weight: g.weight,
              include: g.include !== false,
              source: "probe",
              note: g.note || "",
            });
            added++;
          }
        }
      }
      cfg.classes = [...existing.values()];
      await cfg.save();

      res.json({
        ok: true,
        sampled: people.length,
        classesDiscovered: discovered.size,
        classesAdded: added,
        config: cfg,
        diagnostics: roster.diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // Pull fresh grades and snapshot the honour roll. Reads the Edsby roster
  // (students + their class list + grade) once, then each referenced class's
  // gradebook once, and joins them by nid — so the weighted average uses each
  // class's verified overall mark. Far fewer Edsby calls than per-student.
  router.post("/refresh", async (req, res, next) => {
    try {
      const cfg = await getOrCreateConfig(req.schoolId);
      const { session, error } = await loadEdsbySession(req.schoolId);
      if (error) return res.json({ ok: false, error });

      const roster = await loadZoomRoster(req.schoolId, session, req.body?.zoomId);
      if (roster.error) return res.json({ ok: false, error: roster.error });
      if (roster.sessionExpired) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }
      if (!roster.people.length) {
        return res.json({ ok: false, error: "Edsby returned no students. Diagnostics attached.", diagnostics: roster.diagnostics });
      }

      // Restrict to the configured grade range (by Edsby's grade on each person).
      const people = roster.people
        .filter((p) => gradeInRange(p.grade, cfg.gradeMin, cfg.gradeMax))
        .slice(0, MAX_STUDENTS_PER_REFRESH);
      if (!people.length) {
        return res.json({ ok: false, error: `Edsby listed ${roster.people.length} students but none in grades ${cfg.gradeMin}–${cfg.gradeMax}. Check the grade range or add the right My Students node.` });
      }

      // Every distinct class across these students → fetch each gradebook once.
      const classNames = new Map(); // classId → display name
      for (const p of people) for (const c of p.classes || []) if (!classNames.has(c.id)) classNames.set(c.id, c.name);
      const classIds = [...classNames.keys()];

      let sessionExpired = false;
      const classMarks = new Map(); // classId → Map(studentNid → average)
      const classDiag = [];
      await mapPool(classIds, FETCH_CONCURRENCY, async (cid) => {
        if (sessionExpired) return;
        const g = await fetchClassGradebook(session, cid);
        if (g.sessionExpired) { sessionExpired = true; return; }
        classMarks.set(cid, g.marks);
        if (!g.marks.size && classDiag.length < 8) classDiag.push({ classId: cid, name: classNames.get(cid), note: g.error || `no marks; shape: ${g.shape || "?"}` });
      });
      if (sessionExpired) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }

      const thresholds = { honours: cfg.honours, highHonours: cfg.highHonours };
      const students = people.map((p) => {
        // Build this student's per-class marks from the gradebooks.
        const courses = (p.classes || []).map((c) => ({
          name: c.name,
          pct: classMarks.get(c.id)?.get(p.nid) ?? null,
        }));
        const computed = computeStudent(courses, cfg.classes, thresholds);
        return {
          studentId: null,
          edsbyNid: p.nid,
          name: p.name,
          grade: String(p.grade || ""),
          classGroup: "",
          weightedAvg: computed.weightedAvg,
          tier: computed.tier,
          courses: computed.courses,
          edsbyAverage: p.average, // Edsby's own unweighted average, for reference
          error: computed.weightedAvg === null ? "no class marks found" : "",
        };
      });

      const snapshot = await HonourRollSnapshot.create({
        schoolId: req.schoolId,
        takenAt: new Date(),
        students,
        diagnostics: {
          requested: people.length,
          succeeded: students.filter((s) => !s.error).length,
          classesFetched: classIds.length,
          classesWithNoMarks: classDiag,
        },
      });

      res.json({ ok: true, snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.get("/results", async (req, res, next) => {
    try {
      const snapshot = await HonourRollSnapshot.findOne({ schoolId: req.schoolId })
        .sort({ takenAt: -1 })
        .lean();
      res.json({ ok: true, snapshot: snapshot || null });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default buildAvgsRouter;
