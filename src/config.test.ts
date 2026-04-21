import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveLocalInputFilesPath,
  resolveLocalOutputFilesPath,
} from "./config";

const SERVICE_DIR = "/srv/my-service";

describe("resolveLocalInputFilesPath", () => {
  it("returns undefined when neither localInputFilesPath nor inputFilesPath is set", () => {
    expect(resolveLocalInputFilesPath({}, {}, SERVICE_DIR)).toBeUndefined();
  });

  it("prefers localInputFilesPath over env.inputFilesPath", () => {
    const result = resolveLocalInputFilesPath(
      { localInputFilesPath: "./input" },
      { inputFilesPath: "gs://stag-bucket/input" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./input"));
  });

  it("falls back to env.inputFilesPath when localInputFilesPath is unset", () => {
    const result = resolveLocalInputFilesPath(
      {},
      { inputFilesPath: "./input" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./input"));
  });

  it("resolves relative paths against the service directory", () => {
    const result = resolveLocalInputFilesPath(
      { localInputFilesPath: "../../shared-input" },
      {},
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "../../shared-input"));
  });

  it("passes gs:// URIs through unchanged from localInputFilesPath", () => {
    const result = resolveLocalInputFilesPath(
      { localInputFilesPath: "gs://dev-bucket/input" },
      { inputFilesPath: "gs://stag-bucket/input" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://dev-bucket/input");
  });

  it("passes gs:// URIs through unchanged from env.inputFilesPath fallback", () => {
    const result = resolveLocalInputFilesPath(
      {},
      { inputFilesPath: "gs://stag-bucket/input" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://stag-bucket/input");
  });
});

describe("resolveLocalOutputFilesPath", () => {
  it("returns undefined when neither localOutputFilesPath nor outputFilesPath is set", () => {
    expect(resolveLocalOutputFilesPath({}, {}, SERVICE_DIR)).toBeUndefined();
  });

  it("prefers localOutputFilesPath over env.outputFilesPath", () => {
    const result = resolveLocalOutputFilesPath(
      { localOutputFilesPath: "./output" },
      { outputFilesPath: "gs://stag-bucket/output" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./output"));
  });

  it("falls back to env.outputFilesPath when localOutputFilesPath is unset", () => {
    const result = resolveLocalOutputFilesPath(
      {},
      { outputFilesPath: "./output" },
      SERVICE_DIR,
    );
    expect(result).toBe(path.resolve(SERVICE_DIR, "./output"));
  });

  it("passes gs:// URIs through unchanged from localOutputFilesPath", () => {
    const result = resolveLocalOutputFilesPath(
      { localOutputFilesPath: "gs://dev-bucket/output" },
      { outputFilesPath: "gs://stag-bucket/output" },
      SERVICE_DIR,
    );
    expect(result).toBe("gs://dev-bucket/output");
  });
});
