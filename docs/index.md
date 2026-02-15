---
layout: home

hero:
  name: GCP Job Runner
  text: Focus on the job
  tagline: Run jobs seamlessly on your local machine and on Cloud Run. Simple code, zero boilerplate.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Cloud Jobs
      link: /cloud-jobs

features:
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 11 12 14 22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    title: Zod Validation
    details: Define job arguments with Zod schemas. Input is validated before your handler runs, with auto-generated --help for every job.
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" x2="6.01" y1="6" y2="6"/>
        <line x1="6" x2="6.01" y1="18" y2="18"/>
      </svg>
    title: Run Locally or in the Cloud
    details: Switch between local and Cloud Run execution with a single word. The same code runs in both environments with the same secrets.
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    title: Smart Image Caching
    details: A single Docker image contains all your jobs. Only source code changes trigger a rebuild — running different jobs or different arguments is instant.
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    title: GCP Secret Manager
    details: Secrets are loaded from Secret Manager automatically. The execution environment is transparent — same secrets for local and cloud.
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="2" x2="5" y1="12" y2="12"/>
        <line x1="19" x2="22" y1="12" y2="12"/>
        <line x1="12" x2="12" y1="2" y2="5"/>
        <line x1="12" x2="12" y1="19" y2="22"/>
        <circle cx="12" cy="12" r="7"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    title: Monorepo Support
    details: Workspace dependencies are automatically isolated into a standalone deployable package. No manual bundling or Docker configuration needed.
  - icon: |
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" x2="20" y1="19" y2="19"/>
      </svg>
    title: Interactive Mode
    details: Browse and select jobs interactively. Argument prompts adapt to schema types — text inputs, selects for enums, confirmations for booleans.
---

## Quick Look

Define a job with a Zod schema:

```typescript
import { z } from "zod";
import { defineJob } from "gcp-job-runner";

export default defineJob({
  description: "Count down and exit",
  schema: z.object({
    seconds: z.number().default(10).describe("Number of seconds to count down"),
  }),
  handler: async ({ seconds }) => {
    for (let i = seconds; i > 0; i--) {
      console.log(`${i}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("Done!");
  },
});
```

Run it locally:

```bash
job local run stag countdown --seconds 5
```

Run it on Cloud Run:

```bash
job cloud run stag countdown --seconds 5
```

The cloud command builds a Docker image, pushes it to Artifact Registry, and streams logs back to your terminal. Images are cached by content hash — if your code hasn't changed, there's no rebuild, no deploy, straight to execution.

For a more realistic example, see the [database migration example](/migration-example) — a Firestore migration job that demonstrates idempotent updates, pagination, and environment targeting.
