#!/usr/bin/env node

import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { consola } from "consola";
import type { ZodObject, ZodRawShape } from "zod";
import type { RunnerConfig } from "./config";
import {
  createOrUpdateJob,
  deployIfChanged,
  prepareImage,
} from "./cloud/deploy";
import { execute } from "./cloud/execute";
import { deriveJobResourceName } from "./cloud/job-name";
import { discoverJobs } from "./discover-jobs";
import { promptForArgs, selectJob } from "./interactive";
import { runJob } from "./run-job";
import { getSecrets } from "./secrets";
import type { JobFunction } from "./types";

const BIN_NAME = "job";
const CONFIG_FILE = "job-runner.config.ts";
const DEFAULT_BUILD_COMMAND = "turbo build";
const DEFAULT_JOBS_DIRECTORY = "dist/jobs";

const USAGE = `Usage: ${BIN_NAME} local run <env> <job-name> [options]
       ${BIN_NAME} cloud run <env> <job-name> [options]
       ${BIN_NAME} cloud deploy <env>
       ${BIN_NAME} --list

Cloud run options:
  --tasks <n>         Number of parallel tasks for this execution
  --parallelism <n>   Max concurrent tasks (sets job resource default)`;

/**
 * Extract a numeric flag value from args.
 * Supports both `--flag N` and `--flag=N` syntax.
 * Returns undefined if the flag is not present.
 */
function extractNumberFlag(
  args: string[],
  flagName: string,
): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === flagName && i + 1 < args.length) {
      return Number(args[i + 1]);
    }

    if (arg.startsWith(`${flagName}=`)) {
      return Number(arg.slice(flagName.length + 1));
    }
  }

  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  /** Extract flags from anywhere in args */
  const noBuild = args.includes("--no-build");
  const isInteractive = args.includes("--interactive") || args.includes("-i");
  const isAsync = args.includes("--async");
  const tasks = extractNumberFlag(args, "--tasks");
  const parallelism = extractNumberFlag(args, "--parallelism");

  const configPath = path.resolve(process.cwd(), CONFIG_FILE);

  /** Load config directly (config should only depend on gcp-job-runner) */
  let config: RunnerConfig;
  try {
    const module = (await import(configPath)) as { default: RunnerConfig };
    config = module.default;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    consola.error(
      `Failed to load runner config from ${configPath}\n${message}`,
    );
    process.exit(1);
  }

  /** Resolve jobs directory with default */
  const jobsDirectory =
    config.jobsDirectory ?? path.resolve(process.cwd(), DEFAULT_JOBS_DIRECTORY);

  const envNames = Object.keys(config.environments);

  /** Handle --list: discover and print all available jobs */
  if (args.includes("--list")) {
    if (!noBuild && config.buildCommand !== false) {
      const buildCommand = config.buildCommand ?? DEFAULT_BUILD_COMMAND;
      runBuild(buildCommand);
    }

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

  /** Parse positional arguments */
  const positionals = args.filter((arg) => !arg.startsWith("-"));

  const mode = positionals[0];
  if (mode !== "local" && mode !== "cloud") {
    consola.error(
      `Unknown or missing mode "${mode ?? ""}".\n\n` +
        `${USAGE}\n\n` +
        `Environments: ${envNames.join(", ")}`,
    );
    process.exit(1);
  }

  const action = positionals[1];
  if (mode === "cloud" && action !== "run" && action !== "deploy") {
    consola.error(
      `Unknown or missing action "${action ?? ""}" for cloud mode.\n\n` + USAGE,
    );
    process.exit(1);
  }
  if (mode === "local" && action !== "run") {
    consola.error(
      `Unknown or missing action "${action ?? ""}" for local mode.\n\n` + USAGE,
    );
    process.exit(1);
  }

  const envName = positionals[2];
  if (!envName) {
    consola.error(
      `No environment specified.\n\n` +
        `${USAGE}\n\n` +
        `Environments: ${envNames.join(", ")}`,
    );
    process.exit(1);
  }

  if (!envNames.includes(envName)) {
    consola.error(
      `Unknown environment "${envName}".\n\n` +
        `Available environments: ${envNames.join(", ")}`,
    );
    process.exit(1);
  }

  const envConfig = config.environments[envName]!;

  /**
   * Remaining positionals after env become the job name/path. For example
   * `job cloud run stag test/countdown` -> positionals[3] = "test/countdown".
   */
  const jobNameFromArgs = positionals[3];

  /**
   * Collect job flags: everything after `<env>` in the original args that
   * isn't a consumed positional or a known global flag.
   */
  const consumedPositionals = new Set(
    [mode, action, envName, jobNameFromArgs].filter(Boolean),
  );
  const globalFlags = new Set([
    "--no-build",
    "--interactive",
    "-i",
    "--async",
    "--list",
    "--tasks",
    "--parallelism",
  ]);

  const envIndex = args.indexOf(envName);
  const jobFlags = args.slice(envIndex + 1).filter((arg, index, arr) => {
    if (consumedPositionals.has(arg)) return false;
    if (globalFlags.has(arg)) return false;
    /** Filter out `--flag=value` forms of number flags */
    if (arg.startsWith("--tasks=") || arg.startsWith("--parallelism="))
      return false;
    /** Filter out values that follow --tasks or --parallelism */
    const previous = arr[index - 1];
    if (previous === "--tasks" || previous === "--parallelism") return false;
    return true;
  });

  /** Build unless skipped */
  if (!noBuild && config.buildCommand !== false) {
    const buildCommand = config.buildCommand ?? DEFAULT_BUILD_COMMAND;
    runBuild(buildCommand);
  }

  if (mode === "local") {
    await handleLocalRun({
      config,
      envName,
      envConfig,
      jobsDirectory,
      jobNameFromArgs,
      jobFlags,
      isInteractive,
    });
  } else if (action === "deploy") {
    await handleCloudDeploy({ config, envConfig });
  } else {
    await handleCloudRun({
      config,
      envConfig,
      jobsDirectory,
      jobNameFromArgs,
      jobFlags,
      isInteractive,
      isAsync,
      tasks,
      parallelism,
    });
  }
}

interface LocalRunOptions {
  config: RunnerConfig;
  envName: string;
  envConfig: RunnerConfig["environments"][string];
  jobsDirectory: string;
  jobNameFromArgs: string | undefined;
  jobFlags: string[];
  isInteractive: boolean;
}

async function handleLocalRun(options: LocalRunOptions): Promise<void> {
  const {
    config,
    envName,
    envConfig,
    jobsDirectory,
    jobNameFromArgs,
    jobFlags,
    isInteractive,
  } = options;

  /** Set environment variables for local execution */
  process.env.NODE_ENV ??= "development";
  process.env.GOOGLE_CLOUD_PROJECT = envConfig.project;
  process.env.USE_CONSOLE_LOG ??= "true";
  process.env.LOG_COLORIZE ??= "true";

  if (envConfig.env) {
    for (const [key, value] of Object.entries(envConfig.env)) {
      process.env[key] = value;
    }
  }

  if (envConfig.secrets && envConfig.secrets.length > 0) {
    const secrets = await getSecrets(envConfig.secrets);
    for (const [key, value] of Object.entries(secrets)) {
      process.env[key] = value;
    }
  }

  if (isInteractive) {
    const { jobArgv } = await resolveInteractiveJob(jobsDirectory);

    process.argv = [process.argv[0]!, process.argv[1]!, ...jobArgv];

    const commandPrefix = `${BIN_NAME} local run ${envName}`;

    await runJob({
      jobsDirectory,
      initialize: config.initialize,
      logger: config.logger,
      commandPrefix,
    });
    return;
  }

  if (!jobNameFromArgs) {
    consola.error(
      `No job name specified.\n\n` +
        `Usage: ${BIN_NAME} local run ${envName} <job-name> [options]\n` +
        `       ${BIN_NAME} local run ${envName} -i`,
    );
    process.exit(1);
  }

  /**
   * Rewrite process.argv so runJob sees the job name as the first positional
   * argument, followed by any job-specific flags.
   */
  process.argv = [
    process.argv[0]!,
    process.argv[1]!,
    jobNameFromArgs,
    ...jobFlags,
  ];

  const commandPrefix = `${BIN_NAME} local run ${envName}`;

  await runJob({
    jobsDirectory,
    initialize: config.initialize,
    logger: config.logger,
    commandPrefix,
  });
}

interface CloudDeployOptions {
  config: RunnerConfig;
  envConfig: RunnerConfig["environments"][string];
}

async function handleCloudDeploy(options: CloudDeployOptions): Promise<void> {
  const { config, envConfig } = options;
  const cloud = config.cloud;

  if (!cloud) {
    consola.error(
      "No cloud configuration found in runner config.\n" +
        "Add a `cloud` section to your job-runner.config.ts",
    );
    process.exit(1);
  }

  const serviceDirectory = process.cwd();

  const { imageUri } = await prepareImage({
    cloud,
    envConfig,
    serviceDirectory,
  });

  consola.info(`Image: ${imageUri}`);
  consola.success("Deploy complete");
}

interface CloudRunOptions {
  config: RunnerConfig;
  envConfig: RunnerConfig["environments"][string];
  jobsDirectory: string;
  jobNameFromArgs: string | undefined;
  jobFlags: string[];
  isInteractive: boolean;
  isAsync: boolean;
  tasks?: number;
  parallelism?: number;
}

async function handleCloudRun(options: CloudRunOptions): Promise<void> {
  const {
    config,
    envConfig,
    jobsDirectory,
    jobNameFromArgs,
    jobFlags,
    isInteractive,
    isAsync,
    tasks,
    parallelism,
  } = options;

  const cloud = config.cloud;

  if (!cloud) {
    consola.error(
      "No cloud configuration found in runner config.\n" +
        "Add a `cloud` section to your job-runner.config.ts",
    );
    process.exit(1);
  }

  /** Override parallelism from CLI flag */
  if (parallelism) {
    cloud.resources = { ...cloud.resources, parallelism };
  }

  const serviceDirectory = process.cwd();

  /** Determine job name and argv */
  let jobArgv: string[];

  if (isInteractive) {
    const result = await resolveInteractiveJob(jobsDirectory);
    jobArgv = result.jobArgv;
  } else {
    if (!jobNameFromArgs) {
      consola.error(
        `No job name specified.\n\n` +
          `Usage: ${BIN_NAME} cloud run <env> <job-name> [options]\n` +
          `       ${BIN_NAME} cloud run <env> -i`,
      );
      process.exit(1);
    }
    jobArgv = [jobNameFromArgs, ...jobFlags];
  }

  /** Build and push image if changed */
  const { imageUri } = await deployIfChanged({
    cloud,
    envConfig,
    serviceDirectory,
  });

  consola.info(`Image: ${imageUri}`);

  /** Derive per-script Cloud Run Job name */
  const jobScript = jobArgv[0]!;
  const jobResourceName = deriveJobResourceName(jobScript);
  const region = cloud.region ?? "us-central1";

  /** Ensure per-script Cloud Run Job exists with current image */
  await createOrUpdateJob({
    cloud,
    envConfig,
    jobName: jobResourceName,
    imageUri,
    region,
    project: envConfig.project,
  });

  /** Execute the per-script Cloud Run Job */
  await execute({
    jobResourceName,
    region,
    project: envConfig.project,
    jobArgv,
    async: isAsync,
    tasks,
  });
}

/**
 * Interactively select a job and prompt for arguments.
 * Returns the job name and the complete jobArgv array.
 */
async function resolveInteractiveJob(
  jobsDirectory: string,
): Promise<{ jobName: string; jobArgv: string[] }> {
  const jobName = await selectJob(jobsDirectory);

  consola.info(`Selected job: ${jobName}`);

  /**
   * Set console-friendly env vars before importing the module, since
   * importing may initialize a structured logger like pino.
   */
  process.env.USE_CONSOLE_LOG ??= "true";
  process.env.LOG_COLORIZE ??= "true";

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

  const jobArgv = [jobName];
  if (Object.keys(args).length > 0) {
    jobArgv.push("--args", JSON.stringify(args));
  }

  return { jobName, jobArgv };
}

/**
 * Run the build command to compile workspace dependencies.
 * Shows a spinner and hides output unless the build fails.
 */
function runBuild(command: string): void {
  consola.start("Building jobs source code...");

  try {
    execSync(command, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    consola.success("Build complete");
  } catch (error) {
    consola.fail("Build failed");

    /** Show the build output on failure */
    if (error && typeof error === "object" && "stdout" in error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (stdout) {
        consola.log(stdout);
      }
    }
    if (error && typeof error === "object" && "stderr" in error) {
      const stderr = (error as { stderr?: string }).stderr;
      if (stderr) {
        consola.log(stderr);
      }
    }

    process.exit(1);
  }
}

await main();
