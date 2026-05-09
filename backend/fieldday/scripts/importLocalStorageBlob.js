#!/usr/bin/env node
/**
 * Import a localStorage backup (the JSON file produced by the "Backup" button
 * in the admin tab) into MongoDB.
 *
 * Usage:
 *   node backend/fieldday/scripts/importLocalStorageBlob.js \
 *     --file ./MAPLE26-2026-05-08.json \
 *     --admin-email admin@school.org \
 *     [--mongo mongodb://localhost:27017/curriculate]
 *
 * The blob shape (from the client) is:
 *   { school: {...}, events: [...], announceQueue: [...] }
 *
 * If the school's code already exists in MongoDB, the script aborts unless
 * --force is given (in which case it MERGES events into the existing school).
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { School, Event } = require("../models");

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i+1] : fallback;
}
const flag = (name) => args.includes("--" + name);

const file       = arg("file");
const adminEmail = (arg("admin-email") || "").toLowerCase();
const mongoUrl   = arg("mongo", process.env.MONGO_URL || "mongodb://localhost:27017/curriculate");
const force      = flag("force");

if (!file || !adminEmail) {
  console.error("Usage: importLocalStorageBlob.js --file <path> --admin-email <email> [--mongo <url>] [--force]");
  process.exit(1);
}

(async function main() {
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  const blob = JSON.parse(raw);
  if (!blob.school) { console.error("File doesn't look like a Field Day backup."); process.exit(2); }

  await mongoose.connect(mongoUrl);
  console.log("Connected to", mongoUrl);

  const sIn = blob.school;
  let school = await School.findOne({ code: sIn.code });
  if (school && !force) {
    console.error(`School with code ${sIn.code} already exists. Use --force to merge.`);
    process.exit(3);
  }
  if (!school) {
    school = await School.create({
      name: sIn.name,
      code: sIn.code,
      masterAdminEmail: adminEmail,
      adminEmails: [adminEmail],
      ageCategories:  sIn.ageCategories  || [],
      ageBands:       sIn.ageBands       || [],
      ageCutoffDate:  sIn.ageCutoffDate  || "12-31",
      eventLibrary:   sIn.eventLibrary   || [],
      eventDefaults:  sIn.eventDefaults  || {},
      eventRules:     sIn.eventRules     || {},
      eventStaff:     sIn.eventStaff     || {},
      divisions:      sIn.divisions      || [],
      houses:         sIn.houses         || [],
      tieMethod:      sIn.tieMethod      || "average",
      scoring:        sIn.scoring        || { placement: true, standard: false },
      records:        sIn.records        || [],
      standards:      sIn.standards      || [],
      personalBests:  sIn.personalBests  || [],
      archives:       sIn.archives       || []
    });
    console.log("Created school:", school._id.toString());
  } else {
    Object.assign(school, {
      name: sIn.name,
      ageCategories: sIn.ageCategories || school.ageCategories,
      ageBands:      sIn.ageBands      || school.ageBands,
      ageCutoffDate: sIn.ageCutoffDate || school.ageCutoffDate,
      eventLibrary:  sIn.eventLibrary  || school.eventLibrary,
      eventDefaults: sIn.eventDefaults || school.eventDefaults,
      eventRules:    sIn.eventRules    || school.eventRules,
      eventStaff:    sIn.eventStaff    || school.eventStaff,
      divisions:     sIn.divisions     || school.divisions,
      houses:        sIn.houses        || school.houses,
      tieMethod:     sIn.tieMethod     || school.tieMethod,
      scoring:       sIn.scoring       || school.scoring,
      records:       sIn.records       || school.records,
      standards:     sIn.standards     || school.standards,
      personalBests: sIn.personalBests || school.personalBests,
      archives:      sIn.archives      || school.archives
    });
    if (!school.adminEmails.includes(adminEmail)) school.adminEmails.push(adminEmail);
    await school.save();
    console.log("Updated school:", school._id.toString());
  }

  const eventsIn = blob.events || [];
  let inserted = 0;
  for (const e of eventsIn) {
    const doc = { ...e };
    delete doc._id;
    delete doc.id;
    doc.schoolId = school._id;
    await Event.create(doc);
    inserted++;
  }
  console.log(`Imported ${inserted} event(s)`);

  await mongoose.disconnect();
  console.log("Done.");
})().catch(err => { console.error(err); process.exit(99); });
