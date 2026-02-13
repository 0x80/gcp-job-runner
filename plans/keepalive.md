# Reduce Cold Start Times: Cloud Run Service Mode

> **Status**: Research / not yet implemented. Cloud Run Jobs are typically used
> for long-running processes, so eliminating the ~2 min startup may be
> over-engineering. This document captures the research and design in case we
> revisit.

## Problem

When re-running a Cloud Run Job (without code changes), the full job startup
takes approximately **2 minutes**. This includes the entire pipeline: pulling
the container image, starting the container, installing dependencies, and
initializing the Node.js runtime. This is distinct from the "container cold
start" that GCP documentation refers to (typically 1-3 seconds) — the overhead
we observe is the full job execution startup, which is much longer.

Cloud Run Jobs **do not support `min-instances`** — every execution spins up a
fresh container and goes through this full startup sequence. The only way to
keep a container warm between runs is to deploy as a **Cloud Run Service**
instead, since Services support `min-instances` and naturally keep instances
warm for ~15 minutes after the last request.

## Research Findings

### Cloud Run Jobs vs Services for warm containers

- **Cloud Run Jobs** do NOT support `min-instances`. They are designed to run
  to completion and terminate. There is no way to keep containers warm between
  executions.
- **Cloud Run Services** support `min-instances` to keep containers warm and
  avoid cold starts. With `min-instances=0` the container still stays warm for
  ~15 minutes after the last request/ping.
- Cloud Run Jobs automatically use the second generation execution environment,
  which performs faster under sustained load but has longer cold start times
  than first generation.

### Cold start times and factors

GCP documentation refers to "cold start" as the container initialization phase
(~1-3 seconds). However, the full job startup we observe is ~2 minutes, which
includes image pull, container creation, `pnpm install`, and Node.js module
loading on top of the container cold start.

- GCP container cold start: ~1-3 seconds (with startup CPU boost: ~1 second).
- Our observed full job startup: ~2 minutes.
- Container image size is **independent** of cold start latency.
- Factors: language/runtime, startup CPU boost, app initialization, number and
  size of dependencies, dependency installation.

### Best practices (general, already applied where possible)

- Minimize dependencies, lazy load code.
- Use slim base images (`node:22-slim` already used).
- Enable startup CPU boost (can cut startup time in half).
- Parallelize startup tasks, cache in global scope.

### Key insight

The fundamental limitation is that **Cloud Run Jobs cannot keep containers warm
between executions**. If consistent low latency is critical, you need Cloud Run
Services (triggered via HTTP) or another approach.

## Ideas explored

### Idea 1: Startup CPU Boost (low-hanging fruit)

Add `--cpu-boost` flag to the `gcloud run jobs create/update` commands. This
halves cold start time with zero architectural change. Could be worth doing
regardless.

### Idea 2: Deploy as Cloud Run Service instead of Job

Deploy a Cloud Run **Service** with a minimal HTTP server. The CLI triggers job
execution via HTTP POST instead of `gcloud run jobs execute`. The service stays
warm naturally between requests.

**Trade-offs**:

- Gains `min-instances` support (even `min-instances=0` keeps the container
  warm for ~15 min after the last request).
- Loses native Cloud Run Jobs features: task tracking, execution naming,
  built-in retries, run-to-completion semantics.
- Adds an HTTP layer and more moving parts.

### Idea 3: CLI keepalive pinger (user idea)

Rather than paying for `min-instances=1`, a separate local process (or CLI
command) periodically pings the deployed service to keep the container warm.
This is "warm on demand" — the user starts the keepalive when they know they
will re-run jobs, and stops it when done.

The keepalive process does not need IPC with the main CLI; it just needs to
know the service URL (which can be cached locally after deploy) and a valid
identity token.

## Proposed Design (if implemented)

### How it works

When `cloud.keepAlive` is set in the config, the framework deploys a Cloud Run
**Service** (instead of a Job) with a minimal HTTP server. The CLI triggers job
execution via HTTP POST instead of `gcloud run jobs execute`. A separate
`job cloud keepalive <env>` command can run in the background to periodically
ping the service and prevent container eviction.

### Config addition (`src/config.ts`)

```typescript
interface CloudConfig {
  // ... existing fields ...
  /**
   * Deploy as a Cloud Run Service instead of a Job to keep the container warm
   * between executions. Set to `true` for defaults (minInstances: 0) or pass
   * an object to customize. With minInstances: 0 the container stays warm for
   * ~15 minutes after the last request/ping.
   */
  keepAlive?: boolean | { minInstances?: number };
}
```

### Container entrypoint — NEW `src/cloud/run-cloud-service.ts`

Minimal HTTP server using `node:http`:

- `POST /run` — accepts `{ argv: string[], runId: string }`, runs the job,
  returns `{ status: "success" | "error", duration: number, error?: string }`
- `GET /health` — returns 200 (used by keepalive pings and Cloud Run health
  checks)
- Listens on `process.env.PORT` (provided by Cloud Run)

Critical detail: `runJob()` in `run-job.ts` calls `process.exit()` on
completion/error. The service entrypoint must handle this by extracting the
core job execution logic into a function that returns a result instead of
calling `process.exit()`.

### New function: `executeJob()` in `src/run-job.ts`

Extract from `runJob()` a new `executeJob()` that:

- Takes `{ jobsDirectory, jobName, argv }`
- Imports and runs the job module
- Returns `{ success: boolean, error?: string }` instead of calling
  `process.exit()`
- `runJob()` becomes a thin wrapper that calls `executeJob()` and then
  `process.exit()`

### Dockerfile changes (`src/cloud/dockerfile.ts`)

`generateDockerfile()` accepts an optional `mode: 'job' | 'service'` parameter:

- `'job'` (default): current entrypoint — `import 'gcp-job-runner/run-cloud'`
- `'service'`: new entrypoint — `import 'gcp-job-runner/run-cloud-service'`

### Deploy changes (`src/cloud/deploy.ts`)

When `keepAlive` is configured:

- `generateDockerfile('service')` instead of `generateDockerfile()`
- Use `gcloud run services deploy` instead of `gcloud run jobs create/update`
- Flags: `--no-allow-unauthenticated`, `--min-instances=N`,
  `--max-instances=1`, `--concurrency=1`, `--timeout=Xs`, `--port=8080`
- Same image building and caching logic applies

The `createOrUpdateJob()` function gets a sibling `createOrUpdateService()`.

### Execute changes (`src/cloud/execute.ts`)

When `keepAlive` is configured:

1. Get service URL: `gcloud run services describe <name> --format='value(status.url)'`
2. Get identity token: `gcloud auth print-identity-token --audiences=<url>`
3. Generate a `runId` (crypto.randomUUID)
4. POST to `<url>/run` with body `{ argv, runId }` using `fetch()`, with
   `Authorization: Bearer <token>` header
5. Start Cloud Logging tail (same `LogStreamer` but with service-mode filter)
6. Wait for HTTP response — indicates success/failure
7. Drain logs, exit

### Log streaming changes (`src/cloud/log-streamer.ts`)

Add a second constructor overload / options variant for service mode:

- Filter: `resource.type="cloud_run_revision"` +
  `resource.labels.service_name="<name>"` +
  `jsonPayload.runId="<runId>"`
- The HTTP server logs the `runId` with each message so filtering works

### Keepalive command — NEW `src/cloud/keepalive.ts`

`job cloud keepalive <env>` command that:

1. Reads config to get service name, project, region
2. Gets service URL via `gcloud run services describe`
3. Gets identity token via `gcloud auth print-identity-token`
4. Sends `GET /health` every 5 minutes
5. Runs until Ctrl+C (handles SIGINT gracefully)
6. Prints status: "Keeping container warm... (pinging every 5m, Ctrl+C to stop)"
7. Refreshes the identity token periodically (tokens expire after 1 hour)

### CLI changes (`src/cli.ts`)

- Add `keepalive` action to cloud mode: `job cloud keepalive <env>`
- Pass `keepAlive` config through to deploy/execute functions
- Update USAGE string to include `job cloud keepalive <env>`

### Package exports (`package.json`)

Add: `"./run-cloud-service": "./dist/run-cloud-service.mjs"`

## Files to modify

| File                             | Change                                        |
| -------------------------------- | --------------------------------------------- |
| `src/config.ts`                  | Add `keepAlive` to `CloudConfig`              |
| `src/run-job.ts`                 | Extract `executeJob()` from `runJob()`        |
| `src/cloud/run-cloud-service.ts` | **NEW** — HTTP server entrypoint              |
| `src/cloud/keepalive.ts`         | **NEW** — keepalive ping command              |
| `src/cloud/dockerfile.ts`        | Accept `mode` param for entrypoint            |
| `src/cloud/deploy.ts`            | Add `createOrUpdateService()` path            |
| `src/cloud/execute.ts`           | Add HTTP execution path                       |
| `src/cloud/log-streamer.ts`      | Support service resource type filter          |
| `src/cli.ts`                     | Add keepalive command, wire up keepAlive mode |
| `package.json`                   | Add `./run-cloud-service` export              |

## Sources

- [Set minimum instances for services | Cloud Run](https://docs.cloud.google.com/run/docs/configuring/min-instances)
- [Cloud Run release notes](https://docs.cloud.google.com/run/docs/release-notes)
- [Create jobs | Cloud Run](https://docs.cloud.google.com/run/docs/create-jobs)
- [The Truth About Cold Starts in Google Cloud Run & Functions](https://blog.devops.dev/the-truth-about-cold-starts-in-google-cloud-run-functions-efb1c5bccfda)
- [3 solutions to mitigate the cold-starts on Cloud Run](https://medium.com/google-cloud/3-solutions-to-mitigate-the-cold-starts-on-cloud-run-8c60f0ae7894)
- [General development tips | Cloud Run](https://cloud.google.com/run/docs/tips/general)
- [3 Ways to optimize Cloud Run response times](https://cloud.google.com/blog/topics/developers-practitioners/3-ways-optimize-cloud-run-response-times)
- [Cloud Run startup boost — use it!](https://medium.com/@nbrand01/cloud-run-startup-boost-use-it-1f71a3ab2cbb)
