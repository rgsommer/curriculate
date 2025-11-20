// services/tasksetAnalyticsService.js
import TaskSet from "../models/TaskSet.js";

export async function updateTasksetAnalytics(tasksetId, metrics) {
  const ts = await TaskSet.findById(tasksetId);
  if (!ts) return;

  const {
    sessionPlayers = 0,
    sessionEngagementScore = 0,
    sessionCompletionRate = 0,
    sessionAvgScorePercent = 0
  } = metrics;

  ts.totalPlays += 1;
  ts.totalPlayers += sessionPlayers;
  ts.lastPlayedAt = new Date();

  if (ts.avgEngagementScore == null) {
    ts.avgEngagementScore = sessionEngagementScore;
    ts.completionRate = sessionCompletionRate;
    ts.avgScorePercent = sessionAvgScorePercent;
  } else {
    const n = ts.totalPlays;
    ts.avgEngagementScore =
      (ts.avgEngagementScore * (n - 1) + sessionEngagementScore) / n;
    ts.completionRate =
      (ts.completionRate * (n - 1) + sessionCompletionRate) / n;
    ts.avgScorePercent =
      (ts.avgScorePercent * (n - 1) + sessionAvgScorePercent) / n;
  }

  await ts.save();
}
