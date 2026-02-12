import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formatZodError,
  generateFullHelp,
  generateSchemaHelp,
  toKebabCase,
} from "./help";

describe("toKebabCase", () => {
  it("converts camelCase to kebab-case", () => {
    expect(toKebabCase("collectionName")).toBe("collection-name");
  });

  it("converts multi-word camelCase", () => {
    expect(toKebabCase("maxRetryCount")).toBe("max-retry-count");
  });

  it("leaves single-word strings unchanged", () => {
    expect(toKebabCase("verbose")).toBe("verbose");
  });
});

describe("formatZodError", () => {
  it("formats a single validation error", () => {
    const error = {
      issues: [{ path: ["from"], message: "Required" }],
    };
    expect(formatZodError(error)).toBe("Validation error:\n  --from: Required");
  });

  it("formats multiple validation errors", () => {
    const error = {
      issues: [
        { path: ["from"], message: "Required" },
        { path: ["to"], message: "Required" },
      ],
    };
    expect(formatZodError(error)).toBe(
      "Validation error:\n  --from: Required\n  --to: Required",
    );
  });

  it("handles errors without a path", () => {
    const error = {
      issues: [{ path: [], message: "Invalid input" }],
    };
    expect(formatZodError(error)).toBe("Validation error:\n  Invalid input");
  });
});

describe("generateSchemaHelp", () => {
  it("generates help for required string fields", () => {
    const schema = z.object({
      from: z.string().describe("Origin airport code"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--from (required)");
    expect(help).toContain("Origin airport code");
  });

  it("generates help for optional fields", () => {
    const schema = z.object({
      limit: z.number().optional().describe("Max results"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--limit <number>");
    expect(help).not.toContain("(required)");
    expect(help).toContain("Max results");
  });

  it("generates help for fields with defaults", () => {
    const schema = z.object({
      limit: z.number().default(100).describe("Max results"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--limit <number>");
    expect(help).toContain("Default: 100");
  });

  it("generates help for enum fields", () => {
    const schema = z.object({
      sortBy: z.enum(["score", "duration", "airline"]).describe("Sort order"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--sort-by");
    expect(help).toContain("Values: score, duration, airline");
  });

  it("converts camelCase field names to kebab-case flags", () => {
    const schema = z.object({
      collectionName: z.string().describe("Collection to query"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--collection-name");
  });

  it("shows type hints for non-string types", () => {
    const schema = z.object({
      count: z.number().describe("Count"),
      verbose: z.boolean().optional().describe("Verbose output"),
      items: z.array(z.string()).describe("Items"),
    });

    const help = generateSchemaHelp(schema);
    expect(help).toContain("--count <number>");
    expect(help).toContain("--verbose <boolean>");
    expect(help).toContain("--items <array>");
  });
});

describe("generateFullHelp", () => {
  it("includes description when provided", () => {
    const schema = z.object({});
    const help = generateFullHelp(schema, {
      description: "Search for flights",
    });
    expect(help).toContain("Search for flights");
  });

  it("includes usage line with command prefix", () => {
    const schema = z.object({});
    const help = generateFullHelp(schema, {
      name: "api/search",
      commandPrefix: "pnpm cli:stag",
    });
    expect(help).toContain("Usage: pnpm cli:stag api/search [options]");
  });

  it("uses default command prefix when none provided", () => {
    const schema = z.object({});
    const help = generateFullHelp(schema, {
      name: "api/search",
    });
    expect(help).toContain("Usage: job api/search [options]");
  });

  it("includes examples when provided", () => {
    const schema = z.object({});
    const help = generateFullHelp(schema, {
      examples: [
        "pnpm cli:stag api/search --from AMS",
        "pnpm cli:stag api/search --from AMS --to LHR",
      ],
    });
    expect(help).toContain("Examples:");
    expect(help).toContain("  pnpm cli:stag api/search --from AMS");
    expect(help).toContain("  pnpm cli:stag api/search --from AMS --to LHR");
  });
});
