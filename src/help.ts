import type { ZodObject, ZodRawShape, ZodType } from "zod";
import type { FlagAliases } from "./types";

/** Internal Zod definition type for introspection */
interface ZodDef {
  type?: string;
  typeName?: string;
  description?: string;
  schema?: ZodType;
  innerType?: ZodType;
  element?: ZodType;
  defaultValue?: unknown;
  values?: readonly string[];
  entries?: Record<string, string>;
  value?: string | number | boolean;
}

export interface FieldInfo {
  description?: string;
  typeName?: string;
  isOptional: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
}

/** Schema type with description property */
interface ZodTypeWithDescription extends ZodType {
  description?: string;
}

export interface HelpOptions {
  name?: string;
  description?: string;
  examples?: string[];
  commandPrefix?: string;
}

/**
 * Generate full help text including description, usage, options, and examples.
 */
export function generateFullHelp<T extends ZodRawShape>(
  schema: ZodObject<T>,
  options?: HelpOptions,
): string {
  const lines: string[] = [];

  if (options?.description) {
    lines.push(options.description);
    lines.push("");
  }

  if (options?.name) {
    const prefix = options.commandPrefix ?? "job";
    lines.push(`Usage: ${prefix} ${options.name} [options]`);
    lines.push("");
  }

  lines.push(generateSchemaHelp(schema));

  if (options?.examples && options.examples.length > 0) {
    lines.push("");
    lines.push("Examples:");
    for (const example of options.examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate the Options section from a Zod schema.
 */
export function generateSchemaHelp<T extends ZodRawShape>(
  schema: ZodObject<T>,
): string {
  const lines = ["Options:"];
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const info = extractFieldInfo(fieldSchema as ZodType);
    const flagName = toKebabCase(key);

    let line = `  --${flagName}`;

    /** Add type hint */
    if (info.typeName && info.typeName !== "string") {
      line += ` <${info.typeName}>`;
    }

    /** Mark required fields */
    if (!info.isOptional) {
      line += " (required)";
    }

    /** Add description */
    if (info.description) {
      line += `\n      ${info.description}`;
    }

    /** Add default value */
    if (info.defaultValue !== undefined) {
      line += `\n      Default: ${JSON.stringify(info.defaultValue)}`;
    }

    /** Add enum values */
    if (info.enumValues && info.enumValues.length > 0) {
      line += `\n      Values: ${info.enumValues.join(", ")}`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Format a Zod error into a user-friendly message.
 */
export function formatZodError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  const lines = ["Validation error:"];

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const prefix = path ? `  --${path}: ` : "  ";
    lines.push(`${prefix}${issue.message}`);
  }

  return lines.join("\n");
}

/**
 * Get the type string from a Zod definition, handling both v3 and v4 formats.
 */
function getType(def: ZodDef): string | undefined {
  return def.type ?? def.typeName;
}

/**
 * Extract field information from a Zod schema for help generation and interactive prompts.
 */
export function extractFieldInfo(schema: ZodType): FieldInfo {
  const info: FieldInfo = {
    isOptional: false,
  };

  let current = schema as ZodTypeWithDescription;
  let def = current._def as ZodDef;

  /** Unwrap ZodEffects (refinements, transforms) */
  while (getType(def) === "ZodEffects" && def.schema) {
    current = def.schema as ZodTypeWithDescription;
    def = current._def as ZodDef;
  }

  /** Check for optional */
  if (getType(def) === "optional" && def.innerType) {
    info.isOptional = true;
    current = def.innerType as ZodTypeWithDescription;
    def = current._def as ZodDef;
  }

  /** Check for default */
  if (getType(def) === "default" && def.innerType) {
    info.isOptional = true;
    if (def.defaultValue !== undefined) {
      info.defaultValue =
        typeof def.defaultValue === "function"
          ? def.defaultValue()
          : def.defaultValue;
    }
    current = def.innerType as ZodTypeWithDescription;
    def = current._def as ZodDef;
  }

  /** Unwrap any remaining effects */
  while (getType(def) === "ZodEffects" && def.schema) {
    current = def.schema as ZodTypeWithDescription;
    def = current._def as ZodDef;
  }

  /** Get description */
  const originalSchema = schema as ZodTypeWithDescription;
  info.description = originalSchema.description ?? current.description;

  /** Get type name */
  const typeName = getType(def);
  switch (typeName) {
    case "string":
    case "ZodString":
      info.typeName = "string";
      break;
    case "number":
    case "ZodNumber":
      info.typeName = "number";
      break;
    case "boolean":
    case "ZodBoolean":
      info.typeName = "boolean";
      break;
    case "array":
    case "ZodArray":
      info.typeName = "array";
      break;
    case "enum":
    case "ZodEnum":
      info.typeName = "enum";
      info.enumValues = def.values
        ? [...def.values]
        : def.entries
          ? Object.keys(def.entries)
          : undefined;
      break;
    case "union":
    case "ZodUnion":
      info.typeName = "union";
      break;
    case "literal":
    case "ZodLiteral":
      info.typeName = String(def.value);
      break;
    default:
      info.typeName = "string";
  }

  return info;
}

/**
 * Convert camelCase to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

interface ParseArgsOption {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
}

/**
 * Derive `parseArgs`-compatible options from a Zod schema shape.
 *
 * Boolean fields become `{ type: "boolean" }`, array fields become
 * `{ type: "string", multiple: true }`, everything else becomes
 * `{ type: "string" }`.
 *
 * Aliases are registered so `parseArgs` recognizes them as known options
 * with the same type as their target field.
 */
export function schemaToParseArgsOptions<T extends ZodRawShape>(
  schema: ZodObject<T>,
  aliases?: FlagAliases,
): Record<string, ParseArgsOption> {
  const options: Record<string, ParseArgsOption> = {};
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const flagName = toKebabCase(key);
    const info = extractFieldInfo(fieldSchema as ZodType);

    if (info.typeName === "boolean") {
      options[flagName] = { type: "boolean" };
    } else if (info.typeName === "array") {
      options[flagName] = { type: "string", multiple: true };
    } else {
      options[flagName] = { type: "string" };
    }
  }

  /** Register aliases so parseArgs recognizes them */
  if (aliases) {
    for (const [aliasName, targetName] of Object.entries(aliases)) {
      const aliasFlag = toKebabCase(aliasName);
      if (!(aliasFlag in options)) {
        const targetFlag = toKebabCase(targetName);
        const targetOption = options[targetFlag];
        if (targetOption) {
          options[aliasFlag] = { ...targetOption };
        } else {
          options[aliasFlag] = { type: "string" };
        }
      }
    }
  }

  return options;
}
