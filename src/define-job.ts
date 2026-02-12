import { parseArgs } from "node:util";
import { consola } from "consola";
import type { ZodObject, ZodRawShape, ZodType } from "zod";
import { z } from "zod";
import {
  formatZodError,
  generateFullHelp,
  schemaToParseArgsOptions,
} from "./help";
import type { FlagAliases, JobFunction, JobOptions } from "./types";

/** Internal Zod definition type for introspection */
interface ZodDef {
  type?: string;
  typeName?: string;
  schema?: ZodType;
  innerType?: ZodType;
  element?: ZodType;
}

/**
 * Create a job with Zod schema validation.
 *
 * Returns a function with signature (argv, jobName) => Promise<void> that is
 * called by runJob(). The function:
 * - Parses flags from argv using Node's built-in `parseArgs`
 * - Handles --help (prints help and returns)
 * - Validates args against the Zod schema (strict mode, rejects unknown)
 * - Calls the handler with validated, typed args
 *
 * @example
 * ```typescript
 * const ArgsSchema = z.object({
 *   name: z.string().describe("Your name"),
 *   verbose: z.boolean().optional().default(false),
 * });
 *
 * export default defineJob({
 *   schema: ArgsSchema,
 *   handler: async (args) => {
 *     console.log(`Hello, ${args.name}!`);
 *   },
 *   description: "Greet someone",
 * });
 * ```
 */
export function defineJob<T extends ZodRawShape = ZodRawShape>(
  options: JobOptions<T>,
): JobFunction {
  const schema = options.schema ?? (z.object({}) as unknown as ZodObject<T>);
  const { handler } = options;

  const fn: JobFunction = async (
    argv: string[],
    jobName: string,
    commandPrefix?: string,
  ): Promise<void> => {
    /** Parse args from argv */
    const parsed = parseArgv(argv, schema, options.aliases);

    const helpOptions = {
      ...options,
      name: jobName,
      commandPrefix: commandPrefix ?? options.commandPrefix,
    };

    /** Handle --help */
    if (parsed.help === true) {
      const helpText = generateFullHelp(schema, helpOptions);
      consola.box(helpText);
      return;
    }

    /** Validate with strict mode (reject unknown fields) */
    const strictSchema = schema.strict();
    const result = strictSchema.safeParse(parsed);

    if (!result.success) {
      const errorText = formatZodError(result.error);
      const helpText = generateFullHelp(schema, helpOptions);
      consola.error(`${errorText}\n\n${helpText}`);
      process.exit(1);
    }

    await handler(result.data);
  };

  /** Attach metadata for discovery and interactive mode */
  fn.__metadata = {
    description: options.description,
    schema,
  };

  return fn;
}

/**
 * Convert kebab-case to camelCase.
 */
function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Parse argv into a merged args object using Node's built-in `parseArgs`.
 * Supports both --args JSON format and individual flags.
 * Coerces values to match the schema types.
 */
function parseArgv<T extends ZodRawShape>(
  argv: string[],
  schema: ZodObject<T>,
  aliases?: FlagAliases,
): Record<string, unknown> {
  /** Extract --args JSON if present */
  let jsonArgs: Record<string, unknown> = {};
  let filteredArgv = argv;
  const argsIndex = argv.findIndex((arg) => arg === "--args" || arg === "-a");

  if (argsIndex !== -1) {
    const argsValue = argv[argsIndex + 1];
    if (argsValue?.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(argsValue) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          jsonArgs = parsed as Record<string, unknown>;
        }
      } catch {
        /** Ignore JSON parse errors */
      }
    }
    /** Remove --args/-a and its value from argv before passing to parseArgs */
    filteredArgv = [...argv.slice(0, argsIndex), ...argv.slice(argsIndex + 2)];
  }

  /** Build parseArgs options from schema and aliases */
  const options = schemaToParseArgsOptions(schema, aliases);

  /** Add built-in help option */
  options.help = { type: "boolean", short: "h" };

  /** Parse with strict: false to allow unknown flags (Zod handles rejection) */
  const { values } = parseArgs({
    args: filteredArgv,
    options,
    strict: false,
    allowPositionals: true,
  });

  /** Build flag args, converting kebab-case to camelCase and resolving aliases */
  const flagArgs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const camelKey = toCamelCase(key);
    const resolvedKey = aliases?.[camelKey] ?? camelKey;
    flagArgs[resolvedKey] = value;
  }

  /** Merge: flags take precedence over JSON args */
  const merged = { ...jsonArgs, ...flagArgs };

  /** Coerce values to match schema types */
  return coerceToSchema(merged, schema);
}

/**
 * Coerce parsed values to match schema types.
 * - Converts values to the expected type (string, number, boolean)
 * - Wraps single values in arrays if the schema expects an array
 */
function coerceToSchema<T extends ZodRawShape>(
  values: Record<string, unknown>,
  schema: ZodObject<T>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...values };
  const shape = schema.shape;

  for (const [key, value] of Object.entries(result)) {
    const fieldSchema = shape[key] as ZodType | undefined;
    if (!fieldSchema || value === undefined) continue;

    const baseType = getBaseType(fieldSchema);

    if (baseType === "array") {
      const elementType = getArrayElementType(fieldSchema);
      if (Array.isArray(value)) {
        result[key] = value.map((v) => coerceValue(v, elementType));
      } else {
        result[key] = [coerceValue(value, elementType)];
      }
    } else if (baseType !== null) {
      result[key] = coerceValue(value, baseType);
    }
  }

  return result;
}

/**
 * Coerce a single value to the expected type.
 */
function coerceValue(value: unknown, targetType: string | null): unknown {
  if (value === undefined || value === null || targetType === null)
    return value;

  switch (targetType) {
    case "string":
      return `${value as string | number | boolean}`;
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return Boolean(value);
    default:
      return value;
  }
}

/**
 * Get the element type of an array schema.
 */
function getArrayElementType(schema: ZodType): string | null {
  let def = schema._def as ZodDef;

  /** Unwrap optional/default/effects to get to the array */
  while (
    (getType(def) === "optional" ||
      getType(def) === "default" ||
      getType(def) === "ZodEffects") &&
    (def.innerType || def.schema)
  ) {
    const inner = def.innerType ?? def.schema;
    if (inner) {
      def = inner._def as ZodDef;
    }
  }

  /** Get the element schema from the array */
  const typeName = getType(def);
  if ((typeName === "array" || typeName === "ZodArray") && def.element) {
    return getBaseType(def.element);
  }

  return null;
}

/**
 * Get the base type of a Zod schema, unwrapping optional/default/effects
 * wrappers. Returns null if the type cannot be confidently determined.
 */
function getBaseType(schema: ZodType): string | null {
  let def = schema._def as ZodDef;

  /** Unwrap optional/default/effects in any order until we reach a base type */
  while (
    (getType(def) === "optional" ||
      getType(def) === "default" ||
      getType(def) === "ZodEffects") &&
    (def.innerType || def.schema)
  ) {
    const inner = def.innerType ?? def.schema;
    if (inner) {
      def = inner._def as ZodDef;
    }
  }

  const typeName = getType(def);
  switch (typeName) {
    case "array":
    case "ZodArray":
      return "array";
    case "number":
    case "ZodNumber":
    case "int":
    case "ZodInt":
      return "number";
    case "boolean":
    case "ZodBoolean":
      return "boolean";
    case "string":
    case "ZodString":
      return "string";
    default:
      return null;
  }
}

/**
 * Get type string from a Zod definition, handling both v3 and v4 formats.
 */
function getType(def: ZodDef): string | undefined {
  return def.type ?? def.typeName;
}
