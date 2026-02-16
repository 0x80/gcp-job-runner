import path from "node:path";
import process from "node:process";
import { consola } from "consola";
import type { ZodObject, ZodRawShape } from "zod";
import { discoverJobs } from "./discover-jobs";
import { formatDuration } from "./format";
import { promptForArgs, selectJob } from "./interactive";
import type { JobFunction, RunJobOptions } from "./types";

/**
 * Entry point for job execution. Each service calls this from its own thin
 * `cli/run-jobs.ts` wrapper with a configured jobsDirectory.
 *
 * Parses argv to determine the job name, handles --list for discovery,
 * optionally runs initialization, then dynamically imports and executes
 * the target job.
 */
export async function runJob(options: RunJobOptions): Promise<void> {
  const { jobsDirectory, initialize, logger = console } = options;

  process.on("uncaughtException", (err) => {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.error(`Uncaught exception: ${message}`);
    process.exitCode = 1;
  });

  /** Find the job name from argv (first non-flag argument after the entry script) */
  const jobName = findJobName(process.argv);

  /** Handle --list: discover and print all available jobs */
  if (jobName === "--list" || process.argv.includes("--list")) {
    const jobs = await discoverJobs(jobsDirectory);
    if (jobs.length === 0) {
      consola.info("No jobs found.");
    } else {
      consola.info("Available jobs:");
      for (const job of jobs) {
        consola.log(`  ${job.name}`);
      }
    }
    return;
  }

  /** Handle --interactive: guide user through job selection and args */
  if (process.argv.includes("--interactive") || process.argv.includes("-i")) {
    await runInteractive(options);
    return;
  }

  if (!jobName) {
    const prefix = options.commandPrefix ?? "<command>";
    logger.error(
      "No job name provided.\n\n" +
        `Usage: ${prefix} <job-name> [options]\n` +
        `       ${prefix} --list\n`,
    );
    process.exit(1);
  }

  /** Build the module path (add .mjs extension for ESM resolution) */
  const parts = jobName.split("/");
  const fileName = parts.pop() ?? "";
  const subDirectories = parts;
  const fileLocation = path.join(jobsDirectory, ...subDirectories);
  const modulePath = path.resolve(fileLocation, `${fileName}.mjs`);

  /** Get argv after the job name (flags to pass to the job) */
  const jobArgvIndex = process.argv.indexOf(jobName);
  const argv = jobArgvIndex >= 0 ? process.argv.slice(jobArgvIndex + 1) : [];

  /** Check for --help before doing initialization (faster help output) */
  const isHelp = argv.includes("--help") || argv.includes("-h");

  if (!isHelp && initialize) {
    await initialize();
  }

  if (!isHelp) {
    logger.info(`Executing: ${jobName}`);
  }

  try {
    const moduleObject = (await import(modulePath)) as Record<string, unknown>;
    const fn = moduleObject.default;

    if (typeof fn !== "function") {
      logger.error(
        `Module ${modulePath} does not have a default export function`,
      );
      process.exit(1);
    }

    const start = performance.now();

    await (
      fn as (
        argv: string[],
        jobName: string,
        commandPrefix?: string,
      ) => Promise<void>
    )(argv, jobName, options.commandPrefix);

    consola.info(`Completed in ${formatDuration(performance.now() - start)}`);
    process.exit(0);
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    logger.error(message);
    process.exit(1);
  }
}

/**
 * Find the job name from argv.
 * Returns the first non-flag argument after the Node binary and entry script.
 */
function findJobName(argv: string[]): string | undefined {
  const argsAfterEntry = argv.slice(2);
  return argsAfterEntry.find((arg) => !arg.startsWith("-"));
}

/**
 * Run interactive mode: guide user through job selection and argument input.
 */
async function runInteractive(options: RunJobOptions): Promise<void> {
  const { jobsDirectory, initialize, logger = console } = options;

  /** Select job interactively */
  const jobName = await selectJob(jobsDirectory);

  consola.info(`Selected job: ${jobName}`);

  /** Load the job module to get its schema */
  const parts = jobName.split("/");
  const fileName = parts.pop() ?? "";
  const subDirectories = parts;
  const fileLocation = path.join(jobsDirectory, ...subDirectories);
  const modulePath = path.resolve(fileLocation, `${fileName}.mjs`);

  let schema: ZodObject<ZodRawShape> | undefined;
  try {
    const moduleObject = (await import(modulePath)) as Record<string, unknown>;
    const fn = moduleObject.default as JobFunction | undefined;
    schema = fn?.__metadata?.schema;
  } catch {
    /** Module might not exist yet or have errors - proceed without schema */
  }

  /** Prompt for arguments if schema exists */
  let args: Record<string, unknown> = {};
  if (schema && Object.keys(schema.shape).length > 0) {
    consola.info("Enter arguments for the job:");
    args = await promptForArgs(schema);
  }

  /** Run initialization */
  if (initialize) {
    await initialize();
  }

  logger.info(`Executing: ${jobName}`);

  try {
    const moduleObject = (await import(modulePath)) as Record<string, unknown>;
    const fn = moduleObject.default;

    if (typeof fn !== "function") {
      logger.error(
        `Module ${modulePath} does not have a default export function`,
      );
      process.exit(1);
    }

    /** Build argv with --args JSON */
    const argv =
      Object.keys(args).length > 0 ? ["--args", JSON.stringify(args)] : [];

    const start = performance.now();

    await (
      fn as (
        argv: string[],
        jobName: string,
        commandPrefix?: string,
      ) => Promise<void>
    )(argv, jobName, options.commandPrefix);

    consola.info(`Completed in ${formatDuration(performance.now() - start)}`);
    process.exit(0);
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    logger.error(message);
    process.exit(1);
  }
}
