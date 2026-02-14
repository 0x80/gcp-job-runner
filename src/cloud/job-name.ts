/**
 * Cloud Run Job resource name limit.
 * @see https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs
 */
const MAX_JOB_NAME_LENGTH = 63;

/**
 * Derive a Cloud Run Job resource name from a script name.
 *
 * Cloud Run Job names must start with a lowercase letter, contain only
 * lowercase letters, digits, and hyphens, and be at most 63 characters.
 *
 * Sanitization rules:
 * - Replace `/` with `-` (e.g., `admin/create-user` → `admin-create-user`)
 * - Lowercase all characters
 * - Strip characters that are not lowercase alphanumeric or hyphens
 * - Collapse consecutive hyphens into a single hyphen
 * - Strip leading digits and hyphens (name must start with a letter)
 * - Remove trailing hyphens
 * - Truncate to 63 characters (Cloud Run name limit)
 * - Ensure name doesn't end with a hyphen after truncation
 *
 * @throws {Error} if the script name produces an empty job name after sanitization
 */
export function deriveJobResourceName(scriptName: string): string {
  let name = scriptName
    .replace(/\//g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "");

  if (name.length > MAX_JOB_NAME_LENGTH) {
    name = name.slice(0, MAX_JOB_NAME_LENGTH).replace(/-+$/, "");
  }

  if (name.length === 0) {
    throw new Error(
      `Cannot derive a valid Cloud Run Job name from script "${scriptName}". ` +
        "The name must contain at least one letter.",
    );
  }

  return name;
}
