import { consola } from "consola";
import { formatDuration } from "../format";
import { pollExecution } from "./execution-poller";
import { gcloudJson } from "./gcloud";
import { LogStreamer } from "./log-streamer";
import { parseExecution } from "./types";

interface ExecuteOptions {
  /** Cloud Run Job resource name (e.g., "admin-create-user") */
  jobResourceName: string;
  /** GCP region. Default: "us-central1" */
  region?: string;
  /** GCP project ID */
  project: string;
  /** Job arguments to pass via JOB_ARGV env var */
  jobArgv: string[];
  /** If true, don't wait for the job to complete */
  async?: boolean;
  /** Number of tasks to run in parallel. Overrides the job default for this execution. */
  tasks?: number;
}

const DEFAULT_REGION = "us-central1";

/** Delay in ms to wait for log drain after execution completes */
const LOG_DRAIN_DELAY = 3000;

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
  const { jobResourceName, project, jobArgv } = options;
  const region = options.region ?? DEFAULT_REGION;

  const jobArgvJson = JSON.stringify(jobArgv);

  const jobScript = jobArgv[0] ?? "unknown";

  const tasksSuffix = options.tasks
    ? ` (${options.tasks} ${options.tasks === 1 ? "task" : "tasks"})`
    : "";

  consola.start(
    `Executing Cloud Run Job: ${jobResourceName} → ${jobScript}${tasksSuffix}${options.async ? " (async)" : ""}`,
  );

  const executeStart = performance.now();

  const args = [
    "run",
    "jobs",
    "execute",
    jobResourceName,
    "--project",
    project,
    "--region",
    region,
    `--update-env-vars=^||^JOB_ARGV=${jobArgvJson}`,
    "--async",
  ];

  if (options.tasks) {
    args.push(`--tasks=${options.tasks}`);
  }

  const response = gcloudJson(args);

  const execution = parseExecution(response, {
    project,
    region,
    jobName: jobResourceName,
  });

  if (!execution) {
    consola.error("Failed to start Cloud Run Job execution");
    consola.error("gcloud response:", JSON.stringify(response, null, 2));
    process.exit(1);
  }

  const executionName = execution.name.split("/").pop()!;
  const jobPageUrl = `https://console.cloud.google.com/run/jobs/execution/${region}/${executionName}?project=${project}`;

  if (options.async) {
    consola.success(`Cloud Run Job started: ${jobResourceName}`);
    consola.info(`Execution: ${executionName}`);
    consola.info(`Job page: ${jobPageUrl}`);
    return;
  }

  consola.info(`Execution: ${executionName}`);
  consola.info(`Job page: ${jobPageUrl}`);

  /** Start log streaming */
  const streamer = new LogStreamer({
    projectId: project,
    jobName: jobResourceName,
    executionName,
  });

  streamer.start();

  /** Handle SIGINT: stop streaming, inform user, exit */
  const handleSignal = () => {
    consola.log("");
    consola.info("Stopping log stream...");
    void streamer.stop().then(() => {
      consola.info("Execution continues in the cloud.");
      consola.info(`Job page: ${jobPageUrl}`);
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
      consola.success(`Cloud Run Job completed: ${jobResourceName}`);
      process.exit(0);
    } else {
      consola.error(`Cloud Run Job failed: ${jobResourceName}`);

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
