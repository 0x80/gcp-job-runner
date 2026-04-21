# File I/O

Jobs frequently need to produce artifacts — JSON reports, CSV dumps, generated assets — and sometimes also to _read_ inputs: fixtures, reference datasets, files produced by another job. The runner splits these into two configured destinations per environment:

- **Input** — where the job reads from. Exposed as a path via `getInputFilesPath()`.
- **Output** — where the job writes to. Exposed as a path via `getOutputFilesPath()`, and wrapped by `getFileWriter()` for convenient writes.

Each destination resolves to a local directory for local runs and a `gs://bucket[/prefix]` URI for cloud runs. Both are independently optional — a job that only writes outputs needs no input config, and vice versa. They may point at the same location when a single directory serves both roles.

## Writing Output Files

```typescript
import { defineJob, getFileWriter } from "gcp-job-runner";

export default defineJob({
  description: "Export pending comments as JSON and CSV",
  handler: async () => {
    const files = getFileWriter();

    await files.writeJson("pending-comments.json", rows);
    await files.writeText("pending-comments.csv", csvString);
  },
});
```

The writer reads its destination from your [runner config](./configuration). For most setups you'll pair a top-level [`localOutputFilesPath`](./configuration#localoutputfilespath) — used for every local run regardless of environment — with a per-environment [`outputFilesPath`](./configuration#outputfilespath) used for cloud execution:

```typescript
// job-runner.config.ts
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

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

## Reading Input Files

Use `getInputFilesPath()` to get the resolved input destination and read with whatever API fits:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineJob, getInputFilesPath } from "gcp-job-runner";

export default defineJob({
  handler: async () => {
    const base = getInputFilesPath();
    const raw = await readFile(path.join(base, "airlines.json"), "utf-8");
    const airlines = JSON.parse(raw);
    // ...
  },
});
```

Configure an [`inputFilesPath`](./configuration#inputfilespath) per environment and an optional top-level [`localInputFilesPath`](./configuration#localinputfilespath) for local overrides:

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

For `gs://` destinations, use `@google-cloud/storage` directly to fetch objects under the prefix — the library intentionally stays out of the read path so you can stream, list, and filter as your job needs.

### Reading Your Own Output

`getOutputFilesPath()` returns the resolved output destination. Useful when a handler writes a file and then needs its path for a follow-up step, or when chaining steps:

```typescript
import { getFileWriter, getOutputFilesPath } from "gcp-job-runner";

const writer = getFileWriter();
await writer.writeJson("intermediate.json", data);

const base = getOutputFilesPath();
// Feed `path.join(base, "intermediate.json")` to the next step, etc.
```

## Writer API

```typescript
interface FileWriter {
  writeJson(relativePath: string, data: unknown): Promise<string>;
  writeText(relativePath: string, content: string): Promise<string>;
  writeBuffer(
    relativePath: string,
    content: Buffer | Uint8Array,
  ): Promise<string>;
}

function getFileWriter(): FileWriter;
```

Each method returns the resolved destination — an absolute path for local writes or the full `gs://` URI for cloud writes — and logs the same value so you can grab it from the job output.

### `writeJson(relativePath, data)`

Serializes `data` as pretty-printed JSON (2-space indent, trailing newline). Adds `.json` to `relativePath` if it isn't already present.

```typescript
await files.writeJson("daily-stats", { users: 1234, orders: 56 });
// → ./output/daily-stats.json
```

### `writeText(relativePath, content)`

Writes a UTF-8 string as-is. Use for CSV, SVG, Markdown, plain text — anything character-based. The content type sent to Cloud Storage is derived from the file extension.

```typescript
await files.writeText(`unmatched-${today}.csv`, csv);
```

### `writeBuffer(relativePath, content)`

Writes raw bytes. Use for binary formats like PNG, PDF, or protobuf. Uploads with `application/octet-stream`.

```typescript
await files.writeBuffer("chart.png", pngBuffer);
```

## Nested Paths

All writer methods accept paths with forward slashes. Parent directories are created automatically for local writes; for GCS the segments become part of the object key.

```typescript
await files.writeJson(`db/airlines/${code}.json`, airline);
// Local: ./output/db/airlines/UA.json
// Cloud: gs://my-bucket/db/airlines/UA.json
```

Absolute paths and upward traversal (`..`) are rejected so a job can't accidentally escape its configured destination.

## Local vs Cloud

| Aspect         | Local (`./input`, `./output`)                                          | Cloud (`gs://bucket/prefix`)                     |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Resolution     | Relative to the service directory (where `job-runner.config.ts` lives) | Parsed as a GCS URI, bucket + optional prefix    |
| Storage        | `node:fs` — directories created as needed                              | `@google-cloud/storage`, uploaded with `.save()` |
| Authentication | None required                                                          | Application Default Credentials (ADC)            |
| Returned value | Absolute filesystem path                                               | Full `gs://` URI                                 |

The `@google-cloud/storage` module is lazy-loaded — jobs that only ever write to local paths don't pay the startup cost.

## Missing Configuration

Each accessor validates its own destination. Asking for input with no input configured throws — even if output is configured, and vice versa:

```
Error: No input files destination configured.
Set `localInputFilesPath` or the current environment's `inputFilesPath`
in your job-runner.config.ts, or set JOB_INPUT_FILES_PATH directly in
the environment.
```

```
Error: No output files destination configured.
Set `localOutputFilesPath` or the current environment's `outputFilesPath`
in your job-runner.config.ts, or set JOB_OUTPUT_FILES_PATH directly in
the environment.
```

Choose the opt-in explicitly rather than relying on implicit defaults.

## Cloud Deployment Safety

Any `inputFilesPath` or `outputFilesPath` value that is not a `gs://` URI is rejected at cloud deploy/run time — local paths have no meaning inside a container, and silently reading from or writing to the container's filesystem would fail or lose data when the task exits. Configure a `gs://` URI for every non-local environment.
