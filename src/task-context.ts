/** Context for the current task within a Cloud Run Job execution */
export interface TaskContext {
  /** Zero-based index of this task (from CLOUD_RUN_TASK_INDEX) */
  taskIndex: number;
  /** Total number of tasks in this execution (from CLOUD_RUN_TASK_COUNT) */
  taskCount: number;
}

/**
 * Read the current task context from Cloud Run Job environment variables.
 *
 * Returns `{ taskIndex: 0, taskCount: 1 }` when env vars are absent,
 * so handlers work identically in local and single-task cloud environments.
 */
export function getTaskContext(): TaskContext {
  const taskIndex = parseIntOrDefault(process.env.CLOUD_RUN_TASK_INDEX, 0);
  const taskCount = Math.max(
    1,
    parseIntOrDefault(process.env.CLOUD_RUN_TASK_COUNT, 1),
  );

  return { taskIndex, taskCount };
}

function parseIntOrDefault(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
