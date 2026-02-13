import { consola } from "consola";
import { gcloudJson } from "./gcloud";
import type { GcloudExecution } from "./types";
import { parseExecution } from "./types";

interface PollOptions {
  /** Execution name (short name, e.g., "my-job-abc123") */
  executionName: string;
  /** GCP project ID */
  project: string;
  /** GCP region */
  region: string;
  /** Polling interval in milliseconds. Default: 5000 */
  interval?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Called when a status transition is detected */
  onStatusChange?: (status: string) => void;
}

interface PollResult {
  succeeded: boolean;
  execution: GcloudExecution;
  /** Local timestamp (performance.now()) when the container started running */
  startedAt?: number;
}

const DEFAULT_POLL_INTERVAL = 5000;

/**
 * Poll a Cloud Run Job execution until it completes.
 * Returns whether the execution succeeded.
 */
export function pollExecution(options: PollOptions): Promise<PollResult> {
  const { executionName, project, region, signal, onStatusChange } = options;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;

  let consecutiveErrors = 0;
  let hasStarted = false;
  let hasReportedStarting = false;
  let startedAt: number | undefined;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) {
        reject(new DOMException("Polling aborted", "AbortError"));
        return;
      }

      try {
        const response = gcloudJson([
          "run",
          "jobs",
          "executions",
          "describe",
          executionName,
          "--project",
          project,
          "--region",
          region,
        ]);

        consecutiveErrors = 0;

        const execution = parseExecution(response);

        if (!execution) {
          /** Retry on empty response */
          scheduleNext();
          return;
        }

        if (!hasStarted) {
          if (execution.startTime) {
            hasStarted = true;
            startedAt = performance.now();
            onStatusChange?.("Running");
          } else if (!hasReportedStarting) {
            hasReportedStarting = true;
            onStatusChange(
              "Container starting... (this can take a few minutes)",
            );
          }
        }

        if (execution.completionTime) {
          const succeeded = (execution.succeededCount ?? 0) > 0;
          resolve({ succeeded, execution, startedAt });
          return;
        }

        const completedCondition = execution.conditions?.find(
          (c) => c.type === "Completed",
        );

        if (completedCondition?.state === "CONDITION_SUCCEEDED") {
          resolve({ succeeded: true, execution, startedAt });
          return;
        }

        if (completedCondition?.state === "CONDITION_FAILED") {
          resolve({ succeeded: false, execution, startedAt });
          return;
        }

        scheduleNext();
      } catch (error) {
        consecutiveErrors++;

        if (consecutiveErrors <= 3) {
          consola.warn(
            `Failed to check execution status (attempt ${consecutiveErrors})`,
            error instanceof Error ? error.message : String(error),
          );
        }

        if (consecutiveErrors >= 10) {
          reject(
            new Error(
              `Polling failed after ${consecutiveErrors} consecutive errors`,
            ),
          );
          return;
        }

        scheduleNext();
      }
    };

    const scheduleNext = () => {
      setTimeout(check, interval);
    };

    /** Start first check after a short delay to give the execution time to register */
    setTimeout(check, interval);
  });
}
