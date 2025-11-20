// backend/controllers/tasksetController.js
import mongoose from "mongoose";
import TaskSet from "../models/TaskSet.js";

/**
 * GET /tasksets
 * Return all task sets owned by the current teacher (and optionally public ones).
 */
export async function getAllTaskSets(req, res) {
  try {
    const userId = req.user?._id;

    // If you ever want to include public sets by others, you can extend this query.
    const query = userId
      ? { ownerId: userId }
      : {}; // fallback, but normally req.user is always set because of authRequired

    const tasksets = await TaskSet.find(query)
      .sort({ createdAt: -1 })
      .lean();

    res.json(tasksets);
  } catch (err) {
    console.error("Error getting task sets", err);
    res.status(500).json({ error: "Failed to load task sets" });
  }
}

/**
 * GET /tasksets/:id
 * Return a single task set for this teacher.
 */
export async function getTaskSetById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid TaskSet id" });
    }

    const userId = req.user?._id;

    const taskset = await TaskSet.findOne({
      _id: id,
      ownerId: userId,
    });

    if (!taskset) {
      return res.status(404).json({ error: "TaskSet not found" });
    }

    res.json(taskset);
  } catch (err) {
    console.error("Error getting task set", err);
    res.status(500).json({ error: "Failed to load task set" });
  }
}

/**
 * POST /tasksets
 * Create a new task set.
 */
export async function createTaskSet(req, res) {
  try {
    const userId = req.user?._id;

    const {
      name,
      tasks = [],
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      learningGoal,
      isPublic,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "TaskSet name is required" });
    }

    const newTaskset = await TaskSet.create({
      name,
      ownerId: userId || null,
      tasks,
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      learningGoal,
      isPublic: !!isPublic,
    });

    res.status(201).json(newTaskset);
  } catch (err) {
    console.error("Error creating task set", err);
    res.status(500).json({ error: "Failed to create task set" });
  }
}

/**
 * PUT /tasksets/:id
 * Update an existing task set (only if it belongs to this teacher).
 */
export async function updateTaskSet(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid TaskSet id" });
    }

    const userId = req.user?._id;

    const update = { ...req.body };
    // Never allow ownerId to be changed from the request:
    delete update.ownerId;

    const updated = await TaskSet.findOneAndUpdate(
      { _id: id, ownerId: userId },
      { $set: update },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "TaskSet not found or not owned by you" });
    }

    res.json(updated);
  } catch (err) {
    console.error("Error updating task set", err);
    res.status(500).json({ error: "Failed to update task set" });
  }
}

/**
 * DELETE /tasksets/:id
 * Delete a task set (only if it belongs to this teacher).
 */
export async function deleteTaskSet(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid TaskSet id" });
    }

    const userId = req.user?._id;

    const deleted = await TaskSet.findOneAndDelete({
      _id: id,
      ownerId: userId,
    });

    if (!deleted) {
      return res.status(404).json({ error: "TaskSet not found or not owned by you" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting task set", err);
    res.status(500).json({ error: "Failed to delete task set" });
  }
}
