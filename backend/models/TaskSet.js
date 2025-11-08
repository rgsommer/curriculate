// models/TaskSet.js
import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema({
  taskId: String,
  title: String,
  prompt: { type: String, required: true },
  taskType: { type: String, required: true }, // mcq, true_false, sequence, physical, record_audio, image_prompt, open_text
  options: [String],           // for mcq, true_false, image choices, sequence candidates
  answer: mongoose.Schema.Types.Mixed, // string or array depending on type
  mediaUrl: String,
  timeLimitSeconds: Number,
  points: { type: Number, default: 10 },
});

const TaskSetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tasks: [TaskSchema],
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("TaskSet", TaskSetSchema);
