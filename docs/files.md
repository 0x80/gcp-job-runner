# File I/O

Jobs frequently need to produce artifacts — JSON reports, CSV dumps, generated assets — that you want to inspect later. They also sometimes need to _read_ inputs from the same location: fixtures, prior outputs, reference datasets. `getFileWriter()` and `getFilesPath()` give you a single configured destination that works for both, writing to a local directory when running on your machine and to a Cloud Storage bucket when running in the cloud.

## Basic Usage

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

The writer reads its destination from your [runner config](./configuration). For most setups you'll pair a top-level [`localFilesPath`](./configuration#localfilespath) — used for every local run regardless of environment — with a per-environment [`filesPath`](./configuration#filespath) used for cloud execution:

```typescript
// job-runner.config.ts
import { defineRunnerConfig, defineRunnerEnv } from "gcp-job-runner";

export default defineRunnerConfig({
  localFilesPath: "./files",
  environments: {
    stag: defineRunnerEnv({
      project: "my-project-stag",
      filesPath: "gs://my-project-stag-files",
    }),
    prod: defineRunnerEnv({
      project: "my-project-prod",
      filesPath: "gs://my-project-prod-files",
    }),
  },
});
```

`localFilesPath` is optional — if you prefer to configure a destination per environment, just set `filesPath` on each env and leave `localFilesPath` unset.

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
// → ./files/daily-stats.json
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

## Reading Files

When a job needs to read from the same destination — a previously generated dataset, a fixture, a file produced by another job — use `getFilesPath()` to get the resolved location and read it with whatever API fits:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineJob, getFilesPath } from "gcp-job-runner";

export default defineJob({
  handler: async () => {
    const base = getFilesPath();
    const raw = await readFile(path.join(base, "airlines.json"), "utf-8");
    const airlines = JSON.parse(raw);
    // ...
  },
});
```

`getFilesPath()` returns:

- an absolute filesystem path for local destinations, or
- the full `gs://bucket[/prefix]` URI for cloud destinations.

For `gs://` destinations, use `@google-cloud/storage` directly to fetch objects under that prefix — the library intentionally stays out of the read path so you can stream, list, and filter as your job needs.

## Nested Paths

All writer methods accept paths with forward slashes. Parent directories are created automatically for local writes; for GCS the segments become part of the object key.

```typescript
await files.writeJson(`db/airlines/${code}.json`, airline);
// Local: ./files/db/airlines/UA.json
// Cloud: gs://my-bucket/db/airlines/UA.json
```

Absolute paths and upward traversal (`..`) are rejected so a job can't accidentally escape its configured destination.

## Local vs Cloud

| Aspect         | Local (`./files`)                                                      | Cloud (`gs://bucket/prefix`)                     |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Resolution     | Relative to the service directory (where `job-runner.config.ts` lives) | Parsed as a GCS URI, bucket + optional prefix    |
| Storage        | `node:fs` — directories created as needed                              | `@google-cloud/storage`, uploaded with `.save()` |
| Authentication | None required                                                          | Application Default Credentials (ADC)            |
| Returned value | Absolute filesystem path                                               | Full `gs://` URI                                 |

The `@google-cloud/storage` module is lazy-loaded — jobs that only ever write to local paths don't pay the startup cost.

## Missing Configuration

If a job calls `getFileWriter()` or `getFilesPath()` without a destination configured — neither `localFilesPath` nor the active environment's `filesPath` is set — the call throws immediately with a message pointing at the config key. Choose the opt-in explicitly rather than relying on implicit defaults.

```
Error: No files destination configured.
Set `localFilesPath` or the current environment's `filesPath` in your
job-runner.config.ts, or set JOB_FILES_PATH directly in the environment.
```

## Cloud Deployment Safety

`filesPath` values starting with `./` or `../` are rejected at cloud deploy/run time — local paths have no meaning inside a container, and silently writing to the container's filesystem would lose data when the task exits. Configure a `gs://` URI for every non-local environment.
