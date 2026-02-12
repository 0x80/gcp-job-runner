import {
  execFileSync,
  execSync,
  type ExecSyncOptions,
} from "node:child_process";
import { consola } from "consola";

export interface GcloudResult {
  stdout: string;
  success: boolean;
}

/**
 * Execute a gcloud command and return the parsed JSON output.
 * Throws on non-zero exit code unless `ignoreErrors` is set.
 */
export function gcloudJson<T = unknown>(
  args: string[],
  options?: { ignoreErrors?: boolean },
): T | undefined {
  const fullArgs = [...args, "--format=json"];

  try {
    const stdout = execFileSync("gcloud", fullArgs, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return JSON.parse(stdout) as T;
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
  const execOptions: ExecSyncOptions = {
    stdio: "inherit",
    ...(options?.cwd && { cwd: options.cwd }),
  };

  try {
    execFileSync("gcloud", args, execOptions);
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
  const execOptions: ExecSyncOptions = {
    stdio: "inherit",
    ...(options?.cwd && { cwd: options.cwd }),
  };

  try {
    execSync(command, execOptions);
    return true;
  } catch {
    return false;
  }
}

export interface CapturedExecResult {
  success: boolean;
  output: string;
}

/**
 * Execute a gcloud command and capture all output instead of streaming it.
 * Returns success status and captured output for the caller to handle.
 */
export function gcloudExecCapture(
  args: string[],
  options?: { cwd?: string },
): CapturedExecResult {
  try {
    const stdout = execFileSync("gcloud", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(options?.cwd && { cwd: options.cwd }),
    });
    return { success: true, output: stdout };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return {
      success: false,
      output: [stderr, stdout].filter(Boolean).join("\n"),
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
    const stdout = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(options?.cwd && { cwd: options.cwd }),
    });
    return { success: true, output: stdout };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return {
      success: false,
      output: [stderr, stdout].filter(Boolean).join("\n"),
    };
  }
}

/**
 * Check if gcloud CLI is available and authenticated.
 */
export function checkGcloudAvailable(): void {
  try {
    execFileSync("gcloud", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
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
    execFileSync("docker", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
