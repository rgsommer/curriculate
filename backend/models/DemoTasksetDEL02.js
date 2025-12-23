// backend/models/DemoTaskset.js

import mongoose from "mongoose";

const DemoTasksetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "default"
    taskset: { type: Object, required: true },
    signature: { type: String, default: "" }, // optional
  },
  { timestamps: true }
);

export default mongoose.model("DemoTaskset", DemoTasksetSchema);
