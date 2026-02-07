/*
backend/controllers/generationTelemetry.js
REGENERATION TELEMETRY
---------------------
Collects WHY regeneration happens.
No side effects. No logging required.
*/

export function createGenerationTelemetry() {
  const data = {};

  function ensure(type) {
    if (!data[type]) {
      data[type] = {
        attempts: 0,
        successes: 0,
        failures: [],
      };
    }
    return data[type];
  }

  return {
    recordFailure(taskType, attempt, error) {
      const entry = ensure(taskType);
      entry.attempts++;
      entry.failures.push({
        attempt,
        message: String(error?.message || error),
      });
    },

    recordSuccess(taskType, attempt) {
      const entry = ensure(taskType);
      entry.attempts++;
      entry.successes++;
      entry.lastSuccessAttempt = attempt;
    },

    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },
  };
}
