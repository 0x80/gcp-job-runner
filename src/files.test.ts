import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";
import { getFileWriter, getInputFilesPath, getOutputFilesPath } from "./files";

describe("getFileWriter", () => {
  let tempDir: string;
  const originalOutputPath = process.env.JOB_OUTPUT_FILES_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "files-test-"));
    process.env.JOB_OUTPUT_FILES_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalOutputPath === undefined) {
      delete process.env.JOB_OUTPUT_FILES_PATH;
    } else {
      process.env.JOB_OUTPUT_FILES_PATH = originalOutputPath;
    }
    vi.restoreAllMocks();
  });

  describe("configuration", () => {
    it("throws when JOB_OUTPUT_FILES_PATH is unset", () => {
      delete process.env.JOB_OUTPUT_FILES_PATH;
      expect(() => getFileWriter()).toThrowError(/outputFilesPath/);
    });

    it("throws when JOB_OUTPUT_FILES_PATH is empty", () => {
      process.env.JOB_OUTPUT_FILES_PATH = "";
      expect(() => getFileWriter()).toThrowError(/outputFilesPath/);
    });
  });

  describe("local writer", () => {
    it("writes pretty-printed JSON with trailing newline", async () => {
      const writer = getFileWriter();
      const fullPath = await writer.writeJson("data.json", {
        a: 1,
        b: [2, 3],
      });

      expect(fullPath).toBe(path.join(tempDir, "data.json"));
      expect(readFileSync(fullPath, "utf-8")).toBe(
        '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n',
      );
    });

    it("adds .json extension when missing", async () => {
      const writer = getFileWriter();
      const fullPath = await writer.writeJson("report", { ok: true });

      expect(fullPath).toBe(path.join(tempDir, "report.json"));
      expect(readFileSync(fullPath, "utf-8")).toBe('{\n  "ok": true\n}\n');
    });

    it("does not double-add .json extension", async () => {
      const writer = getFileWriter();
      const fullPath = await writer.writeJson("report.json", { ok: true });
      expect(fullPath).toBe(path.join(tempDir, "report.json"));
    });

    it("writes text content unchanged", async () => {
      const writer = getFileWriter();
      const csv = "id,name\n1,Alice\n2,Bob\n";
      const fullPath = await writer.writeText("users.csv", csv);

      expect(fullPath).toBe(path.join(tempDir, "users.csv"));
      expect(readFileSync(fullPath, "utf-8")).toBe(csv);
    });

    it("writes binary buffers unchanged", async () => {
      const writer = getFileWriter();
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const fullPath = await writer.writeBuffer("icon.png", buffer);

      expect(fullPath).toBe(path.join(tempDir, "icon.png"));
      const written = readFileSync(fullPath);
      expect(written.equals(buffer)).toBe(true);
    });

    it("creates nested directories as needed", async () => {
      const writer = getFileWriter();
      const fullPath = await writer.writeJson("db/airlines/UA.json", {
        code: "UA",
      });

      expect(fullPath).toBe(path.join(tempDir, "db", "airlines", "UA.json"));
      expect(readFileSync(fullPath, "utf-8")).toContain('"code": "UA"');
    });

    it("logs the written path", async () => {
      const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => {});
      const writer = getFileWriter();
      await writer.writeText("a.txt", "hi");
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(tempDir, "a.txt")),
      );
    });

    it("rejects absolute paths", async () => {
      const writer = getFileWriter();
      await expect(writer.writeText("/etc/passwd", "pwned")).rejects.toThrow(
        /Absolute paths are not allowed/,
      );
    });

    it("rejects parent-directory traversal", async () => {
      const writer = getFileWriter();
      await expect(writer.writeText("../escape.txt", "pwned")).rejects.toThrow(
        /must not traverse upward/,
      );
      await expect(
        writer.writeText("a/../../escape.txt", "pwned"),
      ).rejects.toThrow(/must not traverse upward/);
      await expect(writer.writeText("..", "pwned")).rejects.toThrow(
        /must not traverse upward/,
      );
    });

    it("allows filenames that start with two dots", async () => {
      const writer = getFileWriter();
      const fullPath = await writer.writeText("..hidden", "ok");
      expect(fullPath).toBe(path.join(tempDir, "..hidden"));
      expect(readFileSync(fullPath, "utf-8")).toBe("ok");
    });

    it("rejects empty paths", async () => {
      const writer = getFileWriter();
      await expect(writer.writeText("", "x")).rejects.toThrow(/empty/);
      await expect(writer.writeBuffer("", Buffer.from("x"))).rejects.toThrow(
        /empty/,
      );
      await expect(writer.writeJson("", { ok: true })).rejects.toThrow(/empty/);
    });

    it("resolves relative base path to absolute", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = tempDir;
      const writer = getFileWriter();
      const fullPath = await writer.writeText("x.txt", "y");
      expect(path.isAbsolute(fullPath)).toBe(true);
    });
  });

  describe("gcs writer", () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const fileMock = vi.fn(() => ({ save: saveMock }));
    const bucketMock = vi.fn(() => ({ file: fileMock }));

    beforeEach(() => {
      saveMock.mockClear();
      fileMock.mockClear();
      bucketMock.mockClear();
      vi.doMock("@google-cloud/storage", () => ({
        Storage: class {
          bucket = bucketMock;
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock("@google-cloud/storage");
      vi.resetModules();
    });

    it("routes to the configured bucket and prefix for JSON", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket/jobs";
      vi.resetModules();
      const { getFileWriter: freshWriter } = await import("./files");
      const writer = freshWriter();

      const uri = await writer.writeJson("data/flights.json", { count: 5 });

      expect(uri).toBe("gs://my-bucket/jobs/data/flights.json");
      expect(bucketMock).toHaveBeenCalledWith("my-bucket");
      expect(fileMock).toHaveBeenCalledWith("jobs/data/flights.json");
      expect(saveMock).toHaveBeenCalledWith(
        '{\n  "count": 5\n}\n',
        expect.objectContaining({
          contentType: "application/json",
          resumable: false,
        }),
      );
    });

    it("handles bucket-only URIs (no prefix)", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket";
      vi.resetModules();
      const { getFileWriter: freshWriter } = await import("./files");
      const writer = freshWriter();

      const uri = await writer.writeText("report.csv", "a,b\n1,2\n");

      expect(uri).toBe("gs://my-bucket/report.csv");
      expect(fileMock).toHaveBeenCalledWith("report.csv");
      expect(saveMock).toHaveBeenCalledWith(
        "a,b\n1,2\n",
        expect.objectContaining({ contentType: "text/csv; charset=utf-8" }),
      );
    });

    it("passes buffers through as binary", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket/artifacts";
      vi.resetModules();
      const { getFileWriter: freshWriter } = await import("./files");
      const writer = freshWriter();

      const buffer = Buffer.from([1, 2, 3]);
      const uri = await writer.writeBuffer("blob.bin", buffer);

      expect(uri).toBe("gs://my-bucket/artifacts/blob.bin");
      expect(saveMock).toHaveBeenCalledWith(
        buffer,
        expect.objectContaining({ contentType: "application/octet-stream" }),
      );
    });

    it("throws on invalid URI without bucket", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = "gs://";
      vi.resetModules();
      const { getFileWriter: freshWriter } = await import("./files");
      expect(() => freshWriter()).toThrowError(/missing bucket name/);
    });

    it("rejects traversal in GCS paths too", async () => {
      process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket/jobs";
      vi.resetModules();
      const { getFileWriter: freshWriter } = await import("./files");
      const writer = freshWriter();

      await expect(writer.writeText("../secret.txt", "no")).rejects.toThrow(
        /must not traverse upward/,
      );
    });
  });
});

describe("getInputFilesPath", () => {
  let tempDir: string;
  const originalInputPath = process.env.JOB_INPUT_FILES_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "input-files-test-"));
    process.env.JOB_INPUT_FILES_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalInputPath === undefined) {
      delete process.env.JOB_INPUT_FILES_PATH;
    } else {
      process.env.JOB_INPUT_FILES_PATH = originalInputPath;
    }
  });

  it("returns the resolved absolute path for local destinations", () => {
    expect(getInputFilesPath()).toBe(path.resolve(tempDir));
  });

  it("returns gs:// URIs in canonical form", () => {
    process.env.JOB_INPUT_FILES_PATH = "gs://my-bucket/input";
    expect(getInputFilesPath()).toBe("gs://my-bucket/input");
  });

  it("strips trailing slashes from gs:// URIs", () => {
    process.env.JOB_INPUT_FILES_PATH = "gs://my-bucket/input/";
    expect(getInputFilesPath()).toBe("gs://my-bucket/input");
  });

  it("returns bucket-only gs:// URIs without a trailing slash", () => {
    process.env.JOB_INPUT_FILES_PATH = "gs://my-bucket";
    expect(getInputFilesPath()).toBe("gs://my-bucket");
  });

  it("throws on gs:// URIs missing a bucket", () => {
    process.env.JOB_INPUT_FILES_PATH = "gs://";
    expect(() => getInputFilesPath()).toThrowError(/missing bucket name/);
  });

  it("throws when JOB_INPUT_FILES_PATH is unset", () => {
    delete process.env.JOB_INPUT_FILES_PATH;
    expect(() => getInputFilesPath()).toThrowError(/inputFilesPath/);
  });

  it("throws when JOB_INPUT_FILES_PATH is empty", () => {
    process.env.JOB_INPUT_FILES_PATH = "";
    expect(() => getInputFilesPath()).toThrowError(/inputFilesPath/);
  });
});

describe("getOutputFilesPath", () => {
  let tempDir: string;
  const originalOutputPath = process.env.JOB_OUTPUT_FILES_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "output-files-test-"));
    process.env.JOB_OUTPUT_FILES_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalOutputPath === undefined) {
      delete process.env.JOB_OUTPUT_FILES_PATH;
    } else {
      process.env.JOB_OUTPUT_FILES_PATH = originalOutputPath;
    }
  });

  it("returns the resolved absolute path for local destinations", () => {
    expect(getOutputFilesPath()).toBe(path.resolve(tempDir));
  });

  it("returns gs:// URIs in canonical form", () => {
    process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket/output";
    expect(getOutputFilesPath()).toBe("gs://my-bucket/output");
  });

  it("strips trailing slashes from gs:// URIs", () => {
    process.env.JOB_OUTPUT_FILES_PATH = "gs://my-bucket/output/";
    expect(getOutputFilesPath()).toBe("gs://my-bucket/output");
  });

  it("throws on gs:// URIs missing a bucket", () => {
    process.env.JOB_OUTPUT_FILES_PATH = "gs://";
    expect(() => getOutputFilesPath()).toThrowError(/missing bucket name/);
  });

  it("throws when JOB_OUTPUT_FILES_PATH is unset", () => {
    delete process.env.JOB_OUTPUT_FILES_PATH;
    expect(() => getOutputFilesPath()).toThrowError(/outputFilesPath/);
  });
});
