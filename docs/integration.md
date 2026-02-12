# Service Integration Guide

This guide covers how to integrate the job runner into a service within a monorepo.

## Directory Layout

A typical service using gcp-job-runner has this structure:

```
services/my-service/
├── src/
│   ├── env.ts
│   └── jobs/
│       ├── count-collection.ts
│       ├── database/
│       │   ├── export.ts
│       │   └── seed.ts
│       └── users/
│           └── add-credits.ts
├── dist/
│   └── jobs/
│       ├── count-collection.mjs
│       └── ...
├── job-runner.config.ts
├── package.json
└── tsdown.config.ts
```

- **Source files** live in `src/jobs/` as `.ts` files
- **Compiled files** are output to `dist/jobs/` as `.mjs` files
- The **config file** sits at the service root

## Build Pipeline

The build tool (tsdown) compiles TypeScript job files into ESM modules. The `job` binary automatically runs `turbo build` before executing, so jobs are always built before execution.

A typical tsdown config includes the job files as entry points:

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jobs/**/*.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
});
```

This outputs job files to `dist/jobs/`, which is the default location the runner looks for jobs.

## Package.json Setup

Add the job runner dependency and scripts:

```json
{
  "dependencies": {
    "gcp-job-runner": "^1.0.0"
  },
  "scripts": {
    "cli:stag": "job local run stag",
    "cli:prod": "job local run prod"
  }
}
```

The `job` binary is provided by the `gcp-job-runner` package. The `cli:stag` and `cli:prod` scripts are shortcuts so users can run:

```bash
pnpm cli:stag count-collection --name users
pnpm cli:prod database/export --format csv
```

## Runner Configuration

Create `job-runner.config.ts` at the service root:

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";
import { initializeEnv } from "./src/env";

export default defineRunnerConfig({
  initialize: initializeEnv,
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      env: { LOG_LEVEL: "debug" },
      secrets: ["STRIPE_SECRET_KEY", "SENDGRID_API_KEY"],
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      env: { LOG_LEVEL: "info" },
      secrets: ["STRIPE_SECRET_KEY", "SENDGRID_API_KEY"],
    }),
  },
  cloud: {
    name: "my-service-jobs",
  },
});
```

## Secrets

Secrets are loaded automatically from GCP Secret Manager when specified in the environment config. The execution environment is transparent — secrets work identically for local and cloud execution.

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      secrets: ["STRIPE_SECRET_KEY"],
    }),
  },
});
```

When `job local run stag my-job` runs:

1. `GOOGLE_CLOUD_PROJECT` is set to `my-project-stag`
2. Secrets are loaded from GCP Secret Manager
3. `{ STRIPE_SECRET_KEY: "sk_..." }` is set on `process.env`
4. `initialize()` runs (if defined)
5. The job handler executes with all secrets available

### Local Development

For local development, authenticate with GCP:

```bash
gcloud auth application-default login
```

The `getSecrets` function automatically detects the environment and loads from Secret Manager when `GOOGLE_CLOUD_PROJECT` is set.

## Running Against Environments

```bash
# Run against staging
pnpm cli:stag count-collection --name users

# Run against production
pnpm cli:prod count-collection --name users

# Or directly with npx
npx job local run stag count-collection --name users
```

The only difference between environments is the config applied — GCP project, env vars, and secrets. The job code itself is environment-agnostic.

## Cloud Run Jobs

Add cloud configuration to deploy and run jobs in Cloud Run:

```typescript
export default defineRunnerConfig({
  // ...
  cloud: {
    name: "my-service-jobs",
  },
});
```

Then deploy and run:

```bash
# Auto-deploy if changed, then execute
job cloud run stag process-data --batch-size 100

# Deploy only (always updates the job)
job cloud deploy stag

# Interactive mode
job cloud run stag -i
```

The runner handles everything automatically:

- Generates Dockerfiles
- Builds container images with content-based caching
- Creates and updates Cloud Run Jobs via gcloud
- Mounts secrets from Secret Manager

See [Cloud Jobs](./cloud-jobs) for full details.

## Writing a Job

Each job is a single file with a default export created by `defineJob()`:

```typescript
import { z } from "zod";
import { defineJob } from "gcp-job-runner";

const ArgsSchema = z.object({
  collectionName: z.string().describe("Firestore collection to query"),
  limit: z.number().default(100).describe("Max documents to return"),
});

export default defineJob({
  description: "Count documents in a Firestore collection",
  schema: ArgsSchema,
  examples: [
    "job local run stag count-collection --collection-name users",
    "job local run stag count-collection --collection-name users --limit 10",
  ],
  handler: async (args) => {
    console.log(`Counting documents in ${args.collectionName}`);
    // Your job logic here
  },
});
```

The `initialize` function from your config runs before each job, so environment validation and shared setup happen automatically.
