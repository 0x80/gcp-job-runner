# Writing Exports

Jobs frequently need to produce artifacts — JSON reports, CSV exports, generated assets — that you want to inspect later. `getExportsWriter()` gives you a single API that writes to a local directory when running on your machine and to a Cloud Storage bucket when running in the cloud.

## Basic Usage

```typescript
import { defineJob, getExportsWriter } from "gcp-job-runner";

export default defineJob({
  description: "Export pending comments as JSON and CSV",
  handler: async () => {
    const exports = getExportsWriter();

    await exports.writeJson("pending-comments.json", rows);
    await exports.writeText("pending-comments.csv", csvString);
  },
});
```

The writer reads its destination from the `exportsPath` you set in your [runner config](./configuration#exportspath). Each environment can point at a different destination — typically a local path for development and a `gs://` URI for staging and production.

```typescript
environments: {
  local: defineRunnerEnv({
    project: "my-project-dev",
    exportsPath: "./exports",
  }),
  stag: defineRunnerEnv({
    project: "my-project-stag",
    exportsPath: "gs://my-project-stag-exports",
  }),
},
```

## API

```typescript
interface ExportsWriter {
  writeJson(relativePath: string, data: unknown): Promise<string>;
  writeText(relativePath: string, content: string): Promise<string>;
  writeBuffer(
    relativePath: string,
    content: Buffer | Uint8Array,
  ): Promise<string>;
}

function getExportsWriter(): ExportsWriter;
```

Each method returns the resolved destination — an absolute path for local writes or the full `gs://` URI for cloud writes — and logs the same value so you can grab it from the job output.

### `writeJson(relativePath, data)`

Serializes `data` as pretty-printed JSON (2-space indent, trailing newline). Adds `.json` to `relativePath` if it isn't already present.

```typescript
await exports.writeJson("daily-stats", { users: 1234, orders: 56 });
// → ./exports/daily-stats.json
```

### `writeText(relativePath, content)`

Writes a UTF-8 string as-is. Use for CSV, SVG, Markdown, plain text — anything character-based. The content type sent to Cloud Storage is derived from the file extension.

```typescript
await exports.writeText(`unmatched-${today}.csv`, csv);
```

### `writeBuffer(relativePath, content)`

Writes raw bytes. Use for binary formats like PNG, PDF, or protobuf. Uploads with `application/octet-stream`.

```typescript
await exports.writeBuffer("chart.png", pngBuffer);
```

## Nested Paths

All methods accept paths with forward slashes. Parent directories are created automatically for local writes; for GCS the segments become part of the object key.

```typescript
await exports.writeJson(`db/airlines/${code}.json`, airline);
// Local: ./exports/db/airlines/UA.json
// Cloud: gs://my-bucket/db/airlines/UA.json
```

Absolute paths and upward traversal (`..`) are rejected so a job can't accidentally escape its configured destination.

## Local vs Cloud

| Aspect         | Local (`./exports`)                                                    | Cloud (`gs://bucket/prefix`)                     |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Resolution     | Relative to the service directory (where `job-runner.config.ts` lives) | Parsed as a GCS URI, bucket + optional prefix    |
| Storage        | `node:fs` — directories created as needed                              | `@google-cloud/storage`, uploaded with `.save()` |
| Authentication | None required                                                          | Application Default Credentials (ADC)            |
| Returned value | Absolute filesystem path                                               | Full `gs://` URI                                 |

The `@google-cloud/storage` module is lazy-loaded — jobs that only ever write to local paths don't pay the startup cost.

## Missing Configuration

If a job calls `getExportsWriter()` without `exportsPath` set for the active environment, the call throws immediately with a message pointing at the config key. Choose the opt-in explicitly per environment rather than relying on implicit defaults.

```
Error: No exports destination configured.
Set `exportsPath` on the current environment in your job-runner.config.ts,
or set JOB_EXPORTS_PATH directly in the environment.
```

## Cloud Deployment Safety

`exportsPath` values starting with `./` or `../` are rejected at cloud deploy/run time — local paths have no meaning inside a container, and silently writing to the container's filesystem would lose data when the task exits. Configure a `gs://` URI for every non-local environment.
