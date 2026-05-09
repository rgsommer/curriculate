/**
 * Event + competitor routes.
 *
 *   POST   /events
 *   PATCH  /events/:id
 *   DELETE /events/:id
 *   POST   /events/:id/submit
 *   POST   /events/:id/reopen
 *
 *   POST   /events/:id/competitors
 *   PATCH  /events/:id/competitors/:cid
 *   DELETE /events/:id/competitors/:cid
 *   PUT    /events/:id/competitors/:cid/attempts/:idx
 *
 *   POST   /announce/:id/announced
 *   POST   /announce/:id/skip
 *
 * Authorization rule: admin can do everything; leader can only mutate events
 * whose `leaderName` matches their session leaderName.
 */
import express from "express";
import { Event } from "../models.js";
import { errResp, asyncH, publicEvent } from "../utils.js";
import { requireSchool } from "../auth.js";

const router = express.Router();

function canMutate(req, ev) {
  if (!ev) return false;
  if (req.fdSession.role === "admin") return true;
  return (ev.leaderName || "").trim().toLowerCase() === (req.fdSession.leaderName || "").trim().toLowerCase();
}

/* POST /events */
router.post("/events", requireSchool, asyncH(async (req, res) => {
  const body = req.body || {};
  const ev = await Event.create({
    schoolId:    req.fdSchoolId,
    leaderName:  body.leaderName || req.fdSession.leaderName || req.fdSession.email || "",
    title:       body.title,
    age:         String(body.age),
    gender:      body.gender,
    type:        body.type || "timed",
    attempts:    body.attempts || 1,
    unit:        body.unit || "",
    notes:       body.notes || "",
    scoreBy:     body.scoreBy || "event",
    format:      body.format  || "individual",
    wind:        body.wind == null ? null : Number(body.wind),
    competitors: Array.isArray(body.competitors) ? body.competitors : []
  });
  res.json({ event: publicEvent(ev) });
}));

/* PATCH /events/:id */
router.patch("/events/:id", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  const allowed = ["title","age","gender","type","attempts","unit","notes","scoreBy","format","wind","competitors","leaderName"];
  allowed.forEach(k => { if (k in req.body) ev[k] = req.body[k]; });
  await ev.save();
  res.json({ event: publicEvent(ev) });
}));

/* DELETE /events/:id */
router.delete("/events/:id", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  await ev.deleteOne();
  res.status(204).end();
}));

/* POST /events/:id/submit */
router.post("/events/:id/submit", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  ev.status = "completed";
  ev.completedAt = Date.now();
  // Append to announce queue if not already there
  if (ev.announceQueuePosition == null && !ev.announcedAt) {
    ev.announceQueuePosition = Date.now();
  }
  await ev.save();
  res.json({ event: publicEvent(ev) });
}));

/* POST /events/:id/reopen */
router.post("/events/:id/reopen", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  ev.status = "in_progress";
  ev.completedAt = null;
  ev.announcedAt = null;
  ev.announceQueuePosition = null;
  await ev.save();
  res.json({ event: publicEvent(ev) });
}));

/* ---------- Competitors ---------- */

/* POST /events/:id/competitors { name } */
router.post("/events/:id/competitors", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  const name = String(req.body?.name || "").trim();
  if (!name) return errResp(res, 400, "missing_name");
  const c = { name, attempts: new Array(ev.attempts || 1).fill(null) };
  ev.competitors.push(c);
  await ev.save();
  const created = ev.competitors[ev.competitors.length - 1];
  res.json({ competitor: created.toObject ? created.toObject() : created });
}));

/* PATCH /events/:id/competitors/:cid */
router.patch("/events/:id/competitors/:cid", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  const c = ev.competitors.find(c => c.id === req.params.cid);
  if (!c) return errResp(res, 404, "competitor_not_found");
  const allowed = ["name","attempts","grade","actualAge","dob","heat","house","members","bib","dq","dqReason","walkup","walkupBy","walkupAt"];
  allowed.forEach(k => { if (k in req.body) c[k] = req.body[k]; });
  await ev.save();
  res.json({ competitor: c.toObject ? c.toObject() : c });
}));

/* DELETE /events/:id/competitors/:cid */
router.delete("/events/:id/competitors/:cid", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  ev.competitors = ev.competitors.filter(c => c.id !== req.params.cid);
  await ev.save();
  res.status(204).end();
}));

/* PUT /events/:id/competitors/:cid/attempts/:idx { value } */
router.put("/events/:id/competitors/:cid/attempts/:idx", requireSchool, asyncH(async (req, res) => {
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  if (!canMutate(req, ev)) return errResp(res, 403, "forbidden");
  const c = ev.competitors.find(c => c.id === req.params.cid);
  if (!c) return errResp(res, 404, "competitor_not_found");
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0) return errResp(res, 400, "bad_index");
  while (c.attempts.length <= idx) c.attempts.push(null);
  const v = req.body?.value;
  c.attempts[idx] = (v == null || v === "") ? null : Number(v);
  await ev.save();
  res.json({ competitor: c.toObject ? c.toObject() : c });
}));

/* ---------- Announce ---------- */

/* POST /announce/:id/announced */
router.post("/announce/:id/announced", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  ev.announcedAt = Date.now();
  ev.announceQueuePosition = null;
  await ev.save();
  res.json({ ok: true });
}));

/* POST /announce/:id/skip — moves to back of queue (we just bump the position) */
router.post("/announce/:id/skip", requireSchool, asyncH(async (req, res) => {
  if (req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  const ev = await Event.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!ev) return errResp(res, 404, "not_found");
  ev.announceQueuePosition = Date.now() + 60000; // pushes it past anything currently waiting
  await ev.save();
  res.json({ ok: true });
}));

export default router;
