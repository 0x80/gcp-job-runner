import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLocalFilesPath } from "./config";

const SERVICE_DIR = "/srv/my-service";

describe("resolveLocalFilesPath", () => {
  it("returns undefined when neither localFilesPath nor filesPath is set", () => {
    expect(resolveLocalFilesPath({}, {}, SERVICE_DIR)).toBeUndefined();
  });

  it("prefers localFilesPath over env.filesPath", () => {
    const result = resolveLocalFilesPath(
      { localFilesPath: "./files" },
      { filesPath: "gs://stag-bucket" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./files"));
  });

  it("falls back to env.filesPath when localFilesPath is unset", () => {
    const result = resolveLocalFilesPath(
      {},
      { filesPath: "./files" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./files"));
  });

  it("resolves relative paths against the service directory", () => {
    const result = resolveLocalFilesPath(
      { localFilesPath: "../../shared-files" },
      {},
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "../../shared-files"));
  });

  it("passes gs:// URIs through unchanged from localFilesPath", () => {
    const result = resolveLocalFilesPath(
      { localFilesPath: "gs://dev-bucket/prefix" },
      { filesPath: "gs://stag-bucket" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://dev-bucket/prefix");
  });

  it("passes gs:// URIs through unchanged from env.filesPath fallback", () => {
    const result = resolveLocalFilesPath(
      {},
      { filesPath: "gs://stag-bucket/sub" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://stag-bucket/sub");
  });

  it("resolves a local env.filesPath against the service directory", () => {
    const result = resolveLocalFilesPath(
      {},
      { filesPath: "./files" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./files"));
  });
});
