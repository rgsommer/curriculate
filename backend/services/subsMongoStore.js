// backend/services/subsMongoStore.js
//
// MongoDB-backed implementation of the persistence contract the
// escalation engine (subsEngine.js) depends on. Keeping this behind an
// interface is what lets the engine be unit-tested against an in-memory
// store with no database (see tests/test-subs-engine.mjs).
//
// Contract the engine relies on:
//   getOpenRequests()                         → [request]
//   getRequest(id)                            → request | null
//   getOffersForRequest(requestId)            → [offer]
//   getOffer(id)                              → offer | null
//   getTeacher(id)                            → teacher | null
//   getRankedTeachers(schoolId, gradeId)      → [{ teacherId, rank, teacher }]  (active, rank asc)
//   getRequestContext(requestId)              → { request, school, gradeLevel, adminEmails }
//   createOffer(doc)                          → offer
//   updateOffer(id, patch)                    → void
//   updateRequest(id, patch)                  → void

import SubsRequest from "../models/SubsRequest.js";
import SubsOffer from "../models/SubsOffer.js";
import SubsRanking from "../models/SubsRanking.js";
import SubsTeacher from "../models/SubsTeacher.js";
import SubsSchool from "../models/SubsSchool.js";
import SubsGradeLevel from "../models/SubsGradeLevel.js";

export function createMongoStore() {
  return {
    async getOpenRequests() {
      return SubsRequest.find({ status: "open" }).lean();
    },
    async getRequest(id) {
      return SubsRequest.findById(id).lean();
    },
    async getOffersForRequest(requestId) {
      return SubsOffer.find({ requestId }).sort({ createdAt: 1 }).lean();
    },
    async getOffer(id) {
      return SubsOffer.findById(id).lean();
    },
    async getTeacher(id) {
      return SubsTeacher.findById(id).lean();
    },

    async getRankedTeachers(schoolId, gradeLevelId) {
      const ranking = await SubsRanking.findOne({ schoolId, gradeLevelId }).lean();
      if (!ranking || !ranking.entries?.length) return [];
      const sorted = [...ranking.entries].sort((a, b) => a.rank - b.rank);
      const teachers = await SubsTeacher.find({
        _id: { $in: sorted.map((e) => e.teacherId) },
      }).lean();
      const byId = new Map(teachers.map((t) => [String(t._id), t]));
      // Only active teachers are eligible; skipped ones don't block the
      // queue — the next ranked active teacher is contacted instead.
      return sorted
        .map((e) => ({ teacherId: e.teacherId, rank: e.rank, teacher: byId.get(String(e.teacherId)) }))
        .filter((e) => e.teacher && e.teacher.active !== false);
    },

    async getRequestContext(requestId) {
      const request = await SubsRequest.findById(requestId).lean();
      if (!request) return { request: null };
      const [school, gradeLevel] = await Promise.all([
        SubsSchool.findById(request.schoolId).lean(),
        SubsGradeLevel.findById(request.gradeLevelId).lean(),
      ]);
      // The "appropriate VP": grade-level override, else the school default.
      const vpEmail = gradeLevel?.vpEmail || school?.vpEmail || "";
      return {
        request,
        school,
        gradeLevel,
        adminEmails: school?.adminEmails || [],
        vpEmail,
        financeEmail: school?.financeEmail || "",
        absentTeacher: request.absentTeacher || null,
      };
    },

    async createOffer(doc) {
      const created = await SubsOffer.create(doc);
      return created.toObject();
    },
    async updateOffer(id, patch) {
      await SubsOffer.updateOne({ _id: id }, { $set: patch });
    },
    async updateRequest(id, patch) {
      await SubsRequest.updateOne({ _id: id }, { $set: patch });
    },
  };
}
