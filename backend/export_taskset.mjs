import mongoose from "mongoose";
import { writeFileSync } from "fs";

const MONGO_URI = "mongodb+srv://AtlasDB:NpGOIFdzwWLB8w4H@curriculate.7s8bdye.mongodb.net/?appName=curriculate";

await mongoose.connect(MONGO_URI);
console.log("Connected to MongoDB");

const TaskSet = mongoose.model("TaskSet", new mongoose.Schema({}, { strict: false }));

const ts = await TaskSet.findOne({
  $or: [
    { name: /history/i },
    { title: /history/i }
  ]
}).lean();

if (!ts) {
  console.log("Not found by name/title. All tasksets:");
  const all = await TaskSet.find({}).select("name title _id").lean();
  console.log(JSON.stringify(all, null, 2));
} else {
  console.log("Found:", ts.name || ts.title, "— ID:", ts._id);
  console.log("Task count:", ts.tasks?.length ?? "unknown");
  writeFileSync(new URL("./taskset_history.json", import.meta.url), JSON.stringify(ts, null, 2));
  console.log("Written to taskset_history.json (same folder as this script)");
}

await mongoose.disconnect();
