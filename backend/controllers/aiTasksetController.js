// backend/controllers/aiTasksetController.js
export async function generateTaskset(req, res) {
  try {
    // Temporary stub: just echo back a dummy taskset
    const { subject = "General", gradeLevel = "7" } = req.body || {};

    const dummy = {
      name: `Sample ${subject} Task Set (Grade ${gradeLevel})`,
      description: "This is a temporary stubbed taskset from the AI endpoint.",
      tasks: [
        {
          taskId: "t1",
          title: "Sample Question",
          prompt: "This is where your AI-generated prompt will appear.",
          taskType: "short-answer",
          points: 10,
        },
      ],
      displays: [],
    };

    return res.json({
      ok: true,
      taskset: dummy,
    });
  } catch (err) {
    console.error("Stub ai/tasksets error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to generate taskset (stub)",
    });
  }
}
