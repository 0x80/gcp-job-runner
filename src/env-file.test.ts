import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvFiles } from "./env-file";

describe("parseEnvFiles", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "env-file-test-"));

    writeFileSync(
      path.join(tempDir, ".env.stag"),
      [
        "# Staging config",
        "API_URL=https://api.staging.example.com",
        "DB_HOST=staging-db",
        "SHARED=from-stag",
        "",
        "EMPTY_VALUE=",
      ].join("\n"),
    );

    writeFileSync(
      path.join(tempDir, ".env.prod"),
      [
        "API_URL=https://api.example.com",
        "DB_HOST=prod-db",
        "SHARED=from-prod",
      ].join("\n"),
    );

    writeFileSync(
      path.join(tempDir, ".env.local"),
      ["SHARED=from-local", "LOCAL_ONLY=secret"].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true });
  });

  it("returns empty object when envFile is undefined", () => {
    expect(parseEnvFiles(undefined)).toEqual({});
  });

  it("parses a single env file", () => {
    const result = parseEnvFiles(".env.stag", tempDir);

    expect(result).toEqual({
      API_URL: "https://api.staging.example.com",
      DB_HOST: "staging-db",
      SHARED: "from-stag",
      EMPTY_VALUE: "",
    });
  });

  it("applies first-wins precedence across multiple files", () => {
    const result = parseEnvFiles([".env.local", ".env.stag"], tempDir);

    expect(result.SHARED).toBe("from-local");
    expect(result.LOCAL_ONLY).toBe("secret");
    expect(result.API_URL).toBe("https://api.staging.example.com");
  });

  it("throws when a file does not exist", () => {
    expect(() => parseEnvFiles(".env.missing", tempDir)).toThrowError(
      /Environment file not found: .env.missing/,
    );
  });

  it("handles comments and blank lines", () => {
    const result = parseEnvFiles(".env.stag", tempDir);

    expect(Object.keys(result)).not.toContain("#");
    expect(result.API_URL).toBe("https://api.staging.example.com");
  });

  it("accepts a single string instead of an array", () => {
    const result = parseEnvFiles(".env.prod", tempDir);

    expect(result.API_URL).toBe("https://api.example.com");
    expect(result.DB_HOST).toBe("prod-db");
  });
});
