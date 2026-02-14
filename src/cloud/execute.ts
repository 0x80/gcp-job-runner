import { consola } from "consola";
import type { CloudConfig } from "../config";
import { pollExecution } from "./execution-poller";
import { gcloudJson } from "./gcloud";
import { LogStreamer } from "./log-streamer";
import { parseExecution } from "./types";

interface ExecuteOptions {
  /** Cloud configuration from the runner config */
  cloud: CloudConfig;
  /** GCP project ID */
  project: string;
  /** Job arguments to pass via JOB_ARGV env var */
  jobArgv: string[];
  /** If true, don't wait for the job to complete */
  async?: boolean;
}

const DEFAULT_REGION = "us-central1";

/** Delay in ms to wait for log drain after execution completes */
const LOG_DRAIN_DELAY = 3000;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "unknown";
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Execute a Cloud Run Job.
 *
 * Passes job arguments as a JSON-encoded string array in the `JOB_ARGV`
 * environment variable. Uses `^||^` as the key=value pair delimiter to
 * avoid conflicts with JSON commas.
 *
 * For non-async execution, streams Cloud Logging entries to the terminal
 * in real-time while polling for execution completion.
 */
export async function execute(options: ExecuteOptions): Promise<void> {
  const { cloud, project, jobArgv } = options;
  const region = cloud.region ?? DEFAULT_REGION;

  const jobArgvJson = JSON.stringify(jobArgv);

  const jobScript = jobArgv[0] ?? "unknown";

  consola.start(
    `Executing Cloud Run Job: ${cloud.name} → ${jobScript}${options.async ? " (async)" : ""}`,
  );

  const executeStart = performance.now();

  const args = [
    "run",
    "jobs",
    "execute",
    cloud.name,
    "--project",
    project,
    "--region",
    region,
    `--update-env-vars=^||^JOB_ARGV=${jobArgvJson}`,
    "--async",
  ];

  const response = gcloudJson(args);

  const execution = parseExecution(response, {
    project,
    region,
    jobName: cloud.name,
  });

  if (!execution) {
    consola.error("Failed to start Cloud Run Job execution");
    consola.error("gcloud response:", JSON.stringify(response, null, 2));
    process.exit(1);
  }

  const executionName = execution.name.split("/").pop()!;

  if (options.async) {
    consola.success(`Cloud Run Job started: ${cloud.name}`);
    consola.info(`Execution: ${executionName}`);
    if (execution.logUri) {
      consola.info(`Logs: ${execution.logUri}`);
    }
    return;
  }

  consola.info(`Execution: ${executionName}`);
  if (execution.logUri) {
    consola.info(`Logs: ${execution.logUri}`);
  }

  /** Start log streaming */
  const streamer = new LogStreamer({
    projectId: project,
    jobName: cloud.name,
    executionName,
  });

  streamer.start();

  /** Handle SIGINT: stop streaming, inform user, exit */
  const handleSignal = () => {
    consola.log("");
    consola.info("Stopping log stream...");
    void streamer.stop().then(() => {
      consola.info("Execution continues in the cloud.");
      if (execution.logUri) {
        consola.info(`Logs: ${execution.logUri}`);
      }
      process.exit(130);
    });
  };

  process.on("SIGINT", handleSignal);

  try {
    /** Poll for execution completion */
    const result = await pollExecution({
      executionName,
      project,
      region,
      onStatusChange: (status) => consola.info(status),
    });

    /** Capture total time before log drain delay */
    const totalMs = performance.now() - executeStart;

    /** Wait for remaining logs to be ingested */
    await new Promise((resolve) => setTimeout(resolve, LOG_DRAIN_DELAY));

    await streamer.stop();
    const timingParts: string[] = [];

    if (result.startedAt !== undefined) {
      timingParts.push(
        `startup ${formatDuration(result.startedAt - executeStart)}`,
      );
    }

    const { startTime, completionTime } = result.execution;
    if (startTime && completionTime) {
      const jobMs =
        new Date(completionTime).getTime() - new Date(startTime).getTime();
      timingParts.push(`job ${formatDuration(jobMs)}`);
    }

    timingParts.push(`total ${formatDuration(totalMs)}`);
    consola.info(`Timing: ${timingParts.join(", ")}`);

    if (result.succeeded) {
      consola.success(`Cloud Run Job completed: ${cloud.name}`);
      process.exit(0);
    } else {
      consola.error(`Cloud Run Job failed: ${cloud.name}`);

      const failedCondition = result.execution.conditions?.find(
        (c) => c.type === "Completed" && c.message,
      );
      if (failedCondition?.message) {
        consola.error(failedCondition.message);
      }

      process.exit(1);
    }
  } finally {
    process.removeListener("SIGINT", handleSignal);
  }
}
