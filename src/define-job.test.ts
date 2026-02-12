import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { consola } from "consola";
import { defineJob } from "./define-job";

describe("defineJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls handler with validated args", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        name: z.string(),
      }),
      handler,
    });

    await job(["--name", "test"], "test-job");
    expect(handler).toHaveBeenCalledWith({ name: "test" });
  });

  it("calls handler with empty object when no schema is provided", async () => {
    const handler = vi.fn();
    const job = defineJob({ handler });

    await job([], "test-job");
    expect(handler).toHaveBeenCalledWith({});
  });

  it("prints help and does not call handler on --help", async () => {
    const handler = vi.fn();
    const boxSpy = vi.spyOn(consola, "box").mockImplementation(() => {});
    const job = defineJob({
      description: "A test job",
      schema: z.object({
        name: z.string().describe("Your name"),
      }),
      handler,
    });

    await job(["--help"], "test-job");
    expect(handler).not.toHaveBeenCalled();
    expect(boxSpy).toHaveBeenCalled();
    const helpOutput = boxSpy.mock.calls[0]?.[0] as string;
    expect(helpOutput).toContain("A test job");
    expect(helpOutput).toContain("--name");
    expect(helpOutput).toContain("Your name");
  });

  it("exits with code 1 on validation error", async () => {
    const handler = vi.fn();
    const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    const job = defineJob({
      schema: z.object({
        name: z.string(),
      }),
      handler,
    });

    await expect(job([], "test-job")).rejects.toThrow("process.exit(1)");
    expect(handler).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("rejects unknown flags in strict mode", async () => {
    const handler = vi.fn();
    vi.spyOn(consola, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    const job = defineJob({
      schema: z.object({
        name: z.string(),
      }),
      handler,
    });

    await expect(
      job(["--name", "test", "--unknown", "value"], "test-job"),
    ).rejects.toThrow("process.exit(1)");
    expect(handler).not.toHaveBeenCalled();
  });

  it("coerces string values to numbers when schema expects number", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        limit: z.number(),
      }),
      handler,
    });

    await job(["--limit", "42"], "test-job");
    expect(handler).toHaveBeenCalledWith({ limit: 42 });
  });

  it("wraps single values in arrays when schema expects array", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        ids: z.array(z.string()),
      }),
      handler,
    });

    await job(["--ids", "one"], "test-job");
    expect(handler).toHaveBeenCalledWith({ ids: ["one"] });
  });

  it("handles repeated flags as arrays", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        ids: z.array(z.number()),
      }),
      handler,
    });

    await job(["--ids", "1", "--ids", "2", "--ids", "3"], "test-job");
    expect(handler).toHaveBeenCalledWith({ ids: [1, 2, 3] });
  });

  it("applies aliases", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        collectionName: z.string(),
      }),
      aliases: { name: "collectionName" },
      handler,
    });

    await job(["--name", "users"], "test-job");
    expect(handler).toHaveBeenCalledWith({ collectionName: "users" });
  });

  it("handles optional fields with defaults", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        name: z.string(),
        verbose: z.boolean().optional().default(false),
      }),
      handler,
    });

    await job(["--name", "test"], "test-job");
    expect(handler).toHaveBeenCalledWith({ name: "test", verbose: false });
  });

  it("attaches metadata to the function", () => {
    const job = defineJob({
      description: "A test job",
      handler: async () => {},
    });

    expect(job.__metadata?.description).toBe("A test job");
    expect(job.__metadata?.schema).toBeDefined();
  });

  it("parses --args JSON format", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        name: z.string(),
        count: z.number(),
      }),
      handler,
    });

    await job(["--args", '{"name":"test","count":5}'], "test-job");
    expect(handler).toHaveBeenCalledWith({ name: "test", count: 5 });
  });

  it("flags override --args JSON values", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        name: z.string(),
        count: z.number(),
      }),
      handler,
    });

    await job(
      ["--args", '{"name":"json","count":5}', "--name", "flag"],
      "test-job",
    );
    expect(handler).toHaveBeenCalledWith({ name: "flag", count: 5 });
  });

  it("handles boolean flags without values", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        name: z.string(),
        verbose: z.boolean().optional().default(false),
      }),
      handler,
    });

    await job(["--name", "test", "--verbose"], "test-job");
    expect(handler).toHaveBeenCalledWith({ name: "test", verbose: true });
  });

  it("coerces numbers through optional().default() wrappers", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        limit: z.number().optional().default(10),
      }),
      handler,
    });

    await job(["--limit", "42"], "test-job");
    expect(handler).toHaveBeenCalledWith({ limit: 42 });
  });

  it("converts kebab-case flags to camelCase", async () => {
    const handler = vi.fn();
    const job = defineJob({
      schema: z.object({
        startDate: z.string(),
      }),
      handler,
    });

    await job(["--start-date", "2024-01-01"], "test-job");
    expect(handler).toHaveBeenCalledWith({ startDate: "2024-01-01" });
  });
});
