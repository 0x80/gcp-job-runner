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

  /**
   * Input destination used by getInputFilesPath() for every local run,
   * regardless of which environment is selected. Local path or gs:// URI.
   */
  localInputFilesPath?: string;

  /**
   * Output destination used by getFileWriter()/getOutputFilesPath() for
   * every local run, regardless of which environment is selected. Local
   * path or gs:// URI.
   */
  localOutputFilesPath?: string;

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

### `localInputFilesPath`

Input destination used by [`getInputFilesPath()`](./files) for every local run, regardless of which environment is selected. Either a local path (resolved relative to the service directory) or a `gs://bucket[/prefix]` URI.

```typescript
export default defineRunnerConfig({
  localInputFilesPath: "./input",
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      inputFilesPath: "gs://my-project-stag-input",
    }),
  },
});
```

When running jobs locally, the selected environment still controls which project's data you read or write — but the _input_ location is usually the same developer machine. `localInputFilesPath` captures that: one top-level setting instead of per-env duplication.

When set, local runs use `localInputFilesPath` and ignore the environment's `inputFilesPath`. Cloud runs always use the environment's `inputFilesPath`.

### `localOutputFilesPath`

Output destination used by [`getFileWriter()`](./files) and [`getOutputFilesPath()`](./files) for every local run. Same semantics as `localInputFilesPath`, for the write side:

```typescript
export default defineRunnerConfig({
  localOutputFilesPath: "./output",
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      outputFilesPath: "gs://my-project-stag-output",
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      outputFilesPath: "gs://my-project-prod-output",
    }),
  },
});
```

`localInputFilesPath` and `localOutputFilesPath` may point at the same directory when a single location serves both roles.

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
      timeout: 7200, // Optional, default: 86400 (24 hours)
      parallelism: 5, // Optional, max concurrent tasks
    },
    network: {
      name: "default", // VPC network name
      subnet: "default", // Optional, VPC subnet name
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
      envFile: ".env.stag",
      env: { LOG_LEVEL: "debug" },
      secrets: ["STRIPE_SECRET_KEY"],
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      envFile: ".env.prod",
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

  /** Path(s) to .env files to load */
  envFile?: string | string[];

  /** Additional environment variables to set before the job runs */
  env?: Record<string, string>;

  /** Secret names to load from GCP Secret Manager */
  secrets?: string[];

  /** Destination the job reads from via getInputFilesPath() */
  inputFilesPath?: string;

  /** Destination the job writes to via getFileWriter()/getOutputFilesPath() */
  outputFilesPath?: string;
}
```

### `project`

The GCP project ID. This is set as `GOOGLE_CLOUD_PROJECT` before any initialization or job execution happens.

### `envFile`

Path or array of paths to `.env` files, resolved relative to the service directory (where `job-runner.config.ts` lives). This lets you reuse existing `.env` files instead of duplicating variables in the `env` object.

```typescript
stag: defineRunnerEnv({
  project: "my-project-stag",
  envFile: ".env.stag",
  env: { NODE_ENV: "production" },
}),
```

When multiple files are specified, earlier files take precedence (first-wins), matching the dotenv convention. This is useful for layering local overrides on top of shared config:

```typescript
stag: defineRunnerEnv({
  project: "my-project-stag",
  envFile: [".env.local.stag", ".env.stag"],
}),
```

The loaded variables are applied in both local execution (`process.env`) and cloud deployments (`--set-env-vars` to gcloud). An error is thrown if a specified file does not exist.

### `env`

Additional environment variables to set. These override any values loaded from `envFile`.

### `secrets`

An array of secret names to load from GCP Secret Manager. The secrets are loaded identically for both local and cloud execution — the execution environment is transparent.

### `inputFilesPath`

Destination the job reads from via [`getInputFilesPath()`](./files). Accepts either a local path (resolved relative to the service directory) or a `gs://bucket[/prefix]` URI.

For most setups this is a `gs://` URI per environment, paired with a top-level [`localInputFilesPath`](#localinputfilespath) that handles every local run.

### `outputFilesPath`

Destination the job writes to via [`getFileWriter()`](./files) and reads back via [`getOutputFilesPath()`](./files). Accepts either a local path (resolved relative to the service directory) or a `gs://bucket[/prefix]` URI.

```typescript
export default defineRunnerConfig({
  localOutputFilesPath: "./output",
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      inputFilesPath: "gs://my-project-stag-input",
      outputFilesPath: "gs://my-project-stag-output",
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      inputFilesPath: "gs://my-project-prod-input",
      outputFilesPath: "gs://my-project-prod-output",
    }),
  },
});
```

Both fields are optional and independent — a job that only writes outputs needs no input config, and vice versa. They may point at the same URI when a single location serves both roles.

Local paths on an environment's `inputFilesPath` / `outputFilesPath` are only honoured when the matching `localInputFilesPath` / `localOutputFilesPath` is unset and the run is local. Cloud deployments always require a `gs://` URI — using a local path for `job cloud run/deploy` fails with a clear error so the misconfiguration can't be shipped.

Each accessor validates its own destination. `getInputFilesPath()` throws if no input path is configured (even when output is set); `getFileWriter()` / `getOutputFilesPath()` throw if no output path is configured. See [File I/O](./files) for the handler-side API.

## Environment Variable Precedence

When multiple sources provide the same variable, the highest-precedence source wins:

1. **`project`** → `GOOGLE_CLOUD_PROJECT` (always wins)
2. **`env`** values (override envFile and shell)
3. **Shell environment** / existing `process.env` (local execution only)
4. **`envFile`** values (don't overwrite existing variables)

This matches the standard dotenv convention where `.env` files never overwrite existing environment variables.

## Environment Variable Flow

When you run `job local run stag my-job --flag value`, the following happens in order:

1. `NODE_ENV` is set to `development` (if not already set)
2. Variables from `envFile` are loaded (without overwriting existing `process.env`)
3. Additional env vars from `env` are set (overwriting any previous values)
4. `GOOGLE_CLOUD_PROJECT` is set from `project`
5. Secrets from `secrets` are loaded and set as env vars
6. `initialize()` is called (if defined)
7. The job handler executes with all env vars available via `process.env`

When running in Cloud Run, `NODE_ENV` defaults to `production` instead. In both cases, an explicit `NODE_ENV` (from the shell or from `env` config) takes precedence.
