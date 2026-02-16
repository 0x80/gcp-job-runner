import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";
import type { ZodObject, ZodRawShape, ZodType } from "zod";
import { extractFieldInfo, type FieldInfo, toKebabCase } from "./help";

/**
 * Derive the source directory from the dist directory.
 * Replaces "dist" with "src" in the path.
 */
function getSourceDirectory(distDirectory: string): string {
  return distDirectory.replace(/\bdist\b/, "src");
}

/**
 * Check if a TypeScript file contains a defineJob call.
 */
async function isJobFile(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.includes("defineJob(") || content.includes("defineJob<");
  } catch {
    return false;
  }
}

/**
 * Interactively browse and select a job from the jobs source directory.
 * Returns the job name in "folder/job-name" format.
 *
 * Note: This browses the source directory (src/) not dist/, since the build
 * happens after selection. Files without defineJob are filtered out.
 */
export async function selectJob(jobsDirectory: string): Promise<string> {
  /** Browse source directory instead of dist */
  const sourceDirectory = getSourceDirectory(jobsDirectory);
  let currentPath = "";

  while (true) {
    const fullPath = path.join(sourceDirectory, currentPath);
    const entries = await readdir(fullPath, { withFileTypes: true });

    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    /** Get TypeScript files and check if they contain defineJob */
    const tsFiles = entries.filter((entry) => entry.name.endsWith(".ts"));
    const fileChecks = await Promise.all(
      tsFiles.map(async (entry) => {
        const filePath = path.join(fullPath, entry.name);
        const isJob = await isJobFile(filePath);
        return {
          name: entry.name.replace(".ts", ""),
          isJob,
        };
      }),
    );

    const choices: Array<{ label: string; value: string; hint?: string }> = [];

    if (currentPath) {
      choices.push({ label: "..", value: "back", hint: "go back" });
    }

    for (const folder of folders) {
      choices.push({ label: `${folder}/`, value: `folder:${folder}` });
    }

    /** Only show files that contain a defineJob call */
    for (const file of fileChecks) {
      if (file.isJob) {
        choices.push({ label: file.name, value: `file:${file.name}` });
      }
    }

    if (choices.length === 0) {
      consola.warn("No files found in directory");
      process.exit(1);
    }

    const prompt = currentPath
      ? `Select a job (in ${currentPath}/)`
      : "Select a job";

    const selection = await consola.prompt(prompt, {
      type: "select",
      options: choices,
    });

    if (typeof selection === "symbol") {
      consola.info("Cancelled");
      process.exit(0);
    }

    if (selection === "back") {
      currentPath = path.dirname(currentPath);
      if (currentPath === ".") currentPath = "";
      continue;
    }

    if (selection.startsWith("folder:")) {
      const folder = selection.replace("folder:", "");
      currentPath = currentPath ? `${currentPath}/${folder}` : folder;
    } else if (selection.startsWith("file:")) {
      const file = selection.replace("file:", "");
      return currentPath ? `${currentPath}/${file}` : file;
    }
  }
}

/**
 * Prompt for each field in a Zod schema.
 * Returns the collected arguments object.
 */
export async function promptForArgs<T extends ZodRawShape>(
  schema: ZodObject<T>,
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {};
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const info = extractFieldInfo(fieldSchema as ZodType);
    const value = await promptForField(key, info);

    if (value !== undefined && value !== "") {
      args[key] = value;
    }
  }

  return args;
}

/**
 * Prompt for a single field based on its type information.
 */
async function promptForField(key: string, info: FieldInfo): Promise<unknown> {
  const flagName = toKebabCase(key);
  const optionalPrefix = info.isOptional ? "(optional) " : "";
  const defaultSuffix =
    info.defaultValue !== undefined
      ? `  (default: ${JSON.stringify(info.defaultValue)})`
      : "";

  const message = info.description
    ? `${optionalPrefix}--${flagName} · ${info.description}${defaultSuffix}`
    : `${optionalPrefix}--${flagName}${defaultSuffix}`;

  /** Handle enum type with select prompt */
  if (
    info.typeName === "enum" &&
    info.enumValues &&
    info.enumValues.length > 0
  ) {
    const options = info.enumValues.map((value) => ({ label: value, value }));

    if (info.isOptional) {
      options.unshift({ label: "(skip)", value: "__skip__" });
    }

    const result = await consola.prompt(message, {
      type: "select",
      options,
      initial: info.defaultValue as string,
    });

    if (typeof result === "symbol") {
      consola.info("Cancelled");
      process.exit(0);
    }

    return result === "__skip__" ? undefined : result;
  }

  /** Handle boolean type with confirm prompt */
  if (info.typeName === "boolean") {
    const result = await consola.prompt(message, {
      type: "confirm",
      initial: (info.defaultValue as boolean) ?? false,
    });

    if (typeof result === "symbol") {
      consola.info("Cancelled");
      process.exit(0);
    }

    return result;
  }

  /** Handle array type with text prompt (comma-separated) */
  if (info.typeName === "array") {
    const arrayDescription = info.description
      ? `${info.description}, comma-separated`
      : "comma-separated values";
    const arrayMessage = `${optionalPrefix}--${flagName} · ${arrayDescription}${defaultSuffix}`;

    while (true) {
      const result = await consola.prompt(arrayMessage, {
        type: "text",
        initial: info.defaultValue
          ? (info.defaultValue as unknown[]).join(", ")
          : "",
      });

      if (typeof result === "symbol") {
        consola.info("Cancelled");
        process.exit(0);
      }

      if (!result || result.trim() === "") {
        if (!info.isOptional) {
          consola.warn("This field is required");
          continue;
        }
        return undefined;
      }

      return result
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "");
    }
  }

  /** Handle number type */
  if (info.typeName === "number") {
    const initialValue =
      typeof info.defaultValue === "number" ? String(info.defaultValue) : "";

    while (true) {
      const result = await consola.prompt(message, {
        type: "text",
        initial: initialValue,
      });

      if (typeof result === "symbol") {
        consola.info("Cancelled");
        process.exit(0);
      }

      if (!result || result.trim() === "") {
        if (!info.isOptional) {
          consola.warn("This field is required");
          continue;
        }
        return undefined;
      }

      const parsed = Number(result);
      return Number.isNaN(parsed) ? result : parsed;
    }
  }

  /** Default: string type with text prompt */
  while (true) {
    const result = await consola.prompt(message, {
      type: "text",
      initial: (info.defaultValue as string) ?? "",
    });

    if (typeof result === "symbol") {
      consola.info("Cancelled");
      process.exit(0);
    }

    if (!result) {
      if (!info.isOptional) {
        consola.warn("This field is required");
        continue;
      }
      return undefined;
    }

    return result;
  }
}
