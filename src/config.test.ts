import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLocalExportsPath } from "./config";

const SERVICE_DIR = "/srv/my-service";

describe("resolveLocalExportsPath", () => {
  it("returns undefined when neither localExportsPath nor exportsPath is set", () => {
    expect(resolveLocalExportsPath({}, {}, SERVICE_DIR)).toBeUndefined();
  });

  it("prefers localExportsPath over env.exportsPath", () => {
    const result = resolveLocalExportsPath(
      { localExportsPath: "./exports" },
      { exportsPath: "gs://stag-bucket" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./exports"));
  });

  it("falls back to env.exportsPath when localExportsPath is unset", () => {
    const result = resolveLocalExportsPath(
      {},
      { exportsPath: "./exports" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./exports"));
  });

  it("resolves relative paths against the service directory", () => {
    const result = resolveLocalExportsPath(
      { localExportsPath: "../../shared-exports" },
      {},
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "../../shared-exports"));
  });

  it("passes gs:// URIs through unchanged from localExportsPath", () => {
    const result = resolveLocalExportsPath(
      { localExportsPath: "gs://dev-bucket/prefix" },
      { exportsPath: "gs://stag-bucket" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://dev-bucket/prefix");
  });

  it("passes gs:// URIs through unchanged from env.exportsPath fallback", () => {
    const result = resolveLocalExportsPath(
      {},
      { exportsPath: "gs://stag-bucket/sub" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://stag-bucket/sub");
  });

  it("preserves existing behaviour when only env.exportsPath is a local path", () => {
    /** Regression guard for the 1.7.0 behaviour */
    const result = resolveLocalExportsPath(
      {},
      { exportsPath: "./exports" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./exports"));
  });
});
