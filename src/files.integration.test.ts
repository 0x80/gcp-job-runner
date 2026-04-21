import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineJob } from "./define-job";
import { getFileWriter, getInputFilesPath } from "./files";

/**
 * Exercises the full public-API path a job author would use: `defineJob`
 * composes the handler, the runner sets `JOB_INPUT_FILES_PATH` and
 * `JOB_OUTPUT_FILES_PATH` (simulated here), and the handler reads inputs
 * and/or writes outputs via `getInputFilesPath` and `getFileWriter`.
 * Catches regressions where the two pieces are individually correct but
 * don't compose.
 */
describe("files integration", () => {
  let inputDir: string;
  let outputDir: string;
  const originalInputPath = process.env.JOB_INPUT_FILES_PATH;
  const originalOutputPath = process.env.JOB_OUTPUT_FILES_PATH;

  beforeEach(() => {
    inputDir = mkdtempSync(path.join(os.tmpdir(), "files-integration-input-"));
    outputDir = mkdtempSync(
      path.join(os.tmpdir(), "files-integration-output-"),
    );
    process.env.JOB_INPUT_FILES_PATH = inputDir;
    process.env.JOB_OUTPUT_FILES_PATH = outputDir;
  });

  afterEach(() => {
    rmSync(inputDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    restore("JOB_INPUT_FILES_PATH", originalInputPath);
    restore("JOB_OUTPUT_FILES_PATH", originalOutputPath);
  });

  it("writes files from inside a defineJob handler", async () => {
    const job = defineJob({
      handler: async () => {
        const files = getFileWriter();
        await files.writeJson("report.json", { count: 42 });
        await files.writeText("report.csv", "id,count\n1,42\n");
      },
    });

    await job([], "report");

    expect(readFileSync(path.join(outputDir, "report.json"), "utf-8")).toBe(
      '{\n  "count": 42\n}\n',
    );
    expect(readFileSync(path.join(outputDir, "report.csv"), "utf-8")).toBe(
      "id,count\n1,42\n",
    );
  });

  it("reads files from the configured input path", async () => {
    writeFileSync(
      path.join(inputDir, "airlines.json"),
      JSON.stringify({ iata: "UA" }),
    );

    let captured: unknown;
    const job = defineJob({
      handler: async () => {
        const base = getInputFilesPath();
        const raw = readFileSync(path.join(base, "airlines.json"), "utf-8");
        captured = JSON.parse(raw);
      },
    });

    await job([], "read-input");

    expect(captured).toEqual({ iata: "UA" });
  });

  it("surfaces missing output config errors to the handler caller", async () => {
    delete process.env.JOB_OUTPUT_FILES_PATH;

    const job = defineJob({
      handler: async () => {
        getFileWriter();
      },
    });

    await expect(job([], "missing-output")).rejects.toThrow(/outputFilesPath/);
  });

  it("surfaces missing input config errors to the handler caller", async () => {
    delete process.env.JOB_INPUT_FILES_PATH;

    const job = defineJob({
      handler: async () => {
        getInputFilesPath();
      },
    });

    await expect(job([], "missing-input")).rejects.toThrow(/inputFilesPath/);
  });

  it("writes to nested directories declared in the relative path", async () => {
    const job = defineJob({
      handler: async () => {
        const files = getFileWriter();
        await files.writeJson("db/airlines/UA.json", { iata: "UA" });
      },
    });

    await job([], "nested");

    const fullPath = path.join(outputDir, "db", "airlines", "UA.json");
    expect(readFileSync(fullPath, "utf-8")).toContain('"iata": "UA"');
  });
});

function restore(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}
