import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";
import { z } from "zod";
import type { Storage } from "@google-cloud/storage";

/**
 * Writer for job output files, produced by `getFileWriter()`. A single
 * writer instance targets the destination configured via the
 * `outputFilesPath` runner option (local directory or `gs://` URI). All
 * methods return the resolved absolute path or `gs://` URI of the written
 * file.
 */
export interface FileWriter {
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
 * Return the resolved input files destination — where the job reads from.
 * Local paths are resolved to an absolute filesystem path; `gs://` URIs
 * are validated and canonicalized (trailing slashes stripped). Use this
 * to locate fixtures, reference datasets, or files produced by another
 * job, and read them with `node:fs` or `@google-cloud/storage` directly.
 *
 * Throws when no input destination is configured or the configured
 * `gs://` URI is malformed (e.g. missing bucket).
 */
export function getInputFilesPath(): string {
  return resolveDestination(readInputDestination());
}

/**
 * Return the resolved output files destination — where `getFileWriter()`
 * writes to. Local paths are resolved to an absolute filesystem path;
 * `gs://` URIs are validated and canonicalized (trailing slashes
 * stripped). Useful when a job needs to read back its own artifacts
 * (e.g., to chain steps within a handler) or pass the destination to
 * another tool.
 *
 * Throws when no output destination is configured or the configured
 * `gs://` URI is malformed (e.g. missing bucket).
 */
export function getOutputFilesPath(): string {
  return resolveDestination(readOutputDestination());
}

/**
 * Return a writer that persists files to the destination configured via
 * the `outputFilesPath` runner option. Local paths are used for local
 * execution; `gs://bucket[/prefix]` URIs are used for Cloud Run
 * deployments.
 *
 * Throws when no output destination is configured.
 */
export function getFileWriter(): FileWriter {
  const destination = readOutputDestination();

  if (destination.startsWith(GCS_PREFIX)) {
    return createGcsWriter(destination);
  }

  return createLocalWriter(destination);
}

/**
 * Mark a Zod string field as a file input. Interactive mode detects this
 * marker and offers a selectable list of files from `getInputFilesPath()`
 * instead of a free-text prompt.
 *
 * ```ts
 * z.object({
 *   file: fileInput().describe("CSV to process"),
 * });
 * ```
 *
 * Chains with `.describe()`, `.optional()`, `.default()` as usual.
 */
export function fileInput() {
  return z.string().meta({ kind: "file" });
}

/**
 * List filenames available under the configured input files destination.
 * Returns names relative to the destination directory (no leading slash).
 * Results are sorted alphabetically.
 *
 * Local destinations list only top-level files (nested directories are
 * skipped for now). `gs://` destinations list every object under the
 * configured prefix.
 *
 * Throws when no input destination is configured.
 */
export async function listInputFiles(): Promise<string[]> {
  const destination = readInputDestination();
  if (destination.startsWith(GCS_PREFIX)) {
    return listGcsFiles(destination);
  }
  return listLocalFiles(path.resolve(destination));
}

async function listLocalFiles(basePath: string): Promise<string[]> {
  const entries = await readdir(basePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

async function listGcsFiles(uri: string): Promise<string[]> {
  const { bucket, prefix } = parseGcsUri(uri);
  const storage = await getStorageClient();
  const [files] = await storage.bucket(bucket).getFiles({
    prefix: prefix || undefined,
  });

  /**
   * `file.name` is a full object key including the prefix. Strip the
   * prefix (plus the separator) so callers receive a name relative to
   * the configured destination, mirroring how the writer addresses
   * objects.
   */
  const stripLen = prefix ? prefix.length + 1 : 0;

  return files
    .map((file) => file.name.slice(stripLen))
    .filter((name) => name.length > 0 && !name.endsWith("/"))
    .sort();
}

function resolveDestination(destination: string): string {
  if (destination.startsWith(GCS_PREFIX)) {
    /**
     * Validate and canonicalize via the same parser the writer uses, so
     * read and write paths stay consistent — reject `gs://` without a
     * bucket and strip any trailing slash from the prefix.
     */
    const { bucket, prefix } = parseGcsUri(destination);
    return prefix
      ? `${GCS_PREFIX}${bucket}/${prefix}`
      : `${GCS_PREFIX}${bucket}`;
  }
  return path.resolve(destination);
}

function readInputDestination(): string {
  const destination = process.env.JOB_INPUT_FILES_PATH;

  if (!destination) {
    throw new Error(
      "No input files destination configured.\n" +
        "Set `localInputFilesPath` or the current environment's " +
        "`inputFilesPath` in your job-runner.config.ts, or set " +
        "JOB_INPUT_FILES_PATH directly in the environment.",
    );
  }

  return destination;
}

function readOutputDestination(): string {
  const destination = process.env.JOB_OUTPUT_FILES_PATH;

  if (!destination) {
    throw new Error(
      "No output files destination configured.\n" +
        "Set `localOutputFilesPath` or the current environment's " +
        "`outputFilesPath` in your job-runner.config.ts, or set " +
        "JOB_OUTPUT_FILES_PATH directly in the environment.",
    );
  }

  return destination;
}

function createLocalWriter(basePath: string): FileWriter {
  const resolvedBase = path.resolve(basePath);

  /** Takes an already-sanitized relative path and writes the content. */
  async function write(
    safeRelative: string,
    content: string | Uint8Array,
  ): Promise<string> {
    const fullPath = path.join(resolvedBase, safeRelative);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);

    consola.info(`File written: ${fullPath}`);
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

function createGcsWriter(uri: string): FileWriter {
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

    consola.info(`File written: ${fullUri}`);
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
    throw new Error("File path is empty");
  }

  if (path.isAbsolute(relativePath) || relativePath.startsWith("/")) {
    throw new Error(
      `File path must be relative, got "${relativePath}". ` +
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
      `File path must not traverse upward, got "${relativePath}".`,
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
