import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverJobs } from "./discover-jobs";

describe("discoverJobs", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = path.join(
      tmpdir(),
      `job-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDirectory, { recursive: true, force: true });
  });

  it("discovers files in the root directory", async () => {
    await writeFile(path.join(testDirectory, "count.mjs"), "");
    await writeFile(path.join(testDirectory, "export.mjs"), "");

    const jobs = await discoverJobs(testDirectory);
    expect(jobs).toEqual([{ name: "count" }, { name: "export" }]);
  });

  it("discovers files in nested directories", async () => {
    await mkdir(path.join(testDirectory, "database"), { recursive: true });
    await mkdir(path.join(testDirectory, "admin"), { recursive: true });
    await writeFile(path.join(testDirectory, "database", "count.mjs"), "");
    await writeFile(path.join(testDirectory, "admin", "create-user.mjs"), "");

    const jobs = await discoverJobs(testDirectory);
    expect(jobs).toEqual([
      { name: "admin/create-user" },
      { name: "database/count" },
    ]);
  });

  it("discovers files in deeply nested directories", async () => {
    await mkdir(path.join(testDirectory, "admin", "users"), {
      recursive: true,
    });
    await writeFile(
      path.join(testDirectory, "admin", "users", "add-credits.mjs"),
      "",
    );

    const jobs = await discoverJobs(testDirectory);
    expect(jobs).toEqual([{ name: "admin/users/add-credits" }]);
  });

  it("returns results sorted alphabetically", async () => {
    await writeFile(path.join(testDirectory, "zebra.mjs"), "");
    await writeFile(path.join(testDirectory, "alpha.mjs"), "");
    await writeFile(path.join(testDirectory, "middle.mjs"), "");

    const jobs = await discoverJobs(testDirectory);
    expect(jobs.map((j) => j.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("returns empty array for empty directory", async () => {
    const jobs = await discoverJobs(testDirectory);
    expect(jobs).toEqual([]);
  });

  it("returns empty array for non-existent directory", async () => {
    const jobs = await discoverJobs(path.join(testDirectory, "nonexistent"));
    expect(jobs).toEqual([]);
  });

  it("ignores files with wrong extension", async () => {
    await writeFile(path.join(testDirectory, "script.mjs"), "");
    await writeFile(path.join(testDirectory, "readme.md"), "");
    await writeFile(path.join(testDirectory, "config.json"), "");

    const jobs = await discoverJobs(testDirectory);
    expect(jobs).toEqual([{ name: "script" }]);
  });

  it("supports custom file extensions", async () => {
    await writeFile(path.join(testDirectory, "script.ts"), "");
    await writeFile(path.join(testDirectory, "script.mjs"), "");

    const jobs = await discoverJobs(testDirectory, ".ts");
    expect(jobs).toEqual([{ name: "script" }]);
  });
});
