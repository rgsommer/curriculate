// backend/validators/assertPlayable.js
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

/*
HARD GATE:
If a task is not playable, this MUST throw.
Returning booleans is not sufficient.
*/
export function assertPlayable(task, context = "") {
  const play = assessTaskPlayability(task);
  if (!play.playable) {
    throw new Error(
      `Task not playable${context ? ` (${context})` : ""}: ${play.issues.join("; ")}`
    );
  }
}
