import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Compute a SHA-256 hash of all files in a directory (recursively).
 *
 * Both file paths (relative to the directory) and file contents are included
 * in the hash. Files are sorted alphabetically for determinism.
 *
 * Returns a 12-character hex string suitable for use as a Docker image tag.
 */
export async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await getFilesRecursive(directory);

  for (const file of files.sort()) {
    /** Include the relative path so renames are detected */
    const relativePath = path.relative(directory, file);
    hash.update(relativePath);
    hash.update(await readFile(file));
  }

  return hash.digest("hex").substring(0, 12);
}

/**
 * Recursively collect all file paths in a directory.
 */
async function getFilesRecursive(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      const nested = await getFilesRecursive(fullPath);
      files.push(...nested);
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
