import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { consola } from "consola";

const secretCache = new Map<string, string>();
let secretManagerClient: SecretManagerServiceClient | null = null;

/**
 * Determine if we should attempt to use GCP Secret Manager.
 * Returns true when running in GCP (Cloud Run, Cloud Functions) or when
 * GOOGLE_CLOUD_PROJECT is set for local development.
 */
function shouldUseSecretManager(): boolean {
  return !!(
    process.env.K_SERVICE ||
    process.env.FUNCTION_NAME ||
    process.env.GOOGLE_CLOUD_PROJECT
  );
}

/**
 * Get or create the Secret Manager client (lazy initialization).
 */
function getSecretManagerClient(): SecretManagerServiceClient {
  if (!secretManagerClient) {
    secretManagerClient = new SecretManagerServiceClient();
  }
  return secretManagerClient;
}

/**
 * Load a single secret by name.
 *
 * Resolution order:
 * 1. In-memory cache (from previous load)
 * 2. GCP Secret Manager (when running in GCP or GOOGLE_CLOUD_PROJECT is set)
 * 3. Environment variable fallback
 *
 * @param secretName - The name of the secret to load
 * @returns The secret value
 * @throws Error if the secret cannot be found
 */
export async function getSecret(secretName: string): Promise<string> {
  const cached = secretCache.get(secretName);
  if (cached) return cached;

  if (shouldUseSecretManager()) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT environment variable is not set. " +
          "Set it to your GCP project ID to use Secret Manager.",
      );
    }

    try {
      const client = getSecretManagerClient();
      const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
      });

      const value = version.payload?.data?.toString();
      if (!value) {
        throw new Error(`Secret "${secretName}" has no payload data`);
      }

      secretCache.set(secretName, value);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consola.warn(
        `Secret Manager failed for "${secretName}": ${message}. Trying environment variable.`,
      );
    }
  }

  const envValue = process.env[secretName];
  if (envValue) {
    secretCache.set(secretName, envValue);
    return envValue;
  }

  throw new Error(
    `Secret "${secretName}" not found.\n\n` +
      `Set it using one of these methods:\n` +
      `  - Environment variable: export ${secretName}=your-value\n` +
      `  - GCP Secret Manager: echo -n "your-value" | gcloud secrets create ${secretName} --data-file=-`,
  );
}

/**
 * Load multiple secrets by name.
 *
 * @param secretNames - Array of secret names to load
 * @returns Object mapping secret names to their values
 */
export async function getSecrets(
  secretNames: string[],
): Promise<Record<string, string>> {
  const secrets = await Promise.all(
    secretNames.map(async (name) => ({
      name,
      value: await getSecret(name),
    })),
  );

  return Object.fromEntries(secrets.map(({ name, value }) => [name, value]));
}

/**
 * Clear the in-memory secret cache.
 * Useful for testing or when secrets need to be reloaded.
 */
export function clearSecretCache(): void {
  secretCache.clear();
}
