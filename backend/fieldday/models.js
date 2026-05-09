/**
 * Field Day — Mongoose models
 *
 * One file for browsability. All collection names prefixed `fieldday_*`
 * so they don't collide with anything Curriculate already has.
 *
 * Composition:
 *   - School (top-level config + houses + divisions + library + records-as-subdoc + ...)
 *   - Event (with embedded competitors, embedded heats, status)
 *   - Standard, PersonalBest, Archive — separate collections referenced by schoolId
 *   - Passkey, Session, CodeChangeRequest — TTL collections for short-lived auth state
 *
 * If you'd rather break this up, each schema below is independent — copy
 * any one out into its own file and re-export.
 */
const mongoose = require("mongoose");

const { Schema, Types } = mongoose;
const opts = { timestamps: true, versionKey: false };

/* ---------------- School ---------------- */
const DivisionSchema = new Schema({
  name: { type: String, required: true },
  ageRange: { type: [Number], default: [0, 0] }
}, { _id: false });

const RecordSubSchema = new Schema({
  id:           { type: String, default: () => new Types.ObjectId().toString() },
  title:        { type: String, required: true },
  age:          { type: String, required: true },
  gender:       { type: String, required: true },
  type:         { type: String, default: "timed" },
  unit:         { type: String, default: "" },
  value:        { type: Number, required: true },
  holderName:   { type: String, default: "" },
  dateSet:      { type: String, default: "" },
  eventId:      { type: String, default: "" },
  competitorId: { type: String, default: "" },
  createdAt:    { type: Number, default: () => Date.now() }
}, { _id: false });

const ArchiveSubSchema = new Schema({
  id:            { type: String, default: () => new Types.ObjectId().toString() },
  label:         { type: String, required: true },
  archivedAt:    { type: Number, default: () => Date.now() },
  events:        { type: Array, default: [] },          // snapshot of full event docs
  announceQueue: { type: [String], default: [] }
}, { _id: false });

const StandardSubSchema = new Schema({
  id:       { type: String, default: () => new Types.ObjectId().toString() },
  title:    { type: String, required: true },
  ageBand:  { type: String, required: true },
  gender:   { type: String, required: true },
  type:     { type: String, default: "timed" },
  unit:     { type: String, default: "" },
  gold:     Number,
  silver:   Number,
  bronze:   Number
}, { _id: false });

const PBSubSchema = new Schema({
  id:       { type: String, default: () => new Types.ObjectId().toString() },
  name:     { type: String, required: true },
  title:    { type: String, required: true },
  gender:   { type: String, default: "Mixed" },
  value:    { type: Number, required: true },
  type:     { type: String, default: "timed" },
  unit:     { type: String, default: "" },
  dateSet:  { type: String, default: "" }
}, { _id: false });

const SchoolSchema = new Schema({
  name:               { type: String, required: true },
  code:               { type: String, required: true, unique: true, index: true, uppercase: true },
  masterAdminEmail:   { type: String, required: true, lowercase: true, index: true },
  adminEmails:        { type: [String], default: [] },
  ageCategories:      { type: [String], default: ["5","6","7","8","9","10","11","12","13","14"] },
  ageBands:           { type: [String], default: ["5-6","7-8","9-10","11-12","13-14"] },
  ageCutoffDate:      { type: String, default: "12-31" },
  eventLibrary:       { type: [String], default: [] },
  eventDefaults:      { type: Schema.Types.Mixed, default: {} },
  eventRules:         { type: Schema.Types.Mixed, default: {} },
  eventStaff:         { type: Schema.Types.Mixed, default: {} },
  divisions:          { type: [DivisionSchema], default: [] },
  houses:             { type: [String], default: [] },
  tieMethod:          { type: String, enum: ["average", "higher"], default: "average" },
  scoring:            { type: { placement: Boolean, standard: Boolean }, default: () => ({ placement: true, standard: false }) },
  records:            { type: [RecordSubSchema], default: [] },
  standards:          { type: [StandardSubSchema], default: [] },
  personalBests:      { type: [PBSubSchema], default: [] },
  archives:           { type: [ArchiveSubSchema], default: [] }
}, opts);

/* ---------------- Event ---------------- */
const CompetitorSchema = new Schema({
  id:         { type: String, default: () => new Types.ObjectId().toString() },
  name:       { type: String, required: true },
  attempts:   { type: [Schema.Types.Mixed], default: [] }, // numbers or null
  grade:      { type: String, default: "" },
  actualAge:  { type: String, default: "" },
  dob:        { type: String, default: "" },
  heat:       { type: String, default: "" },
  house:      { type: String, default: "" },
  members:    { type: String, default: "" },
  bib:        { type: String, default: "" },
  dq:         { type: Boolean, default: false },
  dqReason:   { type: String, default: "" },
  walkup:     { type: Boolean, default: false },
  walkupBy:   { type: String, default: "" },
  walkupAt:   { type: Number,  default: null }
}, { _id: false });

const EventSchema = new Schema({
  schoolId:    { type: Schema.Types.ObjectId, ref: "FieldDaySchool", required: true, index: true },
  leaderName:  { type: String, default: "" },
  title:       { type: String, required: true, index: true },
  age:         { type: String, required: true },
  gender:      { type: String, required: true },
  type:        { type: String, enum: ["timed", "distance", "weight"], default: "timed" },
  attempts:    { type: Number, default: 1 },
  unit:        { type: String, default: "" },
  notes:       { type: String, default: "" },
  scoreBy:     { type: String, enum: ["event", "ageBand"], default: "event" },
  format:      { type: String, enum: ["individual", "team"], default: "individual" },
  wind:        { type: Number, default: null },        // m/s, > 2.0 flags wind-aided records
  competitors: { type: [CompetitorSchema], default: [] },
  status:      { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
  completedAt: Number,
  announcedAt: Number,
  announceQueuePosition: { type: Number, default: null }
}, opts);

EventSchema.index({ schoolId: 1, status: 1 });
EventSchema.index({ schoolId: 1, title: 1, age: 1, gender: 1 });

/* ---------------- Auth-state TTL collections ---------------- */
// Passkey: emailed to the admin when they request sign-in. 15-min TTL.
const PasskeySchema = new Schema({
  email:        { type: String, required: true, lowercase: true, index: true },
  passkeyHash:  { type: String, required: true },
  expiresAt:    { type: Date, required: true, index: { expires: 0 } }
}, opts);

// Session: bearer token for an authenticated admin or leader. 14-day TTL by default.
const SessionSchema = new Schema({
  token:        { type: String, required: true, unique: true, index: true },
  role:         { type: String, enum: ["admin", "leader"], required: true },
  email:        { type: String, default: "", lowercase: true },
  schoolId:     { type: Schema.Types.ObjectId, ref: "FieldDaySchool", default: null },
  leaderName:   { type: String, default: "" },
  expiresAt:    { type: Date, required: true, index: { expires: 0 } }
}, opts);

// Pending school-code change confirmation. 30-min TTL.
const CodeChangeSchema = new Schema({
  schoolId:         { type: Schema.Types.ObjectId, ref: "FieldDaySchool", required: true, unique: true },
  confirmationHash: { type: String, required: true },
  expiresAt:        { type: Date, required: true, index: { expires: 0 } }
}, opts);

/* ---------------- Backups (full-school point-in-time snapshot) ---------------- */
const BackupSchema = new Schema({
  schoolId:  { type: Schema.Types.ObjectId, ref: "FieldDaySchool", required: true, index: true },
  label:     { type: String, default: "auto" },     // "auto" | "manual" | "pre-import" etc.
  takenAt:   { type: Date,   default: Date.now },
  snapshot:  { type: Schema.Types.Mixed, required: true } // { school, events }
}, opts);
BackupSchema.index({ schoolId: 1, takenAt: -1 });

/* ---------------- Exports ---------------- */
module.exports = {
  School:            mongoose.model("FieldDaySchool",         SchoolSchema,    "fieldday_schools"),
  Event:             mongoose.model("FieldDayEvent",          EventSchema,     "fieldday_events"),
  Passkey:           mongoose.model("FieldDayPasskey",        PasskeySchema,   "fieldday_passkeys"),
  Session:           mongoose.model("FieldDaySession",        SessionSchema,   "fieldday_sessions"),
  CodeChange:        mongoose.model("FieldDayCodeChange",     CodeChangeSchema,"fieldday_code_changes"),
  Backup:            mongoose.model("FieldDayBackup",         BackupSchema,    "fieldday_backups")
};
