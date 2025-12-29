import "dotenv/config";
import mongoose from "mongoose";
import { runShareInviteFollowups } from "../jobs/sendShareInviteFollowups.js";

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGO_URI (or MONGODB_URI)");

  await mongoose.connect(uri);

  const teacherAppOrigin = process.env.TEACHER_APP_ORIGIN || "https://set.curriculate.net";

  const result = await runShareInviteFollowups({ teacherAppOrigin });
  console.log("Share follow-ups:", result);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
