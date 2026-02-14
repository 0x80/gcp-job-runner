/**
 * Cloud Run Job resource name limit.
 * @see https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs
 */
const MAX_JOB_NAME_LENGTH = 63;

/**
 * Derive a Cloud Run Job resource name from a script name.
 *
 * Sanitization rules:
 * - Replace `/` with `-` (e.g., `admin/create-user` → `admin-create-user`)
 * - Lowercase all characters
 * - Strip characters that are not lowercase alphanumeric or hyphens
 * - Collapse consecutive hyphens into a single hyphen
 * - Remove leading/trailing hyphens
 * - Truncate to 63 characters (Cloud Run name limit)
 * - Ensure name doesn't end with a hyphen after truncation
 */
export function deriveJobResourceName(scriptName: string): string {
  let name = scriptName
    .replace(/\//g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (name.length > MAX_JOB_NAME_LENGTH) {
    name = name.slice(0, MAX_JOB_NAME_LENGTH).replace(/-+$/, "");
  }

  return name;
}
