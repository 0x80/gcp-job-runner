import { execaCommandSync, execaSync } from "execa";
import { consola } from "consola";

export interface CapturedExecResult {
  success: boolean;
  output: string;
  stderr: string;
}

/**
 * Execute a gcloud command and return the parsed JSON output.
 * Throws on non-zero exit code unless `ignoreErrors` is set.
 */
export function gcloudJson<T = unknown>(
  args: string[],
  options?: { ignoreErrors?: boolean },
): T | undefined {
  try {
    const result = execaSync("gcloud", [...args, "--format=json"]);
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    if (options?.ignoreErrors) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Execute a gcloud command with stdio inherited (shows output in terminal).
 * Returns whether the command succeeded.
 */
export function gcloudExec(
  args: string[],
  options?: { cwd?: string },
): boolean {
  try {
    execaSync("gcloud", args, {
      stdio: "inherit",
      cwd: options?.cwd,
      reject: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a shell command with stdio inherited.
 * Uses shell execution for commands that need shell features (like pnpm).
 */
export function shellExec(
  command: string,
  options?: { cwd?: string },
): boolean {
  try {
    execaCommandSync(command, {
      stdio: "inherit",
      cwd: options?.cwd,
      reject: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a gcloud command and capture all output instead of streaming it.
 * Returns success status and captured stdout/stderr for the caller to handle.
 */
export function gcloudExecCapture(
  args: string[],
  options?: { cwd?: string },
): CapturedExecResult {
  try {
    const result = execaSync("gcloud", args, {
      cwd: options?.cwd,
      reject: true,
    });
    return { success: true, output: result.stdout, stderr: result.stderr };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return {
      success: false,
      output: [stderr, stdout].filter(Boolean).join("\n"),
      stderr,
    };
  }
}

/**
 * Execute a shell command and capture all output instead of streaming it.
 * Returns success status and captured output for the caller to handle.
 */
export function shellExecCapture(
  command: string,
  options?: { cwd?: string },
): CapturedExecResult {
  try {
    const result = execaCommandSync(command, {
      cwd: options?.cwd,
      reject: true,
    });
    return { success: true, output: result.stdout, stderr: result.stderr };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return {
      success: false,
      output: [stderr, stdout].filter(Boolean).join("\n"),
      stderr,
    };
  }
}

/**
 * Check if gcloud CLI is available and authenticated.
 */
export function checkGcloudAvailable(): void {
  try {
    execaSync("gcloud", ["--version"]);
  } catch {
    consola.error(
      "gcloud CLI is not installed or not in PATH.\n" +
        "Install it from: https://cloud.google.com/sdk/docs/install",
    );
    process.exit(1);
  }
}

/**
 * Check if Docker CLI is available.
 */
export function isDockerAvailable(): boolean {
  try {
    execaSync("docker", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
