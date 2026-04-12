// backend/controllers/generateUntilValid.js
import { normalizeTaskByType } from "../validators/taskValidators.js";
import { assertPlayable } from "../validators/assertPlayable.js";
import { assertValidAiTask } from "./sharedTasksetController.js";

/*
CANONICAL GENERATION LOOP
-------------------------
This is the ONLY place where retries happen.

If ANY step fails, we THROW and retry.
*/
export async function generateUntilValid({
  taskType,
  regenerate,
  maxAttempts = 4,
  telemetry,
  context = {},
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await regenerate({ previousError: lastError, attempt });

      const normalized = normalizeTaskByType(taskType, {
        ...raw,
        taskType,
      });

      // GUARDRAIL: Check for quality issues flagged during normalization
      if (normalized._validationError) {
        const errMsg = normalized._validationError;
        delete normalized._validationError;
        throw new Error(`[Quality Guardrail] ${errMsg}`);
      }
      if (normalized._validationWarning) {
        console.warn(`[Quality Guardrail] ${taskType}: ${normalized._validationWarning}`);
        delete normalized._validationWarning;
      }

      // HARD REQUIREMENTS
      assertValidAiTask(taskType, normalized);
      assertPlayable(normalized, taskType);

      // ✅ success
      telemetry?.recordSuccess(taskType, attempt);
      return normalized;

    } catch (err) {
      lastError = err;
      telemetry?.recordFailure(taskType, attempt, err);
    }
  }

  throw lastError || new Error(`Failed to generate valid ${taskType}`);
}
