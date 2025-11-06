import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    points: { type: Number, default: 1 },
    // add fields from “the other day” here:
    subject: String,
    stationNumber: Number,
    isLinear: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);
