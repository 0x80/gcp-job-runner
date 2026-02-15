import { afterEach, describe, expect, it, vi } from "vitest";
import { getTaskContext } from "./task-context";

describe("getTaskContext", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns defaults when env vars are absent", () => {
    delete process.env.CLOUD_RUN_TASK_INDEX;
    delete process.env.CLOUD_RUN_TASK_COUNT;

    const context = getTaskContext();

    expect(context).toEqual({ taskIndex: 0, taskCount: 1 });
  });

  it("reads values from env vars", () => {
    vi.stubEnv("CLOUD_RUN_TASK_INDEX", "3");
    vi.stubEnv("CLOUD_RUN_TASK_COUNT", "10");

    const context = getTaskContext();

    expect(context).toEqual({ taskIndex: 3, taskCount: 10 });
  });

  it("falls back to defaults when only CLOUD_RUN_TASK_INDEX is set", () => {
    vi.stubEnv("CLOUD_RUN_TASK_INDEX", "2");
    delete process.env.CLOUD_RUN_TASK_COUNT;

    const context = getTaskContext();

    expect(context).toEqual({ taskIndex: 2, taskCount: 1 });
  });

  it("falls back to defaults when only CLOUD_RUN_TASK_COUNT is set", () => {
    delete process.env.CLOUD_RUN_TASK_INDEX;
    vi.stubEnv("CLOUD_RUN_TASK_COUNT", "5");

    const context = getTaskContext();

    expect(context).toEqual({ taskIndex: 0, taskCount: 5 });
  });
});
