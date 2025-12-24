import mongoose from "mongoose";

// backend/models/DemoTaskset.js
// Stores a single persisted demo taskset so /demo loads instantly after first generation.

const DemoTasksetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "default"
    taskset: { type: Object, required: true },
    signature: { type: String, default: "" }, // helps auto-regen when schema/inputs change
  },
  { timestamps: true }
);

export default mongoose.model("DemoTaskset", DemoTasksetSchema);
