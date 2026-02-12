# Runner Configuration

Each service that uses gcp-job-runner provides a `job-runner.config.ts` file at its root. This file defines which environments are available and how to initialize the runtime.

## `defineRunnerConfig()`

Use `defineRunnerConfig()` to define your configuration with full type safety:

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      secrets: ["API_KEY"],
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      secrets: ["API_KEY"],
    }),
  },
});
```

`defineRunnerConfig()` is an identity function — it returns the config as-is but gives you TypeScript autocompletion and type checking.

## `RunnerConfig`

The full shape of the configuration object:

```typescript
interface RunnerConfig {
  /** Absolute path to job scripts. Default: `dist/jobs` relative to cwd */
  jobsDirectory?: string;

  /** Optional async setup function (skipped for --help) */
  initialize?: () => void | Promise<void>;

  /** Custom structured logger (defaults to console) */
  logger?: {
    info: (message: string) => void;
    error: (message: string) => void;
  };

  /** Named environments (e.g., stag, prod) */
  environments: Record<string, RunnerEnvOptions>;

  /** Cloud Run Jobs configuration */
  cloud?: CloudConfig;

  /** Build command to run before jobs. Default: "turbo build". Set to false to skip. */
  buildCommand?: string | false;
}
```

### `jobsDirectory`

Absolute path to the directory containing compiled job files (`.mjs`). Defaults to `dist/jobs` relative to the current working directory.

This is where `discoverJobs()` looks for available jobs and where `runJob()` loads them from.

### `initialize`

An optional async function called before a job executes. Use it for one-time setup like initializing environment validation or configuring shared resources.

```typescript
export default defineRunnerConfig({
  initialize: async () => {
    initializeEnv();
  },
});
```

The `initialize` function is **skipped** when the user passes `--help`. This keeps help output instant.

### `logger`

A custom logger with `info` and `error` methods. Defaults to `console` if not provided. Only affects local execution — cloud execution logs are streamed via Cloud Logging.

### `buildCommand`

Command to run before executing jobs. Defaults to `"turbo build"`. Set to `false` to skip the build step entirely.

```typescript
export default defineRunnerConfig({
  buildCommand: "pnpm build", // Custom build command
  // buildCommand: false,      // Skip build entirely
});
```

Build output is hidden to keep the terminal clean — you'll see a "Building..." indicator. If the build fails, the full output is displayed.

### `cloud`

Configuration for Cloud Run Jobs execution. See [Cloud Jobs](./cloud-jobs) for details.

```typescript
export default defineRunnerConfig({
  cloud: {
    name: "my-service-jobs",
    region: "us-central1", // Optional, default
    artifactRegistry: "cloud-run", // Optional, default
    serviceAccount: "sa@project.iam.gserviceaccount.com",
    resources: {
      memory: "1Gi",
      cpu: "2",
      timeout: 7200,
    },
  },
});
```

## `defineRunnerEnv()`

A type-safe helper for defining environment options inline:

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      env: { LOG_LEVEL: "debug" },
      secrets: ["STRIPE_SECRET_KEY"],
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      env: { LOG_LEVEL: "info" },
      secrets: ["STRIPE_SECRET_KEY"],
    }),
  },
});
```

## `RunnerEnvOptions`

The configuration for a single environment:

```typescript
interface RunnerEnvOptions {
  /** GCP project ID — sets GOOGLE_CLOUD_PROJECT automatically */
  project: string;

  /** Additional environment variables to set before the job runs */
  env?: Record<string, string>;

  /** Secret names to load from GCP Secret Manager */
  secrets?: string[];
}
```

### `project`

The GCP project ID. This is set as `GOOGLE_CLOUD_PROJECT` before any initialization or job execution happens.

### `env`

Additional environment variables to set. These are applied after `GOOGLE_CLOUD_PROJECT` but before secrets are loaded.

### `secrets`

An array of secret names to load from GCP Secret Manager. The secrets are loaded identically for both local and cloud execution — the execution environment is transparent.

## Environment Variable Flow

When you run `job local run stag my-job --flag value`, the following happens in order:

1. `GOOGLE_CLOUD_PROJECT` is set from `environments.stag.project`
2. Additional env vars from `environments.stag.env` are set
3. Secrets from `environments.stag.secrets` are loaded and set as env vars
4. `initialize()` is called (if defined)
5. The job handler executes with all env vars available via `process.env`
