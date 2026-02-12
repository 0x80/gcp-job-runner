# Defining Jobs

Jobs are defined using `defineJob()`, which takes a Zod schema for argument validation and a handler function. Each job file exports a single default function.

## Basic Structure

```typescript
import { z } from "zod";
import { defineJob } from "gcp-job-runner";

const ArgsSchema = z.object({
  userId: z.string().describe("The user ID to process"),
});

export default defineJob({
  description: "Process a single user",
  schema: ArgsSchema,
  handler: async (args) => {
    // args.userId is typed as string
    console.log(`Processing user: ${args.userId}`);
  },
});
```

## `defineJob()` API

```typescript
defineJob<T extends ZodRawShape>(options: JobOptions<T>): JobFunction
```

### Options

| Option          | Type                      | Required | Description                                                   |
| --------------- | ------------------------- | -------- | ------------------------------------------------------------- |
| `handler`       | `(args) => Promise<void>` | Yes      | The function that runs when the job executes                  |
| `schema`        | `ZodObject<T>`            | No       | Zod schema for argument validation (defaults to empty object) |
| `description`   | `string`                  | No       | Shown in `--help` output and job listings                     |
| `examples`      | `string[]`                | No       | Example command lines shown in `--help`                       |
| `aliases`       | `FlagAliases`             | No       | Map short flag names to schema property names                 |
| `commandPrefix` | `string`                  | No       | CLI prefix for help output (overridden at runtime)            |

### Jobs Without Arguments

If your job doesn't need any arguments, you can omit the schema:

```typescript
export default defineJob({
  description: "Run the daily cleanup",
  handler: async () => {
    // no args needed
    await runCleanup();
  },
});
```

## Schema → CLI Flags

Zod schema properties are automatically mapped to CLI flags. Property names are converted from camelCase to kebab-case:

| Schema Property | CLI Flag       |
| --------------- | -------------- |
| `userId`        | `--user-id`    |
| `startDate`     | `--start-date` |
| `verbose`       | `--verbose`    |
| `dryRun`        | `--dry-run`    |

### Required Fields

Required fields must be provided:

```typescript
const ArgsSchema = z.object({
  collectionName: z.string().describe("Firestore collection to query"),
});
```

```bash
job local run stag my-job --collection-name users
```

Omitting a required field produces a validation error:

```
Validation error:
  --collectionName: Required
```

### Optional Fields

Use `.optional()` to make a field optional:

```typescript
const ArgsSchema = z.object({
  limit: z.number().optional().describe("Max results to return"),
});
```

### Default Values

Use `.default()` to provide a default:

```typescript
const ArgsSchema = z.object({
  limit: z.number().default(100).describe("Max results to return"),
  verbose: z.boolean().default(false).describe("Enable verbose output"),
});
```

Defaults are shown in `--help` output.

### Descriptions

Use `.describe()` on any field to add help text:

```typescript
const ArgsSchema = z.object({
  startDate: z.string().describe("Start date in YYYY-MM-DD format"),
  endDate: z.string().describe("End date in YYYY-MM-DD format"),
});
```

Descriptions appear indented below the flag name in `--help` output.

### Enum Fields

Use `z.enum()` to restrict values to a set of choices:

```typescript
const ArgsSchema = z.object({
  environment: z.enum(["stag", "prod"]).describe("Target environment"),
  format: z.enum(["json", "csv"]).default("json").describe("Output format"),
});
```

Allowed values are listed in `--help` output.

### Array Fields

Use `z.array()` for fields that accept multiple values:

```typescript
const ArgsSchema = z.object({
  userIds: z.array(z.string()).describe("User IDs to process"),
});
```

Pass multiple values by repeating the flag:

```bash
job local run stag my-job --user-ids alice --user-ids bob --user-ids carol
```

Array element types are coerced — `z.array(z.number())` will convert string inputs to numbers.

### Number Fields

Numbers are automatically coerced from string input:

```typescript
const ArgsSchema = z.object({
  limit: z.number().describe("Maximum number of items"),
  offset: z.number().default(0),
});
```

```bash
job local run stag my-job --limit 50 --offset 10
```

### Boolean Fields

Boolean fields are passed as flags without a value:

```typescript
const ArgsSchema = z.object({
  dryRun: z.boolean().default(false).describe("Preview without making changes"),
  verbose: z.boolean().default(false),
});
```

```bash
job local run stag my-job --dry-run --verbose
```

## Aliases

Use `aliases` to define short flag names that map to schema properties:

```typescript
const ArgsSchema = z.object({
  collectionName: z.string().describe("Firestore collection"),
  verbose: z.boolean().default(false),
});

export default defineJob({
  schema: ArgsSchema,
  aliases: {
    name: "collectionName",
    v: "verbose",
  },
  handler: async (args) => {
    // ...
  },
});
```

Now both forms work:

```bash
job local run stag my-job --collection-name users
job local run stag my-job --name users
```

Alias keys are also converted from camelCase to kebab-case for flag matching.

## The `--args` JSON Shorthand

Instead of individual flags, you can pass all arguments as a JSON object:

```typescript
const ArgsSchema = z.object({
  userId: z.string(),
  limit: z.number().default(10),
});
```

```bash
job local run stag my-job --args '{"userId": "abc123", "limit": 50}'
# or use the short form:
job local run stag my-job -a '{"userId": "abc123", "limit": 50}'
```

JSON property names should use camelCase (matching the schema), not kebab-case.

### Flag Precedence

When both `--args` and individual flags are provided, **flags take precedence**:

```bash
job local run stag my-job --args '{"userId": "abc", "limit": 10}' --limit 50
# Result: { userId: "abc", limit: 50 }
```

## Examples

Add example command lines that appear in `--help`:

```typescript
export default defineJob({
  description: "Export user data to CSV",
  schema: ArgsSchema,
  examples: [
    "job local run stag export-users --format csv --limit 1000",
    'job local run stag export-users --args \'{"format": "json"}\'',
  ],
  handler: async (args) => {
    // ...
  },
});
```

## Metadata and Discovery

`defineJob()` attaches a `__metadata` property to the returned function containing the `description`. This is used by the job discovery system when listing available jobs.
