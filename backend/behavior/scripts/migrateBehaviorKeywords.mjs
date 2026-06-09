import "dotenv/config";
import mongoose from "mongoose";
import Behavior from "../models/Behavior.js";
import BehaviorSchool from "../models/BehaviorSchool.js";
import { SEED_BEHAVIORS } from "../lib/seedBehaviors.js";

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
const norm = (s) => String(s || "").toLowerCase().trim();
const seedByName = Object.fromEntries(SEED_BEHAVIORS.map((b) => [norm(b.name), b]));

for (const school of await BehaviorSchool.find().lean()) {
  // Backfill keywords on behaviours that lack one.
  let kw = 0;
  for (const b of await Behavior.find({ schoolId: school._id })) {
    if (b.keyword) continue;
    const seed = seedByName[norm(b.name)];
    b.keyword = seed?.keyword || norm(b.name).split(/[\s/]+/)[0];
    await b.save();
    kw++;
  }
  // Ensure an Interaction behaviour exists.
  const hasInteraction = await Behavior.findOne({ schoolId: school._id, triggerMode: "INTERACTION" });
  let added = 0;
  if (!hasInteraction) {
    const s = SEED_BEHAVIORS.find((b) => b.triggerMode === "INTERACTION");
    await Behavior.create({
      schoolId: school._id, name: s.name, keyword: s.keyword, description: s.description || "",
      triggerMode: "INTERACTION", consequenceText: "", followUpType: "none", scope: "standard", ownerTeacherId: null, sortOrder: -1,
    });
    added = 1;
  }
  console.log(`${school.name}: backfilled ${kw} keyword(s), added Interaction: ${added}`);
}
await mongoose.disconnect();
