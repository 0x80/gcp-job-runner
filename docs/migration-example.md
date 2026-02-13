# Database Migration Example

This example shows a typical real-world use case: running a Firestore database migration that adds a new field to all user documents.

## Define Typed Refs

First, set up Firebase Admin and define typed collection references:

```typescript
// src/db-refs.ts
import {
  getFirestore,
  type CollectionReference,
} from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

const app = initializeApp();
const db = getFirestore(app);

interface UserSettings {
  name: string;
  email: string;
  wantsBetaFeatures?: boolean;
}

export const refs = {
  users: db.collection("users") as CollectionReference<UserSettings>,
};
```

Firebase Admin uses the `GOOGLE_CLOUD_PROJECT` environment variable to connect to the correct project, which gcp-job-runner sets automatically based on your target environment.

## The Migration Job

Create a job that initializes `wantsBetaFeatures` for all users who don't have it yet:

```typescript
// src/jobs/database/init-user-beta-setting.ts
import { defineJob } from "gcp-job-runner";
import { processDocuments } from "@typed-firestore/server";
import { refs } from "../../db-refs";

export default defineJob({
  description: "Initialize wantsBetaFeatures for all users",
  handler: async () => {
    let count = 0;
    await processDocuments(refs.users, null, async (doc) => {
      if (doc.data.wantsBetaFeatures === undefined) {
        await doc.update({ wantsBetaFeatures: false });
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
npx job local run stag database/init-user-beta-setting
```

When you're confident it works, target production:

```bash
npx job local run prod database/init-user-beta-setting
```

Or run it on Cloud Run for large datasets:

```bash
npx job cloud run prod database/init-user-beta-setting
```

## Key Patterns

- **Idempotency** — The `if (doc.data.wantsBetaFeatures === undefined)` check makes the migration safe to run multiple times. If it fails halfway, you can simply re-run it.
- **Pagination** — `processDocuments` handles Firestore's pagination internally, so you don't need to manage batch reads yourself.
- **No schema needed** — This job takes no arguments, so there's no `schema` definition. The runner handles it as a zero-argument job.
- **Environment targeting** — `GOOGLE_CLOUD_PROJECT` is set from your runner config, so the same code runs against staging or production depending on the environment you choose.
