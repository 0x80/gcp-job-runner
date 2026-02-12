# Cloud Jobs

Run jobs in Google Cloud Run Jobs containers.

## Overview

Cloud deployment is designed for monorepos. The runner uses [isolate-package](https://github.com/0x80/isolate-package) to automatically isolate your service with its internal workspace dependencies into a standalone deployable package — no manual bundling required.

The runner handles:

- Isolates the service and its workspace dependencies automatically
- Generates Dockerfiles
- Builds container images with content-based caching
- Creates and updates Cloud Run Jobs via gcloud
- Passes arguments and manages execution

No Terraform, Pulumi, or manual GCP configuration needed.

## Setup

### 1. Configure Cloud Settings

Add the `cloud` section to your `job-runner.config.ts`:

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  environments: {
    stag: defineRunnerEnv({
      project: "my-project",
      secrets: ["API_KEY"],
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      secrets: ["API_KEY"],
    }),
  },
  cloud: {
    name: "my-service-jobs",
  },
});
```

### 2. Add Build Entry for Jobs

Include job files in your tsdown config:

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jobs/**/*.ts"],
  format: ["esm"],
  target: "node22",
});
```

## Usage

### `cloud run` — Run a job (auto-deploy if changed)

```bash
job cloud run stag process-data --batch-size 100
```

`cloud run` is smart about deployment. It:

1. Builds TypeScript (unless `--no-build`)
2. Isolates the workspace package
3. Hashes the content to generate an image tag
4. Checks if the image already exists in Artifact Registry
5. **If image exists** — skips deploy, logs "No changes detected"
6. **If image is new** — builds + pushes the image, creates/updates the Cloud Run Job
7. Executes the job

This means repeated runs with unchanged code skip the entire deploy step, making execution much faster.

```bash
# Auto-deploy if changed, then execute
job cloud run stag process-data --batch-size 100

# Fire and forget (don't wait for completion)
job cloud run stag process-data --batch-size 100 --async

# Interactive mode
job cloud run stag -i
```

### `cloud deploy` — Deploy only

```bash
job cloud deploy stag
```

This always builds the image and creates/updates the Cloud Run Job, regardless of whether the image changed. Useful for updating job configuration (env vars, secrets, resource limits) without executing.

## Log Streaming

When you run a cloud job without `--async`, application logs from the Cloud Run Job execution are streamed to your terminal in real time via Cloud Logging. This gives you the same visibility as local execution — `log.info(...)` output appears directly in your terminal.

The CLI:

1. Starts the execution asynchronously
2. Opens a live tail on Cloud Logging filtered to the specific execution
3. Polls execution status every 5 seconds
4. On completion, waits a few seconds for remaining logs to arrive, then exits

If you press **Ctrl+C** during streaming, the execution continues in the cloud. The CLI prints a message with the Cloud Console log URL so you can follow along there.

Log entries are formatted with timestamps and color-coded severity levels:

- **ERROR** / **CRITICAL** — red
- **WARNING** — yellow
- **INFO** — cyan

The `--async` flag skips streaming entirely and exits immediately after starting the execution.

## Cloud Config Options

```typescript
cloud: {
  name: "my-service-jobs",        // Required: Cloud Run Job name
  region: "us-central1",          // Optional, default: "us-central1"
  artifactRegistry: "cloud-run",  // Optional, default: "cloud-run"
  serviceAccount: "sa@proj.iam.gserviceaccount.com",  // Optional
  resources: {
    memory: "1Gi",                // Optional, default: "512Mi"
    cpu: "2",                     // Optional, default: "1"
    timeout: 7200,                // Optional, default: 3600 (seconds)
  },
}
```

## Example Job

```typescript
import { z } from "zod";
import { defineJob } from "gcp-job-runner";

const ArgsSchema = z.object({
  batchSize: z.number().default(50).describe("Number of items per batch"),
});

export default defineJob({
  description: "Process data in batches",
  schema: ArgsSchema,
  handler: async (args) => {
    console.log(`Processing with batch size: ${args.batchSize}`);
    // Your job logic here
  },
});
```

## Secrets

Secrets are loaded from GCP Secret Manager — same secrets for local and cloud execution:

```typescript
environments: {
  stag: defineRunnerEnv({
    project: "my-project",
    secrets: ["API_KEY", "DATABASE_URL"],
  }),
}
```

## Content-Based Caching

Images are tagged with a hash of the isolated package directory. When running `cloud run`, the CLI checks whether the image already exists in Artifact Registry:

- **Image exists** — no rebuild, no deploy, straight to execution
- **Image is new** — build, push, create/update Cloud Run Job, then execute

Use `cloud deploy` to force a deploy regardless of whether the image changed (useful for updating env vars or resource limits).

### One Image, Many Jobs

A single Docker image contains **all jobs** for a service. The job name and arguments are passed at execution time, not at build time. This means:

- Running different jobs does not trigger a rebuild
- Passing different arguments does not trigger a rebuild
- Only source code changes produce a new content hash and trigger a build + deploy

In practice, after the first deploy you can `cloud run` as many different jobs with as many different arguments as you want — each run starts almost instantly because there's nothing to build.

## Prerequisites

- `gcloud` CLI authenticated with appropriate permissions
- Artifact Registry repository (default: `cloud-run`)
- GCP project with Cloud Run and Cloud Build APIs enabled
