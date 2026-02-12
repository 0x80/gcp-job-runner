/** Normalized execution data used internally */
export interface GcloudExecution {
  /** Full resource name: projects/P/locations/R/jobs/J/executions/EXEC */
  name: string;
  uid: string;
  completionTime?: string;
  startTime?: string;
  conditions?: Array<{
    type: string;
    state: string;
    message?: string;
  }>;
  succeededCount?: number;
  failedCount?: number;
  logUri?: string;
}

/**
 * Raw v1 (Knative) response from gcloud Cloud Run commands.
 * Fields are nested under `metadata`, `status`, and `spec`.
 */
interface GcloudV1Response {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    [key: string]: unknown;
  };
  status?: {
    completionTime?: string;
    startTime?: string;
    conditions?: Array<{
      type: string;
      state: string;
      message?: string;
    }>;
    succeededCount?: number;
    failedCount?: number;
    logUri?: string;
  };
}

/**
 * Parse a gcloud response into a normalized GcloudExecution.
 * Handles both the v1 (Knative) format and a potential flat format.
 */
export function parseExecution(
  response: unknown,
  context?: { project: string; region: string; jobName: string },
): GcloudExecution | undefined {
  if (!response || typeof response !== "object") return undefined;

  const record = response as Record<string, unknown>;

  /** Check if this is a v1 (Knative) response with metadata/status nesting */
  if (record.apiVersion && record.metadata) {
    const v1 = response as GcloudV1Response;
    const shortName = v1.metadata.name;

    const name = context
      ? `projects/${context.project}/locations/${context.region}/jobs/${context.jobName}/executions/${shortName}`
      : shortName;

    return {
      name,
      uid: (v1.metadata.uid as string) ?? "",
      completionTime: v1.status?.completionTime,
      startTime: v1.status?.startTime,
      conditions: v1.status?.conditions,
      succeededCount: v1.status?.succeededCount,
      failedCount: v1.status?.failedCount,
      logUri: v1.status?.logUri,
    };
  }

  /** Assume flat format */
  const flat = response as GcloudExecution;
  if (flat.name) return flat;

  return undefined;
}
