import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineJob } from "./define-job";
import { getFileWriter } from "./files";

/**
 * Exercises the full public-API path a job author would use: `defineJob`
 * composes the handler, the runner sets `JOB_FILES_PATH` (simulated here),
 * and the handler writes files via `getFileWriter`. Catches regressions
 * where the two pieces are individually correct but don't compose.
 */
describe("files integration", () => {
  let tempDir: string;
  const originalFilesPath = process.env.JOB_FILES_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "files-integration-"));
    process.env.JOB_FILES_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalFilesPath === undefined) {
      delete process.env.JOB_FILES_PATH;
    } else {
      process.env.JOB_FILES_PATH = originalFilesPath;
    }
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

    expect(readFileSync(path.join(tempDir, "report.json"), "utf-8")).toBe(
      '{\n  "count": 42\n}\n',
    );
    expect(readFileSync(path.join(tempDir, "report.csv"), "utf-8")).toBe(
      "id,count\n1,42\n",
    );
  });

  it("surfaces config errors to the handler caller", async () => {
    delete process.env.JOB_FILES_PATH;

    const job = defineJob({
      handler: async () => {
        getFileWriter();
      },
    });

    await expect(job([], "missing-config")).rejects.toThrow(/filesPath/);
  });

  it("writes to nested directories declared in the relative path", async () => {
    const job = defineJob({
      handler: async () => {
        const files = getFileWriter();
        await files.writeJson("db/airlines/UA.json", { iata: "UA" });
      },
    });

    await job([], "nested");

    const fullPath = path.join(tempDir, "db", "airlines", "UA.json");
    expect(readFileSync(fullPath, "utf-8")).toContain('"iata": "UA"');
  });
});
