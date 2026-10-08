# gcp-monorepo-mock

A generated, realistic-shape Firebase/GCP monorepo for testing tooling against:
**750 Cloud Functions (gen2)** in 10 deploy codebases, **500 of them HTTPS endpoints**
behind an API Gateway spec, plus Firestore accessed **directly from a React SPA**
under generated security rules. Built with pnpm.

| Function type      | Count | Defined in |
|--------------------|------:|------------|
| HTTPS (REST CRUD)  | 500   | `services/<domain>/src/<resource>.ts` |
| Firestore triggers | 200   | same files (`onCreated`, `onUpdated`) |
| Callable (onCall)  | 30    | `services/<domain>/src/tasks.ts` |
| Scheduled          | 10    | `tasks.ts` (`nightly`) |
| Pub/Sub            | 10    | `tasks.ts` (`onExport`) |

## Layout

```
config/domains.json        ← source of truth: domains, resources, Firestore access level
config/findings.json       ← optional deliberate weaknesses (see below)
scripts/generate.mjs       ← regenerates everything marked GENERATED
scripts/build-service.mjs  ← esbuild bundle per codebase → services/<d>/dist
packages/shared            ← auth, HTTP wrapper, CRUD, trigger helpers (bundled into each service)
services/<domain>/         ← GENERATED: one Firebase functions codebase per domain
apps/web                   ← React SPA: Firestore SDK direct + REST + callables
firestore.rules            ← GENERATED from access levels
firestore.indexes.json     ← GENERATED composite indexes (status + createdAt)
firebase.json              ← GENERATED: 10 codebases, emulators, hosting
openapi/openapi.json       ← GENERATED OpenAPI 3.0 (for scanners / docs)
openapi/gateway.swagger.json ← GENERATED Swagger 2.0 w/ x-google-backend (API Gateway)
manifest/functions.json    ← GENERATED inventory of every function
tests/rules                ← Firestore rules unit tests (emulator)
tests/api                  ← dev gateway + end-to-end smoke test
```

## Quick start

Requires Node 22+, pnpm, and Java 11+ (for the Firestore emulator).

```bash
pnpm install
pnpm generate          # full 750-function repo (default, already committed)
pnpm generate:small    # 2 resources/domain (~150 functions) — much faster emulator boot
pnpm typecheck

pnpm emulators         # terminal 1: builds every codebase, starts auth/firestore/functions/pubsub
pnpm gateway:dev       # terminal 2: serves the OpenAPI paths on :8787
pnpm test:smoke        # terminal 3: seeds users, runs auth/tenancy/role checks (--all hits every list endpoint)
pnpm test:rules        # rules tests (spins up its own Firestore emulator)
pnpm web:dev           # optional: the SPA against emulators
```

The project ID `demo-apimock` uses Firebase's `demo-` prefix, so emulators run with no real GCP project or credentials.

## Data and access model

Multi-tenant: every resource lives at `tenants/{tenantId}/{resource}/{docId}`.
Identity comes from Firebase Auth **custom claims** `{ tenantId, role }` with roles `viewer < editor < admin`.

There are **two independent enforcement paths**, which is the most important thing to understand about this architecture:

1. **REST / callable → Cloud Functions → Admin SDK.** The Admin SDK ignores `firestore.rules`. Authorization is whatever `packages/shared/src/http.ts` enforces: token, tenant match, minimum role, protected fields.
2. **Browser → Firestore SDK.** No server code runs. `firestore.rules` is the only control, and the web config (API key, project ID) is public by design.

Each resource gets one access level in `config/domains.json`: `public-read`, `member-read`, `member-write`, `owner`, or `server-only`. They're allowed to differ from the REST policy on purpose — e.g. `catalog/products` is publicly readable through Firestore but requires a token over REST. Policy drift between the two paths is a real source of bugs.

## Findings mode

```bash
pnpm generate:findings && pnpm build
```

Applies `config/findings.json`, adding four labeled weaknesses (marked `⚠️` in code and listed in `manifest/findings.json`):
F-001 unauthenticated customer list, F-002 cross-tenant order read (BOLA), F-003 mass assignment on users, F-004 publicly readable payments rule.
`pnpm generate` restores the clean version. Don't deploy findings mode to a real project.

## Deploying to a real project (optional)

```bash
pnpm generate --project my-proj --region us-central1
firebase deploy --only firestore --project my-proj
firebase deploy --only functions:catalog --project my-proj   # one codebase at a time
gcloud api-gateway api-configs create v1 --api=api-mock --openapi-spec=openapi/gateway.swagger.json
```

Deploy codebase-by-codebase: a 750-function project is close to per-region service quotas, and a single all-at-once deploy tends to hit API rate limits.

## Why services are bundled

Cloud Build runs a plain `npm install` on uploaded function source, which can't resolve pnpm `workspace:*` links. So each codebase is bundled with esbuild (inlining `@mock/shared`), and `dist/package.json` lists only real npm runtime deps. `firebase.json` points each codebase's `source` at its `dist/`.
