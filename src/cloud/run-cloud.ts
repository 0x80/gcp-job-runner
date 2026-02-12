import path from "node:path";
import process from "node:process";
import { runJob } from "../run-job";

/**
 * Entry point for running a job inside a Cloud Run Job container.
 *
 * Convention:
 * - Jobs directory: `dist/jobs` relative to cwd
 * - Job arguments: `JOB_ARGV` env var (JSON-encoded string array)
 *
 * If your job needs initialization (database connections, etc.), call those
 * functions at the start of your job handler.
 */
export async function runJobFromContainer(): Promise<void> {
  const jobArgv = process.env.JOB_ARGV;

  if (jobArgv) {
    const argv = JSON.parse(jobArgv) as string[];
    process.argv = [process.argv[0]!, process.argv[1]!, ...argv];
  }

  const jobsDirectory = path.resolve(process.cwd(), "dist/jobs");

  await runJob({ jobsDirectory });
}

/** Auto-execute when this module is the entrypoint */
await runJobFromContainer();
