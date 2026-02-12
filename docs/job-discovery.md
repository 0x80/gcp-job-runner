# Job Discovery

The job runner discovers available jobs by scanning the filesystem. Jobs are organized as files in a directory tree, and their names are derived from their file paths.

## Directory Structure

Jobs live in a configurable directory (set via `jobsDirectory` in the runner config). The runner looks for compiled `.mjs` files:

```
dist/cli/jobs/
├── count-collection.mjs
├── hello.mjs
├── database/
│   ├── export.mjs
│   └── seed.mjs
└── users/
    └── add-credits.mjs
```

## File Naming

- Jobs are compiled `.mjs` files (ES modules)
- File names use kebab-case: `count-collection.mjs`, `add-credits.mjs`
- The `.mjs` extension is stripped to form the job name

## Nested Directories

Directories map to slash-separated job names:

| File Path               | Job Name            |
| ----------------------- | ------------------- |
| `count-collection.mjs`  | `count-collection`  |
| `database/export.mjs`   | `database/export`   |
| `database/seed.mjs`     | `database/seed`     |
| `users/add-credits.mjs` | `users/add-credits` |

You can nest directories as deep as needed:

```
admin/users/add-credits.mjs → admin/users/add-credits
```

## The `--list` Flag

Use `--list` to see all discovered jobs:

```bash
job --list
```

```
Available jobs:
  count-collection
  database/export
  database/seed
  hello
  users/add-credits
```

Jobs are sorted alphabetically. The `--list` flag works without specifying an environment.

## `discoverJobs()` API

For programmatic use, the `discoverJobs()` function is available:

```typescript
import { discoverJobs } from "gcp-job-runner";

const jobs = await discoverJobs("/path/to/jobs");
// [
//   { name: "count-collection" },
//   { name: "database/export" },
//   { name: "database/seed" },
//   { name: "hello" },
//   { name: "users/add-credits" },
// ]
```

### Signature

```typescript
function discoverJobs(
  jobsDirectory: string,
  extension?: string, // Default: ".mjs"
): Promise<JobInfo[]>;
```

### Return Type

```typescript
interface JobInfo {
  name: string; // e.g., "database/export"
  description?: string; // From job metadata, if available
}
```

### Custom Extension

By default, `discoverJobs()` looks for `.mjs` files. You can override this:

```typescript
const jobs = await discoverJobs("/path/to/jobs", ".js");
```

### Error Handling

If the jobs directory doesn't exist or is unreadable, `discoverJobs()` returns an empty array without throwing.
