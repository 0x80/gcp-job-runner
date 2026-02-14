import { describe, expect, it } from "vitest";
import { deriveJobResourceName } from "./job-name";

describe("deriveJobResourceName", () => {
  it("returns a simple script name unchanged", () => {
    expect(deriveJobResourceName("countdown")).toBe("countdown");
  });

  it("replaces slashes with hyphens for nested paths", () => {
    expect(deriveJobResourceName("admin/create-user")).toBe(
      "admin-create-user",
    );
    expect(deriveJobResourceName("database/migrate")).toBe("database-migrate");
  });

  it("handles deeply nested paths", () => {
    expect(deriveJobResourceName("a/b/c/d")).toBe("a-b-c-d");
  });

  it("lowercases the name", () => {
    expect(deriveJobResourceName("MyJob")).toBe("myjob");
    expect(deriveJobResourceName("Admin/CreateUser")).toBe("admin-createuser");
  });

  it("strips invalid characters", () => {
    expect(deriveJobResourceName("my_job!@#$%")).toBe("myjob");
    expect(deriveJobResourceName("job.name")).toBe("jobname");
  });

  it("collapses consecutive hyphens", () => {
    expect(deriveJobResourceName("a//b")).toBe("a-b");
    expect(deriveJobResourceName("a---b")).toBe("a-b");
  });

  it("removes leading and trailing hyphens", () => {
    expect(deriveJobResourceName("-leading")).toBe("leading");
    expect(deriveJobResourceName("trailing-")).toBe("trailing");
    expect(deriveJobResourceName("/leading")).toBe("leading");
  });

  it("truncates to 63 characters", () => {
    const longName = "a".repeat(100);
    const result = deriveJobResourceName(longName);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).toBe("a".repeat(63));
  });

  it("removes trailing hyphen after truncation", () => {
    const name = "a".repeat(62) + "-b";
    const result = deriveJobResourceName(name);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).toBe("a".repeat(62));
    expect(result.endsWith("-")).toBe(false);
  });
});
