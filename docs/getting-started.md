# Getting Started

This guide walks you through setting up gcp-job-runner in a service and running your first job.

## Install

```bash
npm install gcp-job-runner
```

## Create a Runner Config

Create a `job-runner.config.ts` file at the root of your service:

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

Each environment specifies a GCP project, optional environment variables via `env`, and secret names to load from GCP Secret Manager via `secrets`.

## Write Your First Job

Create a job file at `src/jobs/countdown.ts`:

```typescript
import { z } from "zod";
import { defineJob } from "gcp-job-runner";

export default defineJob({
  description: "Count down and exit",
  schema: z.object({
    seconds: z.number().default(10).describe("Number of seconds to count down"),
  }),
  handler: async ({ seconds }) => {
    for (let i = seconds; i > 0; i--) {
      console.log(`${i}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("Done!");
  },
});
```

## Run It

```bash
npx job local run stag countdown --seconds 5
```

This will:

1. Build workspace dependencies (shows "Building..." indicator)
2. Load `job-runner.config.ts`
3. Set `NODE_ENV` to `development` and `GOOGLE_CLOUD_PROJECT` to `my-project-stag`
4. Apply env vars and load secrets from GCP Secret Manager
5. Execute the `countdown` job with `{ seconds: 5 }`

## Get Help

Every job supports `--help` automatically:

```bash
npx job local run stag countdown --help
```

```
 ╭─────────────────────────────────────────────────────╮
 │                                                     │
 │  Count down and exit                                │
 │                                                     │
 │  Usage: job local run stag countdown [options]      │
 │                                                     │
 │  Options:                                           │
 │    --seconds <number>                               │
 │        Number of seconds to count down              │
 │        Default: 10                                  │
 │                                                     │
 ╰─────────────────────────────────────────────────────╯
```

## Run It in the Cloud

The same job runs on Cloud Run with one word changed:

```bash
npx job cloud run stag countdown --seconds 5
```

The runner builds a Docker image, pushes it to Artifact Registry, and streams logs back to your terminal. A single image contains all your jobs, so deployment is separate from choosing which job to run and with what arguments. You can run different jobs one after another without rebuilding or redeploying — only source code changes trigger a new build.

## Interactive Mode

Browse and select jobs interactively:

```bash
npx job local run stag -i
```

This guides you through job selection and prompts for arguments based on the schema.

## List Available Jobs

```bash
npx job --list
```

This discovers all compiled `.mjs` files in your jobs directory and lists them.

## Next Steps

- [Database Migration Example](./migration-example) — A real-world Firestore migration job
- [Configuration](./configuration) — Full reference for `job-runner.config.ts`
- [Defining Jobs](./defining-jobs) — Schema options, aliases, examples, and more
- [CLI Usage](./cli-usage) — All the ways to pass arguments
- [Cloud Jobs](./cloud-jobs) — Deploy and run jobs in Cloud Run
