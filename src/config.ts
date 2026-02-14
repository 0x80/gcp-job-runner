/** Environment configuration for a specific deployment target */
export interface RunnerEnvOptions {
  /** GCP project ID — sets GOOGLE_CLOUD_PROJECT automatically */
  project: string;
  /** Additional environment variables to set before the job runs */
  env?: Record<string, string>;
  /** Secret names to load from GCP Secret Manager */
  secrets?: string[];
}

/** Container resource limits for a Cloud Run Job */
export interface CloudResources {
  /** Memory limit (e.g., "512Mi", "1Gi"). Default: "512Mi" */
  memory?: string;
  /** CPU limit (e.g., "1", "2"). Default: "1" */
  cpu?: string;
  /** Job timeout in seconds. Default: 86400 (24 hours) */
  timeout?: number;
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
