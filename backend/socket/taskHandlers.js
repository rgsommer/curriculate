// backend/socket/taskHandlers.js
const Task = require("../models/Task");
const { validateSubmission, scoreSubmission } = require("../services/taskEngine");

// This expects you've already joined sockets to rooms like `session:<id>`
function registerTaskSocketHandlers(io) {
  io.on("connection", (socket) => {
    // Host launches a task
    socket.on("task:launch", async ({ sessionId, taskId }) => {
      const task = await Task.findById(taskId).lean();
      if (!task) return;

      io.to(`session:${sessionId}`).emit("task:launch", {
        taskId: task._id.toString(),
        type: task.type,
        prompt: task.prompt,
        config: task.config,
        timeLimitSec: task.timeLimitSec || null,
      });
    });

    // Student submits
    socket.on("task:submit", async ({ sessionId, taskId, teamId, submission }) => {
      try {
        const task = await Task.findById(taskId).lean();
        if (!task) throw new Error("Task not found");

        validateSubmission(task, submission);
        const scoring = scoreSubmission(task, submission);

        // TODO: save submission to DB (Submission model or embedded in Session)
        // Example:
        // await Submission.create({ sessionId, taskId, teamId, submission, scoring });

        // emit back to host + team
        io.to(`session:${sessionId}:host`).emit("task:submission", {
          taskId,
          teamId,
          submission,
          scoring,
        });

        socket.emit("task:submit:ack", { ok: true, scoring });
      } catch (err) {
        console.error("task:submit error", err);
        socket.emit("task:submit:ack", { ok: false, error: err.message });
      }
    });

    // Host ends task
    socket.on("task:end", ({ sessionId, taskId }) => {
      io.to(`session:${sessionId}`).emit("task:end", { taskId });
    });
  });
}

module.exports = { registerTaskSocketHandlers };
