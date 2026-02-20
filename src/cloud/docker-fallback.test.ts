import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { consola } from "consola";

/**
 * Mock all external dependencies so we can test the Docker detection
 * and fallback branching in prepareImage() without Docker or gcloud.
 */
vi.mock("consola", () => ({
  consola: {
    warn: vi.fn(),
    start: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn(),
  },
}));

vi.mock("./gcloud", () => ({
  checkGcloudAvailable: vi.fn(),
  isDockerInstalled: vi.fn(() => true),
  isDockerDaemonRunning: vi.fn(() => true),
  startDockerDaemon: vi.fn(() => true),
  waitForDockerDaemon: vi.fn(async () => true),
  gcloudJson: vi.fn(),
  gcloudExecCapture: vi.fn(() => ({ success: true, output: "", stderr: "" })),
  shellExecCapture: vi.fn(() => ({ success: true, output: "", stderr: "" })),
}));

vi.mock("isolate-package", () => ({
  isolate: vi.fn(async () => {}),
}));

vi.mock("./dockerfile", () => ({
  generateDockerfile: vi.fn(() => "FROM node:22"),
}));

vi.mock("./hash", () => ({
  hashDirectory: vi.fn(async () => "abc123"),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import {
  isDockerInstalled,
  isDockerDaemonRunning,
  startDockerDaemon,
  waitForDockerDaemon,
  gcloudJson,
} from "./gcloud";
import { prepareImage, type DeployOptions } from "./deploy";

const defaultOptions: DeployOptions = {
  cloud: { name: "test-job", buildLocal: true },
  envConfig: { project: "test-project" },
  serviceDirectory: "/tmp/test-service",
};

/** Stub gcloudJson to report no existing image */
function stubNoExistingImage() {
  (gcloudJson as Mock).mockReturnValue(undefined);
}

describe("prepareImage Docker fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    /** Defaults: Docker installed, daemon running, no existing image */
    (isDockerInstalled as Mock).mockReturnValue(true);
    (isDockerDaemonRunning as Mock).mockReturnValue(true);
    (startDockerDaemon as Mock).mockReturnValue(true);
    (waitForDockerDaemon as Mock).mockResolvedValue(true);
    stubNoExistingImage();
  });

  it("falls back to Cloud Build with warning when Docker is not installed", async () => {
    (isDockerInstalled as Mock).mockReturnValue(false);

    await prepareImage(defaultOptions);

    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("Docker is not installed"),
    );
    expect(isDockerDaemonRunning).not.toHaveBeenCalled();
  });

  it("builds locally when Docker is installed and daemon is running", async () => {
    await prepareImage(defaultOptions);

    expect(consola.warn).not.toHaveBeenCalled();
    expect(consola.prompt).not.toHaveBeenCalled();
  });

  describe("daemon not running, non-interactive (no TTY)", () => {
    beforeEach(() => {
      (isDockerDaemonRunning as Mock).mockReturnValue(false);
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
    });

    it("falls back to Cloud Build without prompting", async () => {
      await prepareImage(defaultOptions);

      expect(consola.prompt).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to Cloud Build"),
      );
    });
  });

  describe("daemon not running, interactive (TTY)", () => {
    beforeEach(() => {
      (isDockerDaemonRunning as Mock).mockReturnValue(false);
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });
    });

    it("prompts the user when daemon is not running", async () => {
      (consola.prompt as Mock).mockResolvedValue("cloud-build");

      await prepareImage(defaultOptions);

      expect(consola.prompt).toHaveBeenCalledWith(
        expect.stringContaining("daemon is not running"),
        expect.objectContaining({ type: "select" }),
      );
    });

    it("falls back to Cloud Build when user chooses cloud-build", async () => {
      (consola.prompt as Mock).mockResolvedValue("cloud-build");

      await prepareImage(defaultOptions);

      expect(startDockerDaemon).not.toHaveBeenCalled();
    });

    it("starts Docker and waits when user chooses start", async () => {
      (consola.prompt as Mock).mockResolvedValue("start");

      await prepareImage(defaultOptions);

      expect(startDockerDaemon).toHaveBeenCalled();
      expect(waitForDockerDaemon).toHaveBeenCalled();
    });

    it("falls back to Cloud Build when Docker fails to start", async () => {
      (consola.prompt as Mock).mockResolvedValue("start");
      (startDockerDaemon as Mock).mockReturnValue(false);

      await prepareImage(defaultOptions);

      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not start Docker automatically"),
      );
      expect(waitForDockerDaemon).not.toHaveBeenCalled();
    });

    it("falls back to Cloud Build when daemon does not become ready in time", async () => {
      (consola.prompt as Mock).mockResolvedValue("start");
      (waitForDockerDaemon as Mock).mockResolvedValue(false);

      await prepareImage(defaultOptions);

      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("did not become ready in time"),
      );
    });

    it("exits when user cancels the prompt", async () => {
      (consola.prompt as Mock).mockResolvedValue(Symbol("cancel"));

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      await expect(prepareImage(defaultOptions)).rejects.toThrow(
        "process.exit",
      );

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
