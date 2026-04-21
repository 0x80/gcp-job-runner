import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";
import { getExportsWriter } from "./exports";

describe("getExportsWriter", () => {
  let tempDir: string;
  const originalExportsPath = process.env.JOB_EXPORTS_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "exports-test-"));
    process.env.JOB_EXPORTS_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalExportsPath === undefined) {
      delete process.env.JOB_EXPORTS_PATH;
    } else {
      process.env.JOB_EXPORTS_PATH = originalExportsPath;
    }
    vi.restoreAllMocks();
  });

  describe("configuration", () => {
    it("throws when JOB_EXPORTS_PATH is unset", () => {
      delete process.env.JOB_EXPORTS_PATH;
      expect(() => getExportsWriter()).toThrowError(/exportsPath/);
    });

    it("throws when JOB_EXPORTS_PATH is empty", () => {
      process.env.JOB_EXPORTS_PATH = "";
      expect(() => getExportsWriter()).toThrowError(/exportsPath/);
    });
  });

  describe("local writer", () => {
    it("writes pretty-printed JSON with trailing newline", async () => {
      const writer = getExportsWriter();
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
      const writer = getExportsWriter();
      const fullPath = await writer.writeJson("report", { ok: true });

      expect(fullPath).toBe(path.join(tempDir, "report.json"));
      expect(readFileSync(fullPath, "utf-8")).toBe('{\n  "ok": true\n}\n');
    });

    it("does not double-add .json extension", async () => {
      const writer = getExportsWriter();
      const fullPath = await writer.writeJson("report.json", { ok: true });
      expect(fullPath).toBe(path.join(tempDir, "report.json"));
    });

    it("writes text content unchanged", async () => {
      const writer = getExportsWriter();
      const csv = "id,name\n1,Alice\n2,Bob\n";
      const fullPath = await writer.writeText("users.csv", csv);

      expect(fullPath).toBe(path.join(tempDir, "users.csv"));
      expect(readFileSync(fullPath, "utf-8")).toBe(csv);
    });

    it("writes binary buffers unchanged", async () => {
      const writer = getExportsWriter();
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const fullPath = await writer.writeBuffer("icon.png", buffer);

      expect(fullPath).toBe(path.join(tempDir, "icon.png"));
      const written = readFileSync(fullPath);
      expect(written.equals(buffer)).toBe(true);
    });

    it("creates nested directories as needed", async () => {
      const writer = getExportsWriter();
      const fullPath = await writer.writeJson("db/airlines/UA.json", {
        code: "UA",
      });

      expect(fullPath).toBe(path.join(tempDir, "db", "airlines", "UA.json"));
      expect(readFileSync(fullPath, "utf-8")).toContain('"code": "UA"');
    });

    it("logs the written path", async () => {
      const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => {});
      const writer = getExportsWriter();
      await writer.writeText("a.txt", "hi");
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(tempDir, "a.txt")),
      );
    });

    it("rejects absolute paths", async () => {
      const writer = getExportsWriter();
      await expect(writer.writeText("/etc/passwd", "pwned")).rejects.toThrow(
        /Absolute paths are not allowed/,
      );
    });

    it("rejects parent-directory traversal", async () => {
      const writer = getExportsWriter();
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
      const writer = getExportsWriter();
      const fullPath = await writer.writeText("..hidden", "ok");
      expect(fullPath).toBe(path.join(tempDir, "..hidden"));
      expect(readFileSync(fullPath, "utf-8")).toBe("ok");
    });

    it("rejects empty paths", async () => {
      const writer = getExportsWriter();
      await expect(writer.writeText("", "x")).rejects.toThrow(/empty/);
      await expect(writer.writeBuffer("", Buffer.from("x"))).rejects.toThrow(
        /empty/,
      );
      await expect(writer.writeJson("", { ok: true })).rejects.toThrow(/empty/);
    });

    it("resolves relative base path to absolute", async () => {
      process.env.JOB_EXPORTS_PATH = tempDir;
      const writer = getExportsWriter();
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
      process.env.JOB_EXPORTS_PATH = "gs://my-bucket/jobs";
      vi.resetModules();
      const { getExportsWriter: freshWriter } = await import("./exports");
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
      process.env.JOB_EXPORTS_PATH = "gs://my-bucket";
      vi.resetModules();
      const { getExportsWriter: freshWriter } = await import("./exports");
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
      process.env.JOB_EXPORTS_PATH = "gs://my-bucket/artifacts";
      vi.resetModules();
      const { getExportsWriter: freshWriter } = await import("./exports");
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
      process.env.JOB_EXPORTS_PATH = "gs://";
      vi.resetModules();
      const { getExportsWriter: freshWriter } = await import("./exports");
      expect(() => freshWriter()).toThrowError(/missing bucket name/);
    });

    it("rejects traversal in GCS paths too", async () => {
      process.env.JOB_EXPORTS_PATH = "gs://my-bucket/jobs";
      vi.resetModules();
      const { getExportsWriter: freshWriter } = await import("./exports");
      const writer = freshWriter();

      await expect(writer.writeText("../secret.txt", "no")).rejects.toThrow(
        /must not traverse upward/,
      );
    });
  });
});
