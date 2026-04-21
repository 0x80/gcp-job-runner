import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";
import type { Storage } from "@google-cloud/storage";

/**
 * Writer for job artifacts, produced by `getExportsWriter()`. A single writer
 * instance targets a destination configured via the `exportsPath` runner
 * option (local directory or `gs://` URI). All methods return the resolved
 * absolute path or `gs://` URI of the written artifact.
 */
export interface ExportsWriter {
  /**
   * Write a value as pretty-printed JSON (2-space indent, trailing newline).
   * The `.json` extension is added if missing.
   */
  writeJson(relativePath: string, data: unknown): Promise<string>;
  /** Write a UTF-8 string (e.g. CSV, SVG, plain text). */
  writeText(relativePath: string, content: string): Promise<string>;
  /** Write a binary buffer. */
  writeBuffer(
    relativePath: string,
    content: Buffer | Uint8Array,
  ): Promise<string>;
}

const GCS_PREFIX = "gs://";

/**
 * Return a writer that persists artifacts to the destination configured via
 * the `exportsPath` runner option. Local paths are used for local execution;
 * `gs://bucket[/prefix]` URIs are used for Cloud Run deployments.
 *
 * Throws when no destination is configured.
 */
export function getExportsWriter(): ExportsWriter {
  const destination = process.env.JOB_EXPORTS_PATH;

  if (!destination) {
    throw new Error(
      "No exports destination configured.\n" +
        "Set `localExportsPath` or the current environment's `exportsPath` " +
        "in your job-runner.config.ts, or set JOB_EXPORTS_PATH directly in " +
        "the environment.",
    );
  }

  if (destination.startsWith(GCS_PREFIX)) {
    return createGcsWriter(destination);
  }

  return createLocalWriter(destination);
}

function createLocalWriter(basePath: string): ExportsWriter {
  const resolvedBase = path.resolve(basePath);

  /** Takes an already-sanitized relative path and writes the content. */
  async function write(
    safeRelative: string,
    content: string | Uint8Array,
  ): Promise<string> {
    const fullPath = path.join(resolvedBase, safeRelative);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);

    consola.info(`Export written: ${fullPath}`);
    return fullPath;
  }

  return {
    async writeJson(relativePath, data) {
      /** Sanitize before appending the extension so "" doesn't become ".json". */
      const withExtension = ensureExtension(
        sanitizeRelativePath(relativePath),
        ".json",
      );
      return write(withExtension, formatJson(data));
    },
    async writeText(relativePath, content) {
      return write(sanitizeRelativePath(relativePath), content);
    },
    async writeBuffer(relativePath, content) {
      return write(sanitizeRelativePath(relativePath), content);
    },
  };
}

interface GcsTarget {
  bucket: string;
  prefix: string;
}

function createGcsWriter(uri: string): ExportsWriter {
  const target = parseGcsUri(uri);

  /** Takes an already-sanitized relative path and uploads the content. */
  async function write(
    safeRelative: string,
    content: string | Buffer | Uint8Array,
    contentType: string,
  ): Promise<string> {
    const objectName = joinGcsPath(target.prefix, safeRelative);
    const fullUri = `${GCS_PREFIX}${target.bucket}/${objectName}`;

    const storage = await getStorageClient();
    const file = storage.bucket(target.bucket).file(objectName);

    const body =
      typeof content === "string" || Buffer.isBuffer(content)
        ? content
        : Buffer.from(content);

    await file.save(body, {
      contentType,
      resumable: false,
    });

    consola.info(`Export written: ${fullUri}`);
    return fullUri;
  }

  return {
    async writeJson(relativePath, data) {
      /** Sanitize before appending the extension so "" doesn't become ".json". */
      const withExtension = ensureExtension(
        sanitizeRelativePath(relativePath),
        ".json",
      );
      return write(withExtension, formatJson(data), "application/json");
    },
    async writeText(relativePath, content) {
      const safe = sanitizeRelativePath(relativePath);
      return write(safe, content, contentTypeFor(safe));
    },
    async writeBuffer(relativePath, content) {
      return write(
        sanitizeRelativePath(relativePath),
        content,
        "application/octet-stream",
      );
    },
  };
}

/**
 * Lazy Storage client singleton. The `@google-cloud/storage` module is only
 * loaded when a `gs://` destination is actually used for a write.
 */
let storageClient: Storage | null = null;
async function getStorageClient(): Promise<Storage> {
  if (storageClient) return storageClient;
  const { Storage: StorageCtor } = await import("@google-cloud/storage");
  storageClient = new StorageCtor();
  return storageClient;
}

function parseGcsUri(uri: string): GcsTarget {
  const withoutScheme = uri.slice(GCS_PREFIX.length);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex === -1) {
    if (!withoutScheme) {
      throw new Error(`Invalid GCS URI: "${uri}" (missing bucket name)`);
    }
    return { bucket: withoutScheme, prefix: "" };
  }

  const bucket = withoutScheme.slice(0, slashIndex);
  const prefix = withoutScheme.slice(slashIndex + 1).replace(/\/+$/, "");

  if (!bucket) {
    throw new Error(`Invalid GCS URI: "${uri}" (missing bucket name)`);
  }

  return { bucket, prefix };
}

function joinGcsPath(prefix: string, relative: string): string {
  const normalizedRelative = relative.replace(/^\/+/, "");
  return prefix ? `${prefix}/${normalizedRelative}` : normalizedRelative;
}

function sanitizeRelativePath(relativePath: string): string {
  if (!relativePath || relativePath.trim() === "") {
    throw new Error("Export path is empty");
  }

  if (path.isAbsolute(relativePath) || relativePath.startsWith("/")) {
    throw new Error(
      `Export path must be relative, got "${relativePath}". ` +
        "Absolute paths are not allowed.",
    );
  }

  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));

  /**
   * Reject `..` only as a distinct path segment, not as a prefix. A filename
   * like "..hidden" is a legitimate dotfile variant, while ".." / "../x" /
   * "a/../../x" all produce a `..` segment after normalization.
   */
  if (normalized.split("/").includes("..")) {
    throw new Error(
      `Export path must not traverse upward, got "${relativePath}".`,
    );
  }

  return normalized;
}

function ensureExtension(relativePath: string, extension: string): string {
  return relativePath.endsWith(extension)
    ? relativePath
    : `${relativePath}${extension}`;
}

function formatJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const TEXT_CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".md": "text/markdown; charset=utf-8",
};

function contentTypeFor(relativePath: string): string {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return TEXT_CONTENT_TYPES[ext] ?? "text/plain; charset=utf-8";
}
