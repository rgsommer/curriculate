// shared/deviceModeFilter.js
//
// Pure filter over a taskset for the current device mode. Used by:
//   - teacher-app  LiveSession pre-launch (Phase 1b: pre-flight check
//                  before the socket launch call)
//   - backend      teacher:launchTaskset socket handler (Phase 1b:
//                  actual silent-substitution pass at launch time)
//
// The filter is the SINGLE source of "can this task play in this
// mode." No component should recompute compatibility with its own
// logic — extend deviceCapabilities.js or per-task deviceCompat
// metadata instead.

import {
  DEFAULT_DEVICE_COMPAT,
  reasonForIncompatibility,
  normalizeDeviceMode,
  DEVICE_MODES,
} from "./deviceCapabilities.js";

/**
 * Resolve deviceCompat metadata for a task. Looks up by type in the
 * caller-provided registry (usually TASK_TYPE_META from taskTypes.js).
 * Returns DEFAULT_DEVICE_COMPAT if no metadata exists — universal by
 * default, honest with unknown task types.
 */
export function resolveDeviceCompat(task, taskTypeMeta) {
  const type = (task && (task.type || task.taskType)) || null;
  if (!type) return DEFAULT_DEVICE_COMPAT;
  const meta = taskTypeMeta && taskTypeMeta[type];
  const dc = meta && meta.deviceCompat;
  if (!dc) return DEFAULT_DEVICE_COMPAT;
  return {
    ...DEFAULT_DEVICE_COMPAT,
    ...dc,
  };
}

/**
 * Partition a list of tasks into compatible and incompatible for the
 * given device mode.
 *
 * Returns:
 *   {
 *     compatible:   [tasks that can play as-is],
 *     incompatible: [{ task, reason, requiredCapabilities }, …],
 *   }
 *
 * IMPORTANT: this function does NOT mutate. It's a pure query. The
 * caller (backend launch handler) is responsible for what to DO with
 * the incompatible list — silently substitute (Phase 1b default),
 * skip, or (per user override) prompt the teacher.
 */
export function filterTasksForDeviceMode(tasks, deviceMode, taskTypeMeta) {
  const mode = normalizeDeviceMode(deviceMode);
  const compatible = [];
  const incompatible = [];

  for (const task of tasks || []) {
    const dc = resolveDeviceCompat(task, taskTypeMeta);
    const supported = dc.supportedDeviceModes || [];
    if (supported.includes(mode)) {
      compatible.push(task);
    } else {
      incompatible.push({
        task,
        reason: reasonForIncompatibility(task && task.type, dc, mode),
        requiredCapabilities: dc.requiredCapabilities || [],
      });
    }
  }

  return { compatible, incompatible };
}

/**
 * Quick yes/no answer for a single task. Used by UI badges + task
 * picker filters where we don't need the full partition.
 */
export function isTaskCompatibleWithMode(task, deviceMode, taskTypeMeta) {
  const mode = normalizeDeviceMode(deviceMode);
  const dc = resolveDeviceCompat(task, taskTypeMeta);
  return (dc.supportedDeviceModes || []).includes(mode);
}

/**
 * Return an array of modes each task type supports. Useful for the
 * activity picker in the taskset editor (Phase 3) — badges show the
 * device types that support the type.
 *
 * `typeMeta` is a single entry from TASK_TYPE_META (i.e. the value
 * associated with one task type key).
 */
export function supportedModesForTypeMeta(typeMeta) {
  const dc = (typeMeta && typeMeta.deviceCompat) || DEFAULT_DEVICE_COMPAT;
  return dc.supportedDeviceModes || DEFAULT_DEVICE_COMPAT.supportedDeviceModes;
}

/**
 * True if any task in the taskset needs substitution for this mode.
 * Cheap pre-flight check for the launch button (Phase 1b).
 */
export function tasksetNeedsAdaptation(tasks, deviceMode, taskTypeMeta) {
  const mode = normalizeDeviceMode(deviceMode);
  if (mode === DEVICE_MODES.TABLET_ONLY) return false; // fast path — tablets play everything
  for (const task of tasks || []) {
    if (!isTaskCompatibleWithMode(task, mode, taskTypeMeta)) return true;
  }
  return false;
}
