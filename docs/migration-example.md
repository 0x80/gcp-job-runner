# Database Migration Example

This example shows a typical real-world use case: running a Firestore database migration that adds a new field to all user documents.

## The Migration Job

The job uses typed Firestore collection references from a shared package (see [@typed-firestore](https://github.com/0x80/typed-firestore) for details) and initializes `enableBetaFeatures` for all users who don't have it yet:

```typescript
// src/jobs/database/init-user-enable-beta.ts
import { defineJob } from "gcp-job-runner";
import { processDocuments } from "@typed-firestore/server";
import { refs } from "@repo/common/db-refs";

export default defineJob({
  description: "Initialize enableBetaFeatures for all users",
  handler: async () => {
    let count = 0;
    await processDocuments(refs.users, null, async (doc) => {
      if (doc.data.enableBetaFeatures === undefined) {
        await doc.update({ enableBetaFeatures: false });
        count++;
      }
    });
    console.log(`Updated ${count} users`);
  },
});
```

## Run It

Run the migration against your staging environment:

```bash
npx job local run stag database/init-user-enable-beta
```

When you're confident it works, target production:

```bash
npx job local run prod database/init-user-enable-beta
```

Or run it on Cloud Run for large datasets:

```bash
npx job cloud run prod database/init-user-enable-beta
```

## Key Patterns

- **Idempotency** — The `if (doc.data.enableBetaFeatures === undefined)` check makes the migration safe to run multiple times. If it fails halfway, you can simply re-run it.
- **Pagination** — `processDocuments` handles Firestore's pagination internally, so you don't need to manage batch reads yourself.
- **No schema needed** — This job takes no arguments, so there's no `schema` definition. The runner handles it as a zero-argument job.
- **Environment targeting** — `GOOGLE_CLOUD_PROJECT` is set from your runner config, so the same code runs against staging or production depending on the environment you choose.
