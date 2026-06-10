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
  fetchStudentCourses,
  fetchZoomStudents,
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

      const cfg = await getOrCreateConfig(req.schoolId);
      const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
      const e = config?.edsby || {};
      // Student-list node(s): the avgs config's zoomNid (the "My Students" Zoom,
      // /p/ZoomMyStudents/<nid>), or a body override, or the Behaviours formkey
      // Zoom id as a last resort. Comma-separated → multiple nodes get unioned.
      const nodeSpec = String(req.body?.zoomId || cfg.zoomNid || e.zoomId || "").trim();
      const nodeIds = nodeSpec.split(",").map((s) => s.trim()).filter(Boolean);
      if (!nodeIds.length) {
        return res.json({
          ok: false,
          error: "No Edsby “My Students” node id set. In Edsby open My Students — the number in the page URL (/p/ZoomMyStudents/NUMBER) is it. Paste it in the “My Students node” box and Save.",
        });
      }
      const formkey = e.formkeyEnc ? decrypt(e.formkeyEnc) : "";

      // Fetch each node and union the people (dedupe by nid).
      const diagnostics = [];
      const peopleByNid = new Map();
      let usedView = null, savedFormkey = formkey;
      for (const nodeId of nodeIds) {
        const r = await fetchZoomStudents(session, nodeId, savedFormkey);
        if (r.formkey && r.formkey !== savedFormkey) {
          savedFormkey = r.formkey;
          await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "edsby.formkeyEnc": encrypt(r.formkey) } });
        }
        if (r.sessionExpired) {
          return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
        }
        if (r.view) usedView = r.view;
        for (const p of r.people || []) if (p?.nid && !peopleByNid.has(p.nid)) peopleByNid.set(p.nid, p);
        if (nodeIds.length > 1) diagnostics.push({ step: `node ${nodeId}`, note: `${(r.people || []).length} people` });
        diagnostics.push(...(r.diagnostics || []));
      }
      const r = { people: [...peopleByNid.values()], view: usedView, diagnostics };
      if (!r.people.length) {
        return res.json({
          ok: false,
          error: "Edsby answered, but no student list could be read from the response. Diagnostics attached — share them to get the parser tuned to your school.",
          diagnostics: r.diagnostics,
        });
      }

      // Index Edsby people by normalized name keys ("first last" and "last first").
      // A key claimed by two different people is ambiguous → unusable.
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
      const byKey = new Map();
      const claim = (key, nid) => {
        if (!key) return;
        if (byKey.has(key) && byKey.get(key) !== nid) byKey.set(key, "AMBIGUOUS");
        else byKey.set(key, nid);
      };
      for (const p of r.people) {
        const first = p.first || String(p.name).split(/\s+/)[0];
        const last = p.last || String(p.name).split(/\s+/).slice(1).join(" ");
        claim(norm(first + last), p.nid);
        claim(norm(last + first), p.nid);
        claim(norm(p.name), p.nid);
      }

      const students = await BehaviorStudent.find({ schoolId: req.schoolId })
        .select("firstName lastName preferredName edsbyStudentId")
        .lean();

      let matched = 0, already = 0;
      const unmatched = [];
      const ops = [];
      for (const s of students) {
        if (s.edsbyStudentId) { already++; continue; }
        const keys = [
          norm((s.firstName || "") + (s.lastName || "")),
          norm((s.preferredName || "") + (s.lastName || "")),
          norm((s.lastName || "") + (s.firstName || "")),
        ];
        const nid = keys.map((k) => byKey.get(k)).find((v) => v && v !== "AMBIGUOUS");
        if (nid) {
          matched++;
          ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { edsbyStudentId: nid } } } });
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
        alreadyHadNid: already,
        unmatchedRoster: unmatched.slice(0, 40),
        unmatchedRosterCount: unmatched.length,
        diagnostics: r.diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // Discover classes: pull a few students per grade and union their courses.
  router.post("/probe", requireAdmin, async (req, res, next) => {
    try {
      const cfg = await getOrCreateConfig(req.schoolId);
      const { session, error } = await loadEdsbySession(req.schoolId);
      if (error) return res.json({ ok: false, error });

      const students = (await inRangeStudents(req.schoolId, cfg)).filter((s) => s.edsbyStudentId);
      if (!students.length) {
        return res.json({
          ok: false,
          error: "No students in the grade range have an Edsby ID yet. Use “Extract student IDs” first.",
        });
      }

      // Up to 3 sample students per grade — enough to see every class without
      // hammering Edsby.
      const byGrade = new Map();
      for (const s of students) {
        const g = String(s.grade);
        if (!byGrade.has(g)) byGrade.set(g, []);
        if (byGrade.get(g).length < 3) byGrade.get(g).push(s);
      }
      const sample = [...byGrade.values()].flat();

      const results = await mapPool(sample, FETCH_CONCURRENCY, async (s) => ({
        student: displayName(s),
        ...(await fetchStudentCourses(session, s.edsbyStudentId)),
      }));

      if (results.some((r) => r.sessionExpired)) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }

      // Union of discovered class names, merged into config. Existing entries
      // keep their (possibly hand-edited) weights; new ones get guessed.
      const existing = new Map(cfg.classes.map((c) => [normalizeClassKey(c.name), c]));
      let added = 0;
      const discovered = new Set();
      for (const r of results) {
        for (const c of r.courses || []) {
          const key = normalizeClassKey(c.name);
          discovered.add(key);
          if (!existing.has(key)) {
            const g = guessWeight(c.name);
            existing.set(key, {
              name: c.name,
              daysPerWeek: g.daysPerWeek,
              weight: g.weight,
              include: true,
              source: "probe",
              note: g.note || "",
            });
            added++;
          }
        }
      }
      cfg.classes = [...existing.values()];
      await cfg.save();

      const diagnostics = results
        .filter((r) => !r.courses?.length)
        .map((r) => ({ student: r.student, tried: r.diagnostics }));
      const scheduleHints = results.flatMap((r) => r.scheduleHints || []).slice(0, 20);

      res.json({
        ok: true,
        sampled: sample.length,
        classesDiscovered: discovered.size,
        classesAdded: added,
        config: cfg,
        // Raw material for wiring automatic times-per-week once we see real
        // schedule data in Edsby's JSON.
        scheduleHints,
        diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // Pull fresh grades for every in-range student and snapshot the honour roll.
  router.post("/refresh", async (req, res, next) => {
    try {
      const cfg = await getOrCreateConfig(req.schoolId);
      const { session, error } = await loadEdsbySession(req.schoolId);
      if (error) return res.json({ ok: false, error });

      const inRange = await inRangeStudents(req.schoolId, cfg);
      const withNid = inRange.filter((s) => s.edsbyStudentId).slice(0, MAX_STUDENTS_PER_REFRESH);
      const missingNid = inRange.filter((s) => !s.edsbyStudentId).map(displayName);
      if (!withNid.length) {
        return res.json({
          ok: false,
          error: "No students in the grade range have an Edsby ID yet. Use “Extract student IDs” first.",
        });
      }

      const thresholds = { honours: cfg.honours, highHonours: cfg.highHonours };
      let sessionExpired = false;
      const viewDiagnostics = [];

      const rows = await mapPool(withNid, FETCH_CONCURRENCY, async (s) => {
        if (sessionExpired) return { student: s, error: "skipped — session expired" };
        const r = await fetchStudentCourses(session, s.edsbyStudentId);
        if (r.sessionExpired) {
          sessionExpired = true;
          return { student: s, error: "Edsby session expired" };
        }
        if (!r.courses.length) {
          if (viewDiagnostics.length < 5) viewDiagnostics.push({ student: displayName(s), tried: r.diagnostics });
          return { student: s, error: "no course data found" };
        }
        return { student: s, computed: computeStudent(r.courses, cfg.classes, thresholds) };
      });

      if (sessionExpired) {
        return res.json({ ok: false, error: "Edsby session cookie has expired — refresh it (Cookie Sync extension or re-paste in Behaviours Setup)." });
      }

      const students = rows.map(({ student: s, computed, error: rowError }) => ({
        studentId: s._id,
        name: displayName(s),
        grade: String(s.grade || ""),
        classGroup: s.classGroup || "",
        weightedAvg: computed?.weightedAvg ?? null,
        tier: computed?.tier || "",
        courses: computed?.courses || [],
        error: rowError || "",
      }));

      const snapshot = await HonourRollSnapshot.create({
        schoolId: req.schoolId,
        takenAt: new Date(),
        students,
        diagnostics: {
          requested: withNid.length,
          succeeded: students.filter((s) => !s.error).length,
          missingNid,
          viewDiagnostics,
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
