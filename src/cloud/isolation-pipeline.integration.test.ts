import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

/**
 * Build a fixture package.json for gcp-job-runner by deriving it from the real
 * one. Strips isolate-package (build-time only), devDependencies, and scripts.
 */
function buildFixturePackageJson(): Record<string, unknown> {
  const real = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
  ) as Record<string, unknown>;

  const dependencies = { ...(real.dependencies as Record<string, string>) };
  delete dependencies["isolate-package"];

  return {
    name: real.name,
    version: real.version,
    type: real.type,
    files: real.files,
    exports: real.exports,
    dependencies,
  };
}

describe("isolation pipeline", () => {
  let workspaceRoot: string;
  let serviceDirectory: string;
  let isolateDirectory: string;

  beforeAll(async () => {
    /** Preconditions */
    const { exitCode } = await execa("pnpm", ["--version"], {
      reject: false,
    });
    expect(exitCode, "pnpm must be available").toBe(0);
    expect(
      existsSync(path.join(projectRoot, "dist")),
      "dist/ must exist — run pnpm build first",
    ).toBe(true);

    /** Create temp pnpm workspace */
    workspaceRoot = path.join(
      tmpdir(),
      `isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const runnerPackageDirectory = path.join(
      workspaceRoot,
      "packages/gcp-job-runner",
    );
    serviceDirectory = path.join(workspaceRoot, "packages/test-service");
    isolateDirectory = path.join(serviceDirectory, "isolate");

    await mkdir(runnerPackageDirectory, { recursive: true });
    await mkdir(path.join(serviceDirectory, "dist/jobs"), { recursive: true });

    /** Write workspace root config */
    await writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    );
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "test-workspace", private: true }, null, 2),
    );

    /** Write gcp-job-runner fixture package */
    await writeFile(
      path.join(runnerPackageDirectory, "package.json"),
      JSON.stringify(buildFixturePackageJson(), null, 2),
    );
    await cp(
      path.join(projectRoot, "dist"),
      path.join(runnerPackageDirectory, "dist"),
      { recursive: true },
    );

    /** Write test-service package */
    await writeFile(
      path.join(serviceDirectory, "package.json"),
      JSON.stringify(
        {
          name: "test-service",
          version: "0.0.0",
          private: true,
          type: "module",
          files: ["dist"],
          dependencies: {
            "gcp-job-runner": "workspace:*",
          },
        },
        null,
        2,
      ),
    );

    /** Write a minimal hello job */
    await writeFile(
      path.join(serviceDirectory, "dist/jobs/hello.mjs"),
      [
        'import { defineJob } from "gcp-job-runner";',
        "export default defineJob({",
        "  handler: async () => {",
        '    console.log("hello from isolated job");',
        "  },",
        "});",
      ].join("\n"),
    );

    /** Write isolate config for the test service */
    await writeFile(
      path.join(serviceDirectory, "isolate.config.json"),
      JSON.stringify(
        {
          buildDirName: "dist",
          includeDevDependencies: true,
        },
        null,
        2,
      ),
    );

    /** Install dependencies in the workspace */
    await execa("pnpm", ["install"], { cwd: workspaceRoot });

    /** Run isolation so all tests can assert on the output */
    const { isolate } = await import("isolate-package");

    const originalCwd = process.cwd();
    try {
      process.chdir(serviceDirectory);
      await isolate({ buildDirName: "dist", includeDevDependencies: true });
    } finally {
      process.chdir(originalCwd);
    }
  }, 120_000);

  afterAll(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("isolation produces valid output", () => {
    /** Verify isolate output structure */
    expect(existsSync(path.join(isolateDirectory, "package.json"))).toBe(true);
    expect(existsSync(path.join(isolateDirectory, "pnpm-lock.yaml"))).toBe(
      true,
    );
    expect(existsSync(path.join(isolateDirectory, "pnpm-workspace.yaml"))).toBe(
      true,
    );

    /** Build output should be copied */
    expect(existsSync(path.join(isolateDirectory, "dist/jobs/hello.mjs"))).toBe(
      true,
    );

    /** Workspace dependency should be packed */
    expect(
      existsSync(path.join(isolateDirectory, "packages/gcp-job-runner")),
    ).toBe(true);
  });

  it("pnpm install --frozen-lockfile succeeds in isolate output", async () => {
    const result = await execa("pnpm", ["install", "--frozen-lockfile"], {
      cwd: isolateDirectory,
      reject: false,
    });

    expect(result.exitCode, `pnpm install failed:\n${result.stderr}`).toBe(0);
  }, 60_000);

  it("job executes from isolated environment", async () => {
    const result = await execa(
      "node",
      ["--input-type=module", "-e", "import 'gcp-job-runner/run-cloud'"],
      {
        cwd: isolateDirectory,
        env: {
          ...process.env,
          JOB_ARGV: JSON.stringify(["hello"]),
        },
        reject: false,
      },
    );

    expect(result.exitCode, `Job execution failed:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("hello from isolated job");
  }, 30_000);
});
