import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    points: { type: Number, default: 1 }
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);
