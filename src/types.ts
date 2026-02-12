import type { z, ZodObject, ZodRawShape } from "zod";

/** Aliases map short flag names to schema property names */
export type FlagAliases = Record<string, string>;

/** Configuration for defineJob() */
export interface JobOptions<T extends ZodRawShape = ZodRawShape> {
  /** Job description for help output */
  description?: string;
  /** Example usages */
  examples?: string[];
  /** Zod schema for argument validation (optional, defaults to empty object) */
  schema?: ZodObject<T>;
  /** Flag aliases for transforming short names to schema property names */
  aliases?: FlagAliases;
  /** CLI command prefix shown in help output (overridden by runner config at runtime) */
  commandPrefix?: string;
  /** Handler function */
  handler: (args: z.infer<ZodObject<T>>) => Promise<void>;
}

/** Metadata attached to the exported job function for discovery */
export interface JobMetadata {
  description?: string;
  /** The Zod schema used for argument validation (for interactive mode) */
  schema?: ZodObject<ZodRawShape>;
}

/** The function signature returned by defineJob() */
export interface JobFunction {
  (argv: string[], jobName: string, commandPrefix?: string): Promise<void>;
  __metadata?: JobMetadata;
}

/** Information about a discovered job */
export interface JobInfo {
  /** Job name as used in the command (e.g., "database/count-collection") */
  name: string;
  /** Description from the job options, if available */
  description?: string;
}

/** Configuration for runJob() */
export interface RunJobOptions {
  /**
   * Absolute path to the directory containing job scripts.
   * Each service provides its own jobs directory.
   */
  jobsDirectory: string;
  /**
   * Optional initialization function called before the job is loaded.
   * Use this for environment setup, secret loading, etc.
   * Skipped when the user passes --help for instant feedback.
   */
  initialize?: () => void | Promise<void>;
  /**
   * Optional custom logger. Defaults to console.
   * Accepts both console and structured loggers (e.g., pino, winston).
   */
  logger?: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  /**
   * The CLI command prefix shown in help output (e.g., "pnpm cli:stag").
   */
  commandPrefix?: string;
}
