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

Most jobs read JSON or plain text. Use `readInputJson()` / `readInputText()` / `readInputBuffer()` — they transparently handle local directories and `gs://` buckets, reject absolute paths and upward traversal, and throw the same "no input destination configured" error as the writer when nothing is set:

```typescript
import { defineJob, readInputJson } from "gcp-job-runner";

interface Airline {
  iata: string;
  name: string;
}

export default defineJob({
  handler: async () => {
    const airlines = await readInputJson<Airline[]>("airlines.json");
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

### Reader API

```typescript
function readInputText(relativePath: string): Promise<string>;
function readInputJson<T = unknown>(relativePath: string): Promise<T>;
function readInputBuffer(relativePath: string): Promise<Buffer>;
```

- `readInputText` returns the file contents decoded as UTF-8. Use for CSV, JSON, plain text, SVG — anything character-based.
- `readInputJson` is a thin wrapper that parses the decoded text; parse errors on malformed input propagate as standard `SyntaxError`s from `JSON.parse`.
- `readInputBuffer` returns the raw bytes — use for binary inputs (PNG, protobuf, etc.).

For formats the library doesn't ship a helper for (e.g. CSV), read the text and feed it to your preferred parser:

```typescript
import { readInputText } from "gcp-job-runner";
import Papa from "papaparse";

const rows = Papa.parse(await readInputText("users.csv"), { header: true });
```

### Streaming or Custom Access

When the file is too large to buffer or you need a streaming API — `@google-cloud/storage` read streams, `createReadStream`, `readdir` of a subdirectory — fall back to `getInputFilesPath()` and pair it with `node:fs` or `@google-cloud/storage` directly:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getInputFilesPath } from "gcp-job-runner";

const base = getInputFilesPath();
const raw = await readFile(path.join(base, "airlines.json"), "utf-8");
```

The readers above cover the common case; `getInputFilesPath()` is the escape hatch.

### Picking Files Interactively

Mark a schema field with `fileInput()` to turn it into a picker in `--interactive` mode. Interactive runs list the files under the configured `inputFilesPath` (local `readdir` or `gs://` bucket list) and present them as a select prompt instead of asking for a free-text path:

```typescript
import { z } from "zod";
import { defineJob, fileInput, readInputText } from "gcp-job-runner";

export default defineJob({
  description: "Process a CSV from the input directory",
  schema: z.object({
    file: fileInput().describe("CSV to process"),
  }),
  handler: async ({ file }) => {
    const csv = await readInputText(file);
    // ...
  },
});
```

Run it with `job local run <env> <job> --interactive` and the `--file` prompt becomes a scrollable list of files in the configured input directory. `fileInput()` chains with `.optional()`, `.default()`, and `.describe()` as usual.

When the destination is a `gs://` URI, the picker uses a lazy `@google-cloud/storage` list — it authenticates with Application Default Credentials on the local machine running the prompt. An empty directory or missing config falls back to a free-text prompt with a warning so the flow isn't blocked.

`listInputFiles()` is also exported if you need the same listing outside the interactive flow.

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
