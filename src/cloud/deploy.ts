import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { consola } from "consola";
import type { CloudConfig, RunnerEnvOptions } from "../config";
import { generateDockerfile } from "./dockerfile";
import {
  checkGcloudAvailable,
  isDockerInstalled,
  isDockerDaemonRunning,
  startDockerDaemon,
  waitForDockerDaemon,
  gcloudExecCapture,
  gcloudJson,
  shellExecCapture,
} from "./gcloud";
import { hashDirectory } from "./hash";

export interface DeployOptions {
  /** Cloud configuration from the runner config */
  cloud: CloudConfig;
  /** Environment configuration (project, env vars, secrets) */
  envConfig: RunnerEnvOptions;
  /** Working directory (service root where isolate.config.json lives) */
  serviceDirectory: string;
}

export interface DeployResult {
  /** Full image URI including tag */
  imageUri: string;
  /** Whether a new image was built */
  imageBuilt: boolean;
}

/**
 * Filter out noisy gcloud hints from captured output.
 * Removes "To execute this job" and "Updates are available" blocks.
 */
function filterGcloudOutput(output: string): string {
  return output
    .replace(/To execute this job.*?gcloud run jobs execute \S+\n?/gs, "")
    .replace(/Updates are available.*?\$ gcloud components update\n?/gs, "")
    .trim();
}

const DEFAULT_REGION = "us-central1";
const DEFAULT_ARTIFACT_REGISTRY = "cloud-run";
const DEFAULT_ISOLATE_PATH = "isolate";
const GENERATED_DOCKERFILE = "Dockerfile";
const REGISTRY = "docker.pkg.dev";

interface IsolateConfig {
  targetPackagePath?: string;
}

/**
 * Resolve the isolate output directory path.
 * Reads isolate.config.json if present, otherwise uses default "./isolate".
 */
function resolveIsolateDirectory(serviceDirectory: string): string {
  const configPath = path.join(serviceDirectory, "isolate.config.json");

  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, "utf-8");
      const config = JSON.parse(configContent) as IsolateConfig;
      if (config.targetPackagePath) {
        return path.join(serviceDirectory, config.targetPackagePath);
      }
    } catch {
      /** Ignore parse errors, use default */
    }
  }

  return path.join(serviceDirectory, DEFAULT_ISOLATE_PATH);
}

export interface PrepareResult {
  imageUri: string;
  imageBuilt: boolean;
  region: string;
  project: string;
}

/**
 * Shared preparation logic: isolate, hash, check image, build if needed.
 * Used by both deploy() and deployIfChanged().
 */
export async function prepareImage(
  options: DeployOptions,
): Promise<PrepareResult> {
  const { cloud, envConfig, serviceDirectory } = options;
  const region = cloud.region ?? DEFAULT_REGION;
  const artifactRegistry = cloud.artifactRegistry ?? DEFAULT_ARTIFACT_REGISTRY;
  const project = envConfig.project;
  let buildLocal = cloud.buildLocal !== false;

  checkGcloudAvailable();

  if (buildLocal) {
    if (!isDockerInstalled()) {
      consola.warn(
        "Docker is not installed, falling back to Cloud Build. " +
          "Install Docker for faster local builds: https://docs.docker.com/get-docker/",
      );
      buildLocal = false;
    } else if (!isDockerDaemonRunning()) {
      if (!process.stdin.isTTY) {
        /** Non-interactive environment (CI) — fall back silently */
        consola.warn(
          "Docker daemon is not running, falling back to Cloud Build.",
        );
        buildLocal = false;
      } else {
        const choice = await consola.prompt(
          "Docker is installed but the daemon is not running.",
          {
            type: "select",
            options: [
              {
                label: "Start Docker",
                value: "start",
                hint: "attempt to start the daemon",
              },
              {
                label: "Use Cloud Build",
                value: "cloud-build",
                hint: "build remotely instead",
              },
            ],
          },
        );

        if (typeof choice === "symbol") {
          process.exit(0);
        }

        if (choice === "start") {
          const started = startDockerDaemon();

          if (!started) {
            consola.warn(
              "Could not start Docker automatically, falling back to Cloud Build.",
            );
            buildLocal = false;
          } else {
            const ready = await waitForDockerDaemon();

            if (!ready) {
              consola.warn(
                "Docker daemon did not become ready in time, falling back to Cloud Build.",
              );
              buildLocal = false;
            }
          }
        } else {
          buildLocal = false;
        }
      }
    }
  }

  /** Step 1: Run isolate to bundle workspace dependencies */
  const isolateDirectory = resolveIsolateDirectory(serviceDirectory);

  consola.start("Isolating package...");

  try {
    const { isolate: runIsolate } = await import("isolate-package");

    const configPath = path.join(serviceDirectory, "isolate.config.json");
    const fileConfig = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))
      : {};

    await runIsolate({
      ...fileConfig,
      includeDevDependencies: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    consola.error(`Failed to isolate package: ${message}`);
    process.exit(1);
  }

  consola.success("Package isolated");

  /** Step 2: Hash the isolate directory */
  const tag = await hashDirectory(isolateDirectory);
  consola.info(`Content hash: ${tag}`);

  /** Step 3: Check if image already exists */
  const imageUri = `${region}-${REGISTRY}/${project}/${artifactRegistry}/${cloud.name}:${tag}`;

  const imageExists = checkImageExists(imageUri, project);
  let imageBuilt = false;

  if (imageExists) {
    consola.success(`Image already exists: ${cloud.name}:${tag}`);
  } else if (buildLocal) {
    /** Step 4a: Generate Dockerfile and build locally with Docker */
    consola.start("Building image locally with Docker...");

    const dockerfilePath = path.join(serviceDirectory, GENERATED_DOCKERFILE);
    writeFileSync(dockerfilePath, generateDockerfile());

    try {
      const buildResult = shellExecCapture(
        `docker build --platform linux/amd64 -t ${imageUri} .`,
        { cwd: serviceDirectory },
      );

      if (!buildResult.success) {
        consola.error("Docker build failed. Output:\n" + buildResult.output);
        process.exit(1);
      }

      consola.success(`Image built: ${cloud.name}:${tag}`);

      /** Configure Docker authentication for Artifact Registry */
      gcloudExecCapture([
        "auth",
        "configure-docker",
        `${region}-${REGISTRY}`,
        "--quiet",
      ]);

      consola.start("Pushing image to Artifact Registry...");

      const pushResult = shellExecCapture(`docker push ${imageUri}`);

      if (!pushResult.success) {
        consola.error("Docker push failed. Output:\n" + pushResult.output);
        process.exit(1);
      }

      consola.success(`Image pushed: ${cloud.name}:${tag}`);
      imageBuilt = true;
    } finally {
      /** Clean up generated Dockerfile */
      try {
        unlinkSync(dockerfilePath);
      } catch {
        /** Ignore cleanup errors */
      }
    }
  } else {
    /** Step 4b: Generate Dockerfile and build with Cloud Build */
    consola.start("Building image with Cloud Build...");

    const dockerfilePath = path.join(serviceDirectory, GENERATED_DOCKERFILE);
    writeFileSync(dockerfilePath, generateDockerfile());

    try {
      const buildResult = gcloudExecCapture(
        [
          "builds",
          "submit",
          "--project",
          project,
          "--region",
          region,
          `--tag=${imageUri}`,
          ".",
        ],
        { cwd: serviceDirectory },
      );

      /** Extract and show the Cloud Build logs URL if available */
      const logsUrlMatch = buildResult.output.match(
        /Logs are available at \[(.+?)]/,
      );
      if (logsUrlMatch) {
        consola.info(`Cloud Build logs: ${logsUrlMatch[1]}`);
      }

      if (!buildResult.success) {
        consola.error("Cloud Build failed. Output:\n" + buildResult.output);
        process.exit(1);
      }

      consola.success(`Image built: ${cloud.name}:${tag}`);
      imageBuilt = true;
    } finally {
      /** Clean up generated Dockerfile */
      try {
        unlinkSync(dockerfilePath);
      } catch {
        /** Ignore cleanup errors */
      }
    }
  }

  return { imageUri, imageBuilt, region, project };
}

/**
 * Build and push a Cloud Run Job image.
 *
 * This is image-only: it does not create or update Cloud Run Job resources.
 * Use createOrUpdateJob() separately to manage job resources.
 */
export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const { imageUri, imageBuilt } = await prepareImage(options);
  return { imageUri, imageBuilt };
}

/**
 * Build and push a Cloud Run Job image only if it has changed.
 *
 * This is image-only: it does not create or update Cloud Run Job resources.
 * Use createOrUpdateJob() separately to manage job resources.
 */
export async function deployIfChanged(
  options: DeployOptions,
): Promise<DeployResult> {
  const { imageUri, imageBuilt } = await prepareImage(options);

  if (!imageBuilt) {
    consola.info("No changes detected, skipping image build");
  }

  return { imageUri, imageBuilt };
}

export interface CreateOrUpdateJobOptions {
  cloud: CloudConfig;
  envConfig: RunnerEnvOptions;
  /** The Cloud Run Job resource name (e.g., "admin-create-user") */
  jobName: string;
  imageUri: string;
  region: string;
  project: string;
}

/**
 * Create or update a Cloud Run Job resource.
 * Returns true if the job was newly created, false if updated.
 */
export async function createOrUpdateJob(
  options: CreateOrUpdateJobOptions,
): Promise<boolean> {
  const { cloud, envConfig, jobName, imageUri, region, project } = options;
  const memory = cloud.resources?.memory ?? "512Mi";
  const cpu = cloud.resources?.cpu ?? "1";
  const timeout = cloud.resources?.timeout ?? 86400;

  /** Check if job already exists */
  const existingJob = gcloudJson(
    [
      "run",
      "jobs",
      "describe",
      jobName,
      "--project",
      project,
      "--region",
      region,
    ],
    { ignoreErrors: true },
  );

  /** Build environment variables */
  const envVars: Record<string, string> = {
    GOOGLE_CLOUD_PROJECT: project,
    ...envConfig.env,
  };

  const envVarsString = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  /** Build secret references */
  const secretNames = envConfig.secrets ?? [];
  const secretsString = secretNames
    .map((name) => `${name}=${name}:latest`)
    .join(",");

  if (existingJob) {
    consola.start("Updating Cloud Run Job...");

    const updateArgs = [
      "run",
      "jobs",
      "update",
      jobName,
      "--project",
      project,
      "--region",
      region,
      `--image=${imageUri}`,
      `--set-env-vars=${envVarsString}`,
      `--memory=${memory}`,
      `--cpu=${cpu}`,
      `--task-timeout=${timeout}s`,
      "--max-retries=0",
    ];

    /**
     * Always pass --parallelism on update so that removing it from config
     * resets the deployed value. Default 0 means no concurrency limit.
     */
    updateArgs.push(`--parallelism=${cloud.resources?.parallelism ?? 0}`);

    if (secretsString) {
      updateArgs.push(`--set-secrets=${secretsString}`);
    }

    if (cloud.serviceAccount) {
      updateArgs.push(`--service-account=${cloud.serviceAccount}`);
    }

    const result = gcloudExecCapture(updateArgs);

    if (!result.success) {
      consola.error("Failed to update Cloud Run Job");
      process.exit(1);
    }

    const filtered = filterGcloudOutput(result.stderr);
    if (filtered) {
      process.stderr.write(filtered + "\n");
    }

    consola.success(`Cloud Run Job updated: ${jobName}`);
    return false;
  }

  consola.start("Creating Cloud Run Job...");

  const createArgs = [
    "run",
    "jobs",
    "create",
    jobName,
    "--project",
    project,
    "--region",
    region,
    `--image=${imageUri}`,
    `--set-env-vars=${envVarsString}`,
    `--memory=${memory}`,
    `--cpu=${cpu}`,
    `--task-timeout=${timeout}s`,
    "--max-retries=0",
  ];

  if (cloud.resources?.parallelism !== undefined) {
    createArgs.push(`--parallelism=${cloud.resources.parallelism}`);
  }

  if (secretsString) {
    createArgs.push(`--set-secrets=${secretsString}`);
  }

  if (cloud.serviceAccount) {
    createArgs.push(`--service-account=${cloud.serviceAccount}`);
  }

  const result = gcloudExecCapture(createArgs);

  if (!result.success) {
    consola.error("Failed to create Cloud Run Job");
    process.exit(1);
  }

  const filtered = filterGcloudOutput(result.stderr);
  if (filtered) {
    process.stderr.write(filtered + "\n");
  }

  consola.success(`Cloud Run Job created: ${jobName}`);
  return true;
}

/**
 * Check if a Docker image exists in Artifact Registry.
 */
function checkImageExists(imageUri: string, project: string): boolean {
  const result = gcloudJson(
    [
      "artifacts",
      "docker",
      "images",
      "describe",
      imageUri,
      "--project",
      project,
    ],
    { ignoreErrors: true },
  );

  return result !== undefined;
}
