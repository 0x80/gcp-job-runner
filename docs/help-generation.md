# Help Generation

Every job gets automatic `--help` output derived from its Zod schema. No manual help text needed — descriptions, types, defaults, and allowed values are all extracted from the schema definition.

## Triggering Help

```bash
job local run stag my-job --help
job local run stag my-job -h
```

Help is rendered inside a `consola.box()` for clear visual separation in the terminal.

Help is displayed **without running the `initialize()` function**, so there's no delay from database connections or secret loading.

## Help Output Structure

A typical `--help` output looks like this:

```
 ╭──────────────────────────────────────────────────────╮
 │                                                      │
 │  Export user data to a file                          │
 │                                                      │
 │  Usage: job local run stag export-users [options]              │
 │                                                      │
 │  Options:                                            │
 │    --format <enum> (required)                        │
 │        Output file format                            │
 │        Values: json, csv                             │
 │    --limit <number>                                  │
 │        Maximum number of users to export             │
 │        Default: 1000                                 │
 │    --include-deleted <boolean>                       │
 │        Include soft-deleted users                    │
 │        Default: false                                │
 │                                                      │
 │  Examples:                                           │
 │    job local run stag export-users --format csv --limit 500    │
 │    job local run stag export-users --format json               │
 │                                                      │
 ╰──────────────────────────────────────────────────────╯
```

The output has four sections:

1. **Description** — from `JobOptions.description`
2. **Usage** — `{commandPrefix} {jobName} [options]`
3. **Options** — generated from the Zod schema
4. **Examples** — from `JobOptions.examples`

## `generateFullHelp()`

```typescript
function generateFullHelp<T extends ZodRawShape>(
  schema: ZodObject<T>,
  options?: HelpOptions,
): string;
```

Assembles the complete help text from all sections. The `HelpOptions` type:

```typescript
interface HelpOptions {
  name?: string; // Job name for the usage line
  description?: string; // Job description
  examples?: string[]; // Example command lines
  commandPrefix?: string; // Prefix before job name (default: "job")
}
```

The `commandPrefix` is set at runtime by the bin entry point to include the environment name (e.g., `"job local run stag"`).

## `generateSchemaHelp()`

```typescript
function generateSchemaHelp<T extends ZodRawShape>(
  schema: ZodObject<T>,
): string;
```

Generates just the "Options:" section. For each field in the schema, it produces:

```
  --flag-name <type> (required)
      Description text
      Default: value
      Values: enum1, enum2
```

### Field Information Extraction

For each schema field, the following information is extracted:

| Property      | Source                                                |
| ------------- | ----------------------------------------------------- |
| Flag name     | Schema property name, converted to kebab-case         |
| Type hint     | Base Zod type (`number`, `boolean`, `array`, `enum`)  |
| Required      | Whether the field lacks `.optional()` or `.default()` |
| Description   | From `.describe()` on the field                       |
| Default value | From `.default()`                                     |
| Enum values   | From `z.enum([...])`                                  |

### Type Hints

Type hints are shown in angle brackets after the flag name. The `string` type is omitted since it's the default:

| Schema Type           | Help Output             |
| --------------------- | ----------------------- |
| `z.string()`          | `--flag-name`           |
| `z.number()`          | `--flag-name <number>`  |
| `z.boolean()`         | `--flag-name <boolean>` |
| `z.array(z.string())` | `--flag-name <array>`   |
| `z.enum(["a", "b"])`  | `--flag-name <enum>`    |

## Help Alongside Validation Errors

When validation fails, the full help text is printed below the error messages. This gives the user immediate context about what flags are available:

```
Validation error:
  --format: Required

Export user data to a file

Usage: job local run stag export-users [options]

Options:
  --format <enum> (required)
      Output file format
      Values: json, csv
  --limit <number>
      Maximum number of users to export
      Default: 1000
```
