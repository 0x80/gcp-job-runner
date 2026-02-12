# Schema & Validation

Job arguments are validated using [Zod](https://zod.dev) schemas. This page covers the supported types, how CLI strings are coerced to match schema types, and how validation errors are handled.

## Supported Zod Types

| Zod Type              | CLI Flag Type                    | Coercion                     |
| --------------------- | -------------------------------- | ---------------------------- |
| `z.string()`          | `type: "string"`                 | None (strings pass through)  |
| `z.number()`          | `type: "string"`                 | `Number(value)`              |
| `z.boolean()`         | `type: "boolean"`                | Flag presence = `true`       |
| `z.enum([...])`       | `type: "string"`                 | None (validated by Zod)      |
| `z.array(z.string())` | `type: "string", multiple: true` | Wraps single values in array |
| `z.array(z.number())` | `type: "string", multiple: true` | Wraps + coerces elements     |

All of these can be combined with `.optional()`, `.default()`, and `.describe()`.

## How `parseArgs` Mapping Works

The `schemaToParseArgsOptions()` function converts a Zod schema into options for Node's built-in `parseArgs`:

- **Boolean fields** → `{ type: "boolean" }` — parsed as flags without values
- **Array fields** → `{ type: "string", multiple: true }` — accepts repeated `--flag value` pairs
- **Everything else** → `{ type: "string" }` — parsed as string, coerced later

This means all non-boolean values arrive as strings from the CLI and are coerced to their target types in a second pass.

## Type Coercion

After `parseArgs` extracts raw values, `coerceToSchema()` converts them to match the schema:

### Strings

No coercion needed. Values pass through as-is.

### Numbers

String values are converted with `Number(value)`:

```bash
--limit 50        # "50" → 50
--offset 0        # "0" → 0
```

If the conversion produces `NaN`, Zod will catch it during validation.

### Booleans

Boolean fields use `parseArgs` native boolean support — their presence on the CLI sets them to `true`:

```bash
--verbose         # true
                  # (omitted) → undefined or default
```

String values `"true"` and `"false"` are also converted to their boolean equivalents (relevant when using `--args` JSON).

### Arrays

Array handling depends on how many values are passed:

```bash
# Multiple values → already an array
--ids alice --ids bob    # ["alice", "bob"]

# Single value → wrapped in array
--ids alice              # "alice" → ["alice"]
```

Array elements are coerced to their declared type. For `z.array(z.number())`:

```bash
--ids 1 --ids 2 --ids 3    # ["1", "2", "3"] → [1, 2, 3]
```

### Enums

Enum values are not coerced — they pass through as strings and are validated by Zod against the allowed values.

## Strict Mode

Jobs use Zod's `strict()` mode, which means **unknown fields are rejected**. If a user passes a flag that doesn't match any schema property (or alias), they get a clear error:

```bash
job local run stag my-job --unknown-flag value
```

```
Validation error:
  Unrecognized key(s) in object: 'unknownFlag'
```

This prevents typos from being silently ignored.

## Validation Error Format

When validation fails, errors are formatted by `formatZodError()` into a readable list:

```
Validation error:
  --userId: Required
  --limit: Expected number, received nan
```

Each line shows the schema property name (camelCase, matching the Zod schema) and the error message. The full help text is printed below the errors so the user can see what flags are available.

## Unwrapping Zod Wrappers

The coercion system handles Zod's internal wrapper types transparently. A field like:

```typescript
z.number().optional().default(10);
```

is internally represented as `ZodDefault(ZodOptional(ZodNumber))`. The coercion system unwraps through `ZodEffects`, `optional`, and `default` layers to find the base type (`number`) and coerce accordingly.

This means refinements and transforms are also supported:

```typescript
z.number().min(1).max(100); // ZodEffects wrapping ZodNumber
z.string().transform(Number); // ZodEffects wrapping ZodString
```

The base type is correctly identified regardless of how many wrappers are applied.
