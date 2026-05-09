/**
 * Auth routes:
 *   POST /admin/request-passkey
 *   POST /admin/verify-passkey
 *   POST /schools                  — create new school (admin must be authenticated)
 *   POST /admin/join-school        — join an existing school by code
 *   POST /admin/select-school
 *   POST /leader/join
 *   GET  /leader/staff?code=...
 *   POST /sign-out
 */
import express from "express";
import { School, Passkey, Session } from "../models.js";
import { gen6, genToken, hash, verify, passkeyExpiresAt, sessionExpiresAt, errResp, asyncH, publicSchool } from "../utils.js";
import { sendPasskeyEmail } from "../email.js";

const router = express.Router();

/* POST /admin/request-passkey { email } */
router.post("/admin/request-passkey", asyncH(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return errResp(res, 400, "bad_email");

  const passkey = gen6();
  await Passkey.deleteMany({ email });
  await Passkey.create({
    email,
    passkeyHash: await hash(passkey),
    expiresAt: passkeyExpiresAt()
  });

  let emailed = true;
  try { await sendPasskeyEmail(email, passkey); }
  catch (e) { console.warn("[fieldday] email failed", e); emailed = false; }

  const adminCount = await School.countDocuments({ adminEmails: email });
  const out = { emailed, hasSchools: adminCount > 0 };
  // Dev fallback: only echo the passkey when explicitly enabled (e.g. local dev).
  if (process.env.FIELDDAY_DEV_ECHO_PASSKEY === "1") out.devPasskey = passkey;
  res.json(out);
}));

/* POST /admin/verify-passkey { email, passkey } */
router.post("/admin/verify-passkey", asyncH(async (req, res) => {
  const email   = String(req.body?.email   || "").trim().toLowerCase();
  const passkey = String(req.body?.passkey || "").trim();
  if (!email || !passkey) return errResp(res, 400, "missing_fields");

  const stored = await Passkey.findOne({ email }).sort({ createdAt: -1 });
  if (!stored) return errResp(res, 401, "bad_passkey");
  const ok = await verify(passkey, stored.passkeyHash);
  if (!ok) return errResp(res, 401, "bad_passkey");

  // Single-use: consume the passkey.
  await Passkey.deleteMany({ email });

  const schools = await School.find({ adminEmails: email }).lean();
  const sessionToken = genToken();
  await Session.create({
    token:     sessionToken,
    role:      "admin",
    email,
    schoolId:  schools.length === 1 ? schools[0]._id : null,
    expiresAt: sessionExpiresAt()
  });
  res.json({
    sessionToken,
    schools: schools.map(s => ({ id: s._id.toString(), name: s.name, code: s.code, createdAt: s.createdAt }))
  });
}));

/* POST /schools { name, code } — creates new school for the authenticated admin */
router.post("/schools", asyncH(async (req, res) => {
  const sess = req.fdSession; if (!sess || sess.role !== "admin") return errResp(res, 401, "unauthorized");
  const name = String(req.body?.name || "").trim();
  const code = String(req.body?.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!name)            return errResp(res, 400, "bad_name");
  if (code.length < 3)  return errResp(res, 400, "bad_code");
  const dup = await School.findOne({ code }).lean();
  if (dup) return errResp(res, 409, "code_taken");

  const school = await School.create({
    name, code,
    masterAdminEmail: sess.email,
    adminEmails: [sess.email],
    eventLibrary: ["50m Sprint","100m Sprint","200m Sprint","400m Run","800m Run","Hurdles","Relay Race",
                   "Long Jump","Standing Long Jump","High Jump","Triple Jump",
                   "Shot Put","Softball Throw","Cricket Ball Throw","Vortex Throw","Frisbee Throw","Football Throw",
                   "Sack Race","Three-Legged Race","Egg & Spoon Race","Wheelbarrow Race","Tug of War","Obstacle Course"],
    divisions: [
      { name: "Junior",       ageRange: [5, 8] },
      { name: "Intermediate", ageRange: [9, 11] },
      { name: "Senior",       ageRange: [12, 14] }
    ]
  });

  await Session.updateOne({ token: sess.token }, { $set: { schoolId: school._id } });
  res.json({ school: publicSchool(school) });
}));

/* POST /admin/join-school { schoolCode } */
router.post("/admin/join-school", asyncH(async (req, res) => {
  const sess = req.fdSession; if (!sess || sess.role !== "admin") return errResp(res, 401, "unauthorized");
  const code = String(req.body?.schoolCode || "").trim().toUpperCase();
  const school = await School.findOne({ code });
  if (!school) return errResp(res, 404, "school_not_found");
  if (!school.adminEmails.includes(sess.email)) {
    school.adminEmails.push(sess.email);
    await school.save();
  }
  await Session.updateOne({ token: sess.token }, { $set: { schoolId: school._id } });
  res.json({ school: publicSchool(school) });
}));

/* POST /admin/select-school { schoolId } */
router.post("/admin/select-school", asyncH(async (req, res) => {
  const sess = req.fdSession; if (!sess || sess.role !== "admin") return errResp(res, 401, "unauthorized");
  const schoolId = String(req.body?.schoolId || "");
  const school = await School.findById(schoolId).lean();
  if (!school || !school.adminEmails.includes(sess.email)) return errResp(res, 404, "school_not_found");
  await Session.updateOne({ token: sess.token }, { $set: { schoolId: school._id } });
  res.json({ ok: true });
}));

/* POST /leader/join { schoolCode, leaderName, pin? } */
router.post("/leader/join", asyncH(async (req, res) => {
  const code = String(req.body?.schoolCode || "").trim().toUpperCase();
  const name = String(req.body?.leaderName || "").trim();
  const pin  = String(req.body?.pin || "").trim();
  if (!code || !name) return errResp(res, 400, "missing_fields");
  const school = await School.findOne({ code }).lean();
  if (!school) return errResp(res, 404, "school_not_found");

  // PIN gate (when enabled): the leader's name must have a PIN entry and the
  // supplied PIN must match. Lookup is case-insensitive on the trimmed name.
  if (school.requireLeaderPin) {
    const key = name.toLowerCase().trim();
    const entry = (school.staffPins || {})[key];
    if (!entry || !entry.hash) return errResp(res, 401, "pin_required");
    if (!pin || pin.length < 4)  return errResp(res, 401, "pin_required");
    const ok = await verify(pin, entry.hash);
    if (!ok) return errResp(res, 401, "bad_pin");
  }

  const sessionToken = genToken();
  await Session.create({
    token: sessionToken, role: "leader", schoolId: school._id, leaderName: name,
    expiresAt: sessionExpiresAt()
  });
  res.json({
    sessionToken,
    school: { id: school._id.toString(), name: school.name, code: school.code, requireLeaderPin: !!school.requireLeaderPin }
  });
}));

/* GET /leader/staff?code=... — public; lists staff names registered for a school */
router.get("/leader/staff", asyncH(async (req, res) => {
  const code = String(req.query?.code || "").trim().toUpperCase();
  if (!code) return errResp(res, 400, "missing_code");
  const school = await School.findOne({ code }).lean();
  if (!school) return errResp(res, 404, "school_not_found");
  const names = new Set();
  Object.values(school.eventStaff || {}).forEach(byDiv => {
    Object.values(byDiv || {}).forEach(byRole => {
      Object.values(byRole || {}).forEach(n => { if (n && String(n).trim()) names.add(String(n).trim()); });
    });
  });
  res.json({
    school: { name: school.name, code: school.code },
    staff: [...names].sort()
  });
}));

/* POST /sign-out */
router.post("/sign-out", asyncH(async (req, res) => {
  const sess = req.fdSession;
  if (sess) await Session.deleteOne({ token: sess.token });
  res.json({ ok: true });
}));

export default router;
