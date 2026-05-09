/**
 * Field Day — Mongoose models (ESM).
 *
 * Collection names prefixed `fieldday_*` so they don't collide with anything
 * Curriculate already has.
 */
import mongoose from "mongoose";

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
  wind:         { type: Number, default: null },
  windAided:    { type: Boolean, default: false },
  createdAt:    { type: Number, default: () => Date.now() }
}, { _id: false });

const ArchiveSubSchema = new Schema({
  id:            { type: String, default: () => new Types.ObjectId().toString() },
  label:         { type: String, required: true },
  archivedAt:    { type: Number, default: () => Date.now() },
  events:        { type: Array, default: [] },
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
  // unique already creates an index — don't also pass index:true (avoids the duplicate-index warning).
  code:               { type: String, required: true, unique: true, uppercase: true },
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
  attempts:   { type: [Schema.Types.Mixed], default: [] },
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
  title:       { type: String, required: true },
  age:         { type: String, required: true },
  gender:      { type: String, required: true },
  type:        { type: String, enum: ["timed", "distance", "weight"], default: "timed" },
  attempts:    { type: Number, default: 1 },
  unit:        { type: String, default: "" },
  notes:       { type: String, default: "" },
  scoreBy:     { type: String, enum: ["event", "ageBand"], default: "event" },
  format:      { type: String, enum: ["individual", "team"], default: "individual" },
  wind:        { type: Number, default: null },
  competitors: { type: [CompetitorSchema], default: [] },
  status:      { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
  completedAt: Number,
  announcedAt: Number,
  announceQueuePosition: { type: Number, default: null }
}, opts);

EventSchema.index({ schoolId: 1, status: 1 });
EventSchema.index({ schoolId: 1, title: 1, age: 1, gender: 1 });

/* ---------------- TTL collections ---------------- */
const PasskeySchema = new Schema({
  email:        { type: String, required: true, lowercase: true, index: true },
  passkeyHash:  { type: String, required: true },
  expiresAt:    { type: Date, required: true, index: { expires: 0 } }
}, opts);

const SessionSchema = new Schema({
  // unique already creates the index — don't double up.
  token:        { type: String, required: true, unique: true },
  role:         { type: String, enum: ["admin", "leader"], required: true },
  email:        { type: String, default: "", lowercase: true },
  schoolId:     { type: Schema.Types.ObjectId, ref: "FieldDaySchool", default: null },
  leaderName:   { type: String, default: "" },
  expiresAt:    { type: Date, required: true, index: { expires: 0 } }
}, opts);

const CodeChangeSchema = new Schema({
  // unique already creates the index.
  schoolId:         { type: Schema.Types.ObjectId, ref: "FieldDaySchool", required: true, unique: true },
  confirmationHash: { type: String, required: true },
  expiresAt:        { type: Date, required: true, index: { expires: 0 } }
}, opts);

/* ---------------- Backups ---------------- */
const BackupSchema = new Schema({
  schoolId:  { type: Schema.Types.ObjectId, ref: "FieldDaySchool", required: true },
  label:     { type: String, default: "auto" },
  takenAt:   { type: Date,   default: Date.now },
  snapshot:  { type: Schema.Types.Mixed, required: true }
}, opts);
BackupSchema.index({ schoolId: 1, takenAt: -1 });

/* ---------------- Exports ---------------- */
export const School     = mongoose.models.FieldDaySchool     || mongoose.model("FieldDaySchool",     SchoolSchema,     "fieldday_schools");
export const Event      = mongoose.models.FieldDayEvent      || mongoose.model("FieldDayEvent",      EventSchema,      "fieldday_events");
export const Passkey    = mongoose.models.FieldDayPasskey    || mongoose.model("FieldDayPasskey",    PasskeySchema,    "fieldday_passkeys");
export const Session    = mongoose.models.FieldDaySession    || mongoose.model("FieldDaySession",    SessionSchema,    "fieldday_sessions");
export const CodeChange = mongoose.models.FieldDayCodeChange || mongoose.model("FieldDayCodeChange", CodeChangeSchema, "fieldday_code_changes");
export const Backup     = mongoose.models.FieldDayBackup     || mongoose.model("FieldDayBackup",     BackupSchema,     "fieldday_backups");
