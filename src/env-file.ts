import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Parse one or more .env files and return the merged key-value pairs.
 *
 * Files are processed in order. Earlier files take precedence over later ones
 * (first-wins), matching the dotenv convention.
 */
export function parseEnvFiles(
  envFile: string | string[] | undefined,
  cwd?: string,
): Record<string, string> {
  if (!envFile) return {};

  const files = Array.isArray(envFile) ? envFile : [envFile];
  const baseDir = cwd ?? process.cwd();
  const result: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.resolve(baseDir, file);

    if (!existsSync(filePath)) {
      throw new Error(
        `Environment file not found: ${file}\nResolved path: ${filePath}`,
      );
    }

    const content = readFileSync(filePath, "utf-8");
    const parsed = parseEnv(content);

    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && !Object.hasOwn(result, key)) {
        result[key] = value;
      }
    }
  }

  return result;
}
