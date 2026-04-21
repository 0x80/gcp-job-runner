import path from "node:path";

/** Environment configuration for a specific deployment target */
export interface RunnerEnvOptions {
  /** GCP project ID — sets GOOGLE_CLOUD_PROJECT automatically */
  project: string;
  /**
   * Path(s) to .env files to load, resolved relative to the service directory.
   * Variables from these files have lower precedence than explicit `env` values.
   * When multiple files are specified, earlier files take precedence over later ones.
   */
  envFile?: string | string[];
  /** Additional environment variables to set before the job runs */
  env?: Record<string, string>;
  /** Secret names to load from GCP Secret Manager */
  secrets?: string[];
  /**
   * Destination the job reads from via `getInputFilesPath()`. Either a
   * local path (resolved relative to the service directory) or a
   * `gs://bucket[/prefix]` URI.
   *
   * When unset, `getInputFilesPath()` throws (unless `localInputFilesPath`
   * is set and the run is local). Cloud deployments require a `gs://` URI.
   *
   * May point at the same location as `outputFilesPath` when a single
   * directory serves both roles.
   *
   * @see RunnerConfig.localInputFilesPath
   */
  inputFilesPath?: string;
  /**
   * Destination the job writes to via `getFileWriter()` and reads back
   * via `getOutputFilesPath()`. Either a local path (resolved relative
   * to the service directory) or a `gs://bucket[/prefix]` URI.
   *
   * When unset, `getFileWriter()` and `getOutputFilesPath()` throw
   * (unless `localOutputFilesPath` is set and the run is local). Cloud
   * deployments require a `gs://` URI.
   *
   * @see RunnerConfig.localOutputFilesPath
   */
  outputFilesPath?: string;
}

/** Container resource limits for a Cloud Run Job */
export interface CloudResources {
  /** Memory limit (e.g., "512Mi", "1Gi"). Default: "512Mi" */
  memory?: string;
  /** CPU limit (e.g., "1", "2"). Default: "1" */
  cpu?: string;
  /** Job timeout in seconds. Default: 86400 (24 hours) */
  timeout?: number;
  /** Maximum number of tasks that can run in parallel. Default: unset (no limit) */
  parallelism?: number;
}

/** Direct VPC egress configuration for private network access (e.g., Redis) */
export interface CloudNetworkConfig {
  /** VPC network name (e.g., "default") */
  name: string;
  /** VPC subnet name (e.g., "default") */
  subnet?: string;
  /** VPC egress mode. Default: "private-ranges-only" */
  egress?: "all-traffic" | "private-ranges-only";
}

/** Configuration for Cloud Run Jobs execution */
export interface CloudConfig {
  /** Cloud Run Job name (e.g., "loads-predictions-jobs") */
  name: string;
  /** GCP region. Default: "us-central1" */
  region?: string;
  /** Artifact Registry repository name. Default: "cloud-run" */
  artifactRegistry?: string;
  /** Container resource limits */
  resources?: CloudResources;
  /** Service account email for the Cloud Run Job */
  serviceAccount?: string;
  /**
   * Build Docker images locally instead of using Cloud Build.
   * Requires Docker to be installed and running. Default: true.
   */
  buildLocal?: boolean;
  /** Direct VPC egress configuration for private network access */
  network?: CloudNetworkConfig;
}

/** Full runner configuration provided by each service */
export interface RunnerConfig {
  /**
   * Absolute path to the directory containing job scripts.
   * Default: `dist/jobs` relative to cwd.
   */
  jobsDirectory?: string;
  /** Optional initialization function called before the job runs (skipped for --help) */
  initialize?: () => void | Promise<void>;
  /** Optional custom logger (defaults to console) */
  logger?: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  /** Named environments (e.g., stag, prod) */
  environments: Record<string, RunnerEnvOptions>;
  /**
   * Input destination used by `getInputFilesPath()` for every local run,
   * regardless of which environment is selected. Resolved relative to the
   * service directory; `gs://bucket[/prefix]` URIs are also accepted.
   *
   * When set, local runs ignore the environment's `inputFilesPath`. When
   * unset, local runs fall back to the environment's `inputFilesPath`.
   * Cloud runs always use the environment's `inputFilesPath`.
   */
  localInputFilesPath?: string;
  /**
   * Output destination used by `getFileWriter()` and
   * `getOutputFilesPath()` for every local run, regardless of which
   * environment is selected. Resolved relative to the service directory;
   * `gs://bucket[/prefix]` URIs are also accepted.
   *
   * When set, local runs ignore the environment's `outputFilesPath`.
   * When unset, local runs fall back to the environment's
   * `outputFilesPath`. Cloud runs always use the environment's
   * `outputFilesPath`.
   */
  localOutputFilesPath?: string;
  /** Cloud Run Jobs configuration (required for `job cloud run/deploy` commands) */
  cloud?: CloudConfig;
  /**
   * Command to build workspace dependencies before running jobs.
   * Set to `false` to skip the build step entirely.
   * Default: "turbo build"
   */
  buildCommand?: string | false;
}

/** Identity function for type-safe runner config definition */
export function defineRunnerConfig(config: RunnerConfig): RunnerConfig {
  return config;
}

/** Identity function for type-safe environment definition */
export function defineRunnerEnv(options: RunnerEnvOptions): RunnerEnvOptions {
  return options;
}

/**
 * Resolve the input files destination for a local run. Prefers the
 * top-level `localInputFilesPath` over the environment's `inputFilesPath`.
 * Local paths are resolved against the service directory; `gs://` URIs
 * pass through unchanged.
 */
export function resolveLocalInputFilesPath(
  config: Pick<RunnerConfig, "localInputFilesPath">,
  envConfig: Pick<RunnerEnvOptions, "inputFilesPath">,
  serviceDirectory: string,
): string | undefined {
  return resolveLocal(
    config.localInputFilesPath ?? envConfig.inputFilesPath,
    serviceDirectory,
  );
}

/**
 * Resolve the output files destination for a local run. Prefers the
 * top-level `localOutputFilesPath` over the environment's
 * `outputFilesPath`. Local paths are resolved against the service
 * directory; `gs://` URIs pass through unchanged.
 */
export function resolveLocalOutputFilesPath(
  config: Pick<RunnerConfig, "localOutputFilesPath">,
  envConfig: Pick<RunnerEnvOptions, "outputFilesPath">,
  serviceDirectory: string,
): string | undefined {
  return resolveLocal(
    config.localOutputFilesPath ?? envConfig.outputFilesPath,
    serviceDirectory,
  );
}

function resolveLocal(
  raw: string | undefined,
  serviceDirectory: string,
): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith("gs://") ? raw : path.resolve(serviceDirectory, raw);
}
