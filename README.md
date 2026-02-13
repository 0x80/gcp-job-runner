# gcp-job-runner

Run schema-driven Cloud Run jobs seamlessly in any environment.

## Quick Look

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

Same code, same arguments, same secrets. The cloud command automatically builds a Docker image, pushes it to Artifact Registry, and streams logs back to your terminal. Images are cached by content hash — only source code changes trigger a rebuild.

## Features

- **Zod validation** — arguments are validated before your handler runs, with auto-generated `--help` for every job
- **Interactive mode** — browse jobs and fill in arguments interactively with `--interactive`
- **Cloud Run deployment** — no Terraform or manual GCP config needed, just `job cloud run`
- **Smart caching** — a single Docker image contains all jobs; running different jobs or different arguments doesn't rebuild
- **GCP Secret Manager** — secrets are loaded transparently for both local and cloud execution
- **Multi-environment** — configure staging, production, etc. and switch with a single argument

## Install

```bash
npm install gcp-job-runner
```

## Documentation

Full documentation is available at [0x80.github.io/gcp-job-runner](https://0x80.github.io/gcp-job-runner/).

## License

MIT
