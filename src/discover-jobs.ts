import { readdir } from "node:fs/promises";
import path from "node:path";
import type { JobInfo } from "./types";

/**
 * Discover all jobs in a jobs directory.
 *
 * Recursively walks the directory tree and finds all files with the given
 * extension. Returns job names in the "directory/filename" format used by the
 * CLI command.
 */
export async function discoverJobs(
  jobsDirectory: string,
  extension = ".mjs",
): Promise<JobInfo[]> {
  const jobs: JobInfo[] = [];
  await walkDirectory(jobsDirectory, "", extension, jobs);
  return jobs.sort((a, b) => a.name.localeCompare(b.name));
}

async function walkDirectory(
  baseDirectory: string,
  relativePath: string,
  extension: string,
  results: JobInfo[],
): Promise<void> {
  const currentDirectory = path.join(baseDirectory, relativePath);

  let entries;
  try {
    entries = await readdir(currentDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      await walkDirectory(baseDirectory, subPath, extension, results);
    } else if (entry.name.endsWith(extension)) {
      const jobName = relativePath
        ? `${relativePath}/${entry.name.replace(extension, "")}`
        : entry.name.replace(extension, "");
      results.push({ name: jobName });
    }
  }
}
