# CLI Usage

The `job` command is the main entry point for running jobs. This page covers all the ways to interact with it.

## Command Structure

```
job local run <env> <job-name> [flags]       # Run locally
job cloud run <env> <job-name> [flags]       # Run in cloud (auto-deploy if changed)
job cloud deploy <env>                        # Deploy only
job --list                                    # List available jobs
```

- `local` / `cloud` — The execution mode
- `run` / `deploy` — The action to perform
- `<env>` — The target environment (e.g., `stag`, `prod`)
- `<job-name>` — The job to run (e.g., `hello`, `database/seed`)
- `[flags]` — Optional arguments for the job

## Listing Jobs

Use `--list` to see all available jobs:

```bash
job --list
```

Output:

```
Available jobs:
  count-collection
  database/export
  database/seed
  users/add-credits
```

The `--list` flag can be used without specifying a mode or environment.

## Interactive Mode

Use `--interactive` (or `-i`) to browse and select jobs interactively:

```bash
job local run stag -i
job cloud run stag -i
```

Interactive mode guides you through:

1. **Job selection** — Browse folders and files in the jobs directory
2. **Argument input** — Prompted for each field in the job's Zod schema

### Navigation

When browsing jobs:

- Select a folder to enter it
- Select `..` to go back to the parent folder
- Select a job file to run it

### Argument Prompts

The prompts adapt to the schema field types:

| Field Type | Prompt Type                         |
| ---------- | ----------------------------------- |
| `string`   | Text input                          |
| `number`   | Text input (parsed as number)       |
| `boolean`  | Yes/No confirmation                 |
| `enum`     | Select from allowed values          |
| `array`    | Text input (comma-separated values) |

Optional fields can be skipped by pressing Enter without a value. Default values are shown and pre-filled when available.

### Cloud Interactive Mode

Interactive mode also works with cloud execution:

```bash
job cloud run stag -i
```

This auto-deploys if changes are detected, then prompts for job selection and arguments before executing on Cloud Run.

## Getting Help

Every job supports `--help` (or `-h`) to print usage information:

```bash
job local run stag my-job --help
```

Help output is rendered in a box and includes:

- Job description
- Usage line
- All available flags with types, defaults, and descriptions
- Example commands (if defined)

Help is displayed **without running initialization** — there's no waiting for database connections or secret loading.

## Passing Arguments

### Individual Flags

Pass arguments as `--flag-name value` pairs:

```bash
job local run stag export-users --format csv --limit 1000
```

Or with `=` syntax:

```bash
job local run stag export-users --format=csv --limit=1000
```

Flag names use kebab-case on the CLI, which maps to camelCase schema properties:

| CLI Flag       | Schema Property |
| -------------- | --------------- |
| `--user-id`    | `userId`        |
| `--dry-run`    | `dryRun`        |
| `--start-date` | `startDate`     |

### Boolean Flags

Boolean flags don't take a value — their presence sets them to `true`:

```bash
job local run stag my-job --dry-run --verbose
```

### Array Flags

Repeat a flag to pass multiple values:

```bash
job local run stag my-job --user-ids alice --user-ids bob --user-ids carol
```

### JSON Arguments

Pass all arguments as a JSON object with `--args` (or `-a`):

```bash
job local run stag my-job --args '{"userId": "abc123", "limit": 50}'
job local run stag my-job -a '{"userId": "abc123", "limit": 50}'
```

JSON property names should use camelCase (matching the Zod schema).

### Flag Precedence

When both `--args` and individual flags are provided, **individual flags take precedence** over JSON values:

```bash
job local run stag my-job --args '{"userId": "abc", "limit": 10}' --limit 50
# Result: { userId: "abc", limit: 50 }
```

## Nested Jobs

Jobs organized in subdirectories are referenced with slash-separated names:

```
jobs/
├── count-collection.mjs
├── database/
│   ├── export.mjs
│   └── seed.mjs
└── users/
    └── add-credits.mjs
```

```bash
job local run stag count-collection
job local run stag database/export
job local run stag database/seed
job local run stag users/add-credits
```

## Error Messages

### Missing or Unknown Mode

```
Unknown or missing mode "".

Usage: job local run <env> <job-name> [options]
       job cloud run <env> <job-name> [options]
       job cloud deploy <env>
       job --list

Environments: stag, prod
```

### Missing or Unknown Action

```
Unknown or missing action "" for cloud mode.

Usage: job local run <env> <job-name> [options]
       job cloud run <env> <job-name> [options]
       job cloud deploy <env>
       job --list
```

### Missing Environment

```
No environment specified.

Usage: job local run <env> <job-name> [options]
       job cloud run <env> <job-name> [options]
       job cloud deploy <env>
       job --list

Environments: stag, prod
```

### Unknown Environment

```
Unknown environment "dev".

Available environments: stag, prod
```

### Missing Job Name

```
No job name specified.

Usage: job local run stag <job-name> [options]
       job local run stag -i
```

### Validation Errors

When arguments fail schema validation, the error is shown alongside the full help text:

```
Validation error:
  --collectionName: Required

Usage: job local run stag count-collection [options]

Options:
  --collection-name (required)
      Firestore collection to query
```

### Unknown Flags

Unknown flags are rejected in strict mode:

```
Validation error:
  Unrecognized key(s) in object: 'unknownFlag'
```

## Build Command

The job binary runs a build command before executing jobs to ensure workspace dependencies are compiled. By default, it runs `turbo build`.

Build output is hidden to keep the terminal clean — you'll see a "Building..." indicator followed by "Build complete". If the build fails, the full output is displayed to help diagnose the issue.

### Customizing the Build Command

Configure it in your `job-runner.config.ts`:

```typescript
export default defineRunnerConfig({
  buildCommand: "nx build", // or "pnpm build", etc.
  // ...
});
```

### Skipping the Build

Skip the build step with `--no-build`:

```bash
job local run stag my-job --no-build
```

Or disable it in config:

```typescript
export default defineRunnerConfig({
  buildCommand: false,
  // ...
});
```

## Secrets

Secrets are automatically loaded from GCP Secret Manager when specified in the environment config. The execution environment is transparent — secrets work identically for local and cloud execution.

### Using Secrets

Specify secrets in your environment config:

```typescript
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  environments: {
    stag: defineRunnerEnv({
      project: "my-project",
      secrets: ["API_KEY", "DATABASE_URL"],
    }),
  },
});
```

### How Secrets Are Resolved

1. **In-memory cache** — Previously loaded secrets are returned instantly
2. **GCP Secret Manager** — Loaded using Application Default Credentials
3. **Environment variables** — Fallback when Secret Manager is unavailable

### Local Development

For local development, authenticate with GCP:

```bash
gcloud auth application-default login
```

The `GOOGLE_CLOUD_PROJECT` is set automatically from your environment config.

Alternatively, set secrets directly as environment variables for testing:

```bash
export API_KEY=your-key
export DATABASE_URL=your-url
```
