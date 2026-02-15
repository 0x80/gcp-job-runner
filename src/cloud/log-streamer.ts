import { Logging } from "@google-cloud/logging";
import type { Duplex } from "node:stream";
import { consola } from "consola";

interface LogStreamerOptions {
  projectId: string;
  jobName: string;
  executionName: string;
}

/**
 * Streams Cloud Logging entries to the terminal for a specific Cloud Run Job
 * execution. Uses the Live Tail API for real-time log delivery.
 */
/** Delay in ms before attempting to reconnect after a stream error */
const RECONNECT_DELAY = 1000;

/** Stop reconnecting after this many consecutive failures */
const MAX_RECONNECT_ATTEMPTS = 5;

export class LogStreamer {
  private stream: Duplex | null = null;
  private options: LogStreamerOptions;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;

  constructor(options: LogStreamerOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.consecutiveFailures = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.connect();
  }

  private connect(): void {
    const { projectId, jobName, executionName } = this.options;

    const logging = new Logging({ projectId });

    const filter = [
      `resource.type="cloud_run_job"`,
      `resource.labels.job_name="${jobName}"`,
      `labels."run.googleapis.com/execution_name"="${executionName}"`,
    ].join(" AND ");

    try {
      this.stream = logging.tailEntries({ filter });

      this.stream.on("data", (response) => {
        this.consecutiveFailures = 0;
        const entries = response.entries ?? [];
        const sorted = [...entries].sort(compareEntryTimestamps);
        for (const entry of sorted) {
          printEntry(entry);
        }
      });

      this.stream.on("error", (error: Error) => {
        consola.warn(`Log stream error: ${error.message}`);
        this.stream = null;
        this.scheduleReconnect();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consola.warn(`Failed to start log streaming: ${message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.consecutiveFailures++;

    if (this.consecutiveFailures > MAX_RECONNECT_ATTEMPTS) {
      consola.warn("Log stream reconnect failed too many times, giving up");
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        consola.info("Reconnecting log stream...");
        this.connect();
      }
    }, RECONNECT_DELAY);
  }

  /**
   * Stop the log stream. Returns a promise that resolves when the stream is
   * fully closed, with a safety timeout to prevent hanging.
   */
  stop(): Promise<void> {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    return new Promise((resolve) => {
      if (!this.stream) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        resolve();
      }, 3000);

      this.stream.on("end", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.stream.end();
      this.stream = null;
    });
  }
}

interface LogEntry {
  metadata?: {
    severity?: string;
    timestamp?: { seconds?: number; nanos?: number } | string | Date;
    textPayload?: string;
    jsonPayload?: Record<string, unknown>;
  };
  data?: unknown;
}

function printEntry(entry: LogEntry): void {
  const metadata = entry.metadata ?? {};

  const timestamp = formatTimestamp(metadata.timestamp);
  const severity = metadata.severity ?? "DEFAULT";
  const message = extractMessage(metadata, entry.data);

  if (!message) return;

  const dimStart = "\x1b[2m";
  const reset = "\x1b[0m";
  const severityColored = colorizeSeverity(severity);
  const dataFields = formatDataFields(metadata.jsonPayload);
  const dataSuffix = dataFields ? `  ${dimStart}${dataFields}${reset}` : "";

  process.stdout.write(
    `${dimStart}${timestamp}${reset} ${severityColored} ${message}${dataSuffix}\n`,
  );
}

/**
 * Compare two log entries by their timestamp for sorting within a batch.
 * Uses nanosecond precision to correctly order entries with the same second.
 */
function compareEntryTimestamps(a: LogEntry, b: LogEntry): number {
  return (
    getTimestampNanos(a.metadata?.timestamp) -
    getTimestampNanos(b.metadata?.timestamp)
  );
}

function getTimestampNanos(
  timestamp?: { seconds?: number; nanos?: number } | string | Date,
): number {
  if (!timestamp) return 0;

  if (timestamp instanceof Date) {
    return timestamp.getTime() * 1e6;
  }

  if (typeof timestamp === "string") {
    return new Date(timestamp).getTime() * 1e6;
  }

  const seconds = Number(timestamp.seconds ?? 0);
  const nanos = Number(timestamp.nanos ?? 0);
  return seconds * 1e9 + nanos;
}

function formatTimestamp(
  timestamp?: { seconds?: number; nanos?: number } | string | Date,
): string {
  if (!timestamp) return "??:??:??";

  let date: Date;

  if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === "string") {
    date = new Date(timestamp);
  } else if (timestamp.seconds) {
    date = new Date(Number(timestamp.seconds) * 1000);
  } else {
    return "??:??:??";
  }

  return date.toLocaleTimeString("en-US", { hour12: false });
}

function extractMessage(
  metadata: {
    textPayload?: string;
    jsonPayload?: Record<string, unknown>;
  },
  data?: unknown,
): string {
  if (metadata.textPayload) {
    return metadata.textPayload;
  }

  if (metadata.jsonPayload) {
    const unwrapped = unwrapProtobufStruct(metadata.jsonPayload);

    /** Skip GCP logging instrumentation diagnostic entries */
    if ("logging.googleapis.com/diagnostic" in unwrapped) {
      return "";
    }

    if (typeof unwrapped.message === "string") {
      return unwrapped.message;
    }
    return JSON.stringify(unwrapped);
  }

  if (data && typeof data === "string") {
    return data;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    /** Skip proto payloads (e.g., audit logs with binary data) */
    if ("type_url" in record) {
      return "";
    }
    return JSON.stringify(data);
  }

  return "";
}

function colorizeSeverity(severity: string): string {
  const reset = "\x1b[0m";

  switch (severity) {
    case "ERROR":
    case "CRITICAL":
    case "ALERT":
    case "EMERGENCY":
      return `\x1b[31m${severity}${reset}`;
    case "WARNING":
      return `\x1b[33m${severity}${reset}`;
    case "INFO":
    case "NOTICE":
      return `\x1b[36m${severity}${reset}`;
    default:
      return `\x1b[2m${severity}${reset}`;
  }
}

const METADATA_KEYS = new Set([
  "message",
  "severity",
  "time",
  "timestamp",
  "pid",
  "hostname",
  "level",
  "serviceContext",
]);

/**
 * Extract structured data fields from a jsonPayload, excluding known metadata
 * fields, and format them as `key=value` pairs.
 */
function formatDataFields(jsonPayload?: Record<string, unknown>): string {
  if (!jsonPayload) return "";

  const unwrapped = unwrapProtobufStruct(jsonPayload);
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(unwrapped)) {
    if (METADATA_KEYS.has(key) || key.startsWith("logging.googleapis.com/")) {
      continue;
    }
    const formatted =
      value === null || value === undefined
        ? String(value)
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value as string | number | boolean);
    pairs.push(`${key}=${formatted}`);
  }

  return pairs.join(" ");
}

/**
 * Unwrap a protobuf Struct/Value object into a plain JavaScript object.
 *
 * Cloud Logging returns payloads in protobuf Struct format where values
 * are wrapped like: `{ stringValue: "hello", kind: "stringValue" }`.
 * This function recursively converts that to `"hello"`.
 */
function unwrapProtobufStruct(
  value: Record<string, unknown>,
): Record<string, unknown> {
  /** Handle Struct: { fields: { key: Value, ... } } */
  if (
    value.fields &&
    typeof value.fields === "object" &&
    !Array.isArray(value.fields)
  ) {
    const fields = value.fields as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(fields)) {
      result[key] = unwrapProtobufValue(val);
    }
    return result;
  }

  /** Not a protobuf Struct, return as-is */
  return value;
}

function unwrapProtobufValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  const record = value as Record<string, unknown>;

  /** Protobuf Value types indicated by `kind` field */
  if ("kind" in record) {
    switch (record.kind) {
      case "stringValue":
        return record.stringValue;
      case "numberValue":
        return record.numberValue;
      case "boolValue":
        return record.boolValue;
      case "nullValue":
        return null;
      case "structValue": {
        const struct = record.structValue as Record<string, unknown>;
        return unwrapProtobufStruct(struct);
      }
      case "listValue": {
        const list = record.listValue as { values?: unknown[] };
        return (list.values ?? []).map(unwrapProtobufValue);
      }
    }
  }

  return value;
}
