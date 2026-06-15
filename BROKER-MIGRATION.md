# Broker → SE-OS Migration

Living tracker for absorbing the provisioning broker (`panw-broker`) into this repo as an in-process API service, with all storage moved to Postgres.

- **Source (read-only reference):** `/Users/colewilkinson/Projects/terraform/panw-broker`
- **Target:** this repo (`se-operating-system`)
- **Created:** 2026-06-08
- **Status:** **Phases 0–3 code-complete** (Phase 0 2026-06-08; Phases 1–2 2026-06-15; Phase 3 2026-06-15). Phases 1–2 moved storage to Postgres (broker ported to `api/src/services/provisioning/`; config + runtime state + jobs behind PG repositories; secrets encrypted at rest; Terraform on the native `pg` backend; discovery seam closed). **Phase 3 exposed the broker across all five surfaces** (service + HTTP routes + MCP tool + both service bags + instructions) behind a durable **DB-claim job worker** (claim → run → finalize; orphan-recovery on boot; user cancellation that terminates the terraform child), plus image deps (`terraform`) and idempotent seed-on-boot. Work is on branch `provisioning-migration` (off `main`); `tsc --noEmit` green across the api. **The remaining gate is the live AWS end-to-end run** (needs creds in the runtime + an explicit go-ahead — it mutates cloud infra and costs money). Targets: **AWS-first**, **greenfield**, **single user (auth out of scope)**.
- **Supersedes:** `broker.md` (the earlier exploration + decision log). That doc's "standalone container" and "defer DB integration" decisions are **reversed** here (see Decisions log). Its "Reference / Proposed schema / Async job model" analysis is still valid and is folded in below.

---

## Context & goal

`panw-broker` is a LAN provisioning broker: it renders a PAN-OS bootstrap ISO → runs Terraform to create a VM (Proxmox wired; AWS stacks present) → SSHes into PAN-OS to finish bootstrap/verify. Cloud-neutral orchestrator (`ResourceBroker`) + pluggable provider adapters + resource adapters; all storage already sits behind `ConfigRepository` + `StateRepository` interfaces. Generic Terraform-resource path means new device types need little/no new code.

**Goal:** bring this functionality into SE-OS so users can spin up homelab infrastructure from a new **"Homelab"** GUI tab, with the broker's logic running as an in-process service the API calls, and **config + runtime state + jobs persisted in Postgres** (the repo's #1 rule: Postgres is the source of truth). Terraform's own state moves to the native **`pg` backend**.

---

## The key insight: there are THREE kinds of "state"

The original ask was "config YAML → PG" + "the state file (file adapter) → DB adapter." Correct, but the broker keeps **three** things on disk and only two are behind the adapter seam:

| What | On disk today | Mechanism | Plan |
|---|---|---|---|
| **Config** — deployments, provider profiles, TF resource profiles | `database/*.yaml` | `ConfigRepository` interface | Swap to `PostgresConfigRepository` (YAML→PG). YAML kept only as seed/import format. |
| **Broker runtime state** — `ResourceRecord`s, `JobRecord`s, `activeJobId` | `data/state.json`, `data/jobs.json` | `StateRepository` interface | Swap to `PostgresStateRepository` (JSON→PG). **This is the "state file → DB adapter" swap.** |
| **Terraform `tfstate`** | `work/<host>/terraform/terraform.tfstate` | Terraform-managed, passed via `terraform apply -state=<path>` | **NOT behind the adapter.** Move to Terraform's native **`pg` backend** (workspace per resource). |

The third one is the trap: swapping `StateRepository` does **not** move `tfstate`. Losing `tfstate` means you can no longer `destroy` what you created.

---

## Architecture decision: absorb into `api/src`

Bring the broker's TS **source** into `api/src/services/provisioning/` as an in-process service (broker.md's "Architecture B"), exposed across all API surfaces + a GUI tab. We do **not** keep the broker's container; we fold the code in and extend the api image with `terraform` + `xorriso`.

**Why this is viable now (it wasn't when broker.md chose standalone):** the only hard blocker for absorb was "api is JS, broker is TS." That's gone — `api/src` is now 100% TypeScript under `tsx` (NodeNext, no build step). The broker's TS drops straight in.

**`se-os` becomes the home for this code.** `panw-broker` becomes a read-only reference; we hard-fork, not sync.

---

## Decisions log

- **2026-06-08 — Absorb into `api/src`** as an in-process `provisioning` service (reverses broker.md's 2026-06-06 "standalone container" decision; unblocked by the completed api→TS migration).
- **2026-06-08 — Move config + runtime state + jobs to Postgres now** (reverses broker.md's 2026-06-06 "defer DB integration"). Both stay behind the existing repository interfaces — "just change the adapter."
- **2026-06-08 — Terraform `tfstate` → native `pg` backend.** Rationale: real cross-process/replica state locking (the single in-memory `activeJobId` guard protects nothing once the API scales to multiple replicas — see the Azure plan), shared state any replica reads consistently, and one backup/source-of-truth story (`pg_dump` already covers it). Accepted trade-off: teardown now depends on DB availability (fine — the DB is always up). Durability-without-a-volume was explicitly **not** the deciding factor.
- **2026-06-08 — Vendor-agnostic naming.** Service/tables = `provisioning` / `provisioned_resources`; resource kinds (`panw-vmseries`, `panorama`, `windows-endpoint`, generic) are data, not table names. "Homelab" is only the GUI label.
- **2026-06-08 — Per-user RLS** on every new table (repo pattern; pinned default user until auth exists). See [[project_no_auth_placeholder]].
- **2026-06-08 — Keep the broker's TEXT string IDs** for resources (`res_<sha1>`) and jobs (`<ts>-<rand>`) — minimizes broker code change and they're externally meaningful. Precedent: `agent_sessions.id` is already TEXT.
- **2026-06-08 — Secrets stay as env-var references.** ⚠️ **Superseded 2026-06-15 — encrypted secrets table (see below).** Preserve the broker's `authCodeEnv`/`serialEnv` indirection: store the env-var *name* in PG config rows, keep actual Proxmox token / PANW auth codes / AWS creds in `.env`. No plaintext secrets in config rows. Encryption-at-rest = follow-on. See [[project_internal_domains_load_bearing]] is unrelated; this is new.
- **2026-06-08 — Job logs in a child table** (`provisioning_job_logs`, append-only), not a JSONB array — the broker rewrites the job on every log line, so a child table is the right shape and lets the GUI stream logs.
- **2026-06-08 — DB-claim job worker** (`SELECT … FOR UPDATE SKIP LOCKED` + recover orphaned `running` jobs on boot), replacing the broker's single in-memory `activeJobId` lock, so any API replica can run jobs safely.
- **2026-06-08 — Drop the standalone CLI.** API + MCP + GUI replace it. Terraform stacks ship as artifacts in the image.
- **2026-06-08 — First target = AWS** (the `aws-gp-lab` path the broker `.env` currently runs). Proxmox + Windows-endpoint adapters follow. Drives which stacks/creds Phase 3 needs first.
- **2026-06-08 — Greenfield start** (no import of existing runtime state / tfstate). The PG store begins empty; existing `database/*.yaml` is still seeded as starter **config**. No `terraform state push` import step. Existing broker-tracked resources, if any, stay out of scope — manage/tear them down via the standalone broker if ever needed.
- **2026-06-15 — Encrypted secrets table (reverses the 2026-06-08 env-var-reference decision above).** Per the user, credentials live in a per-user **`provisioning_secrets`** table encrypted at rest: app-side AES-256-GCM, 32-byte master key in `PROVISIONING_SECRETS_KEY`, only ciphertext + iv + auth-tag in PG. Config still references a secret by *name* (the broker's `*Env` keys); a `SecretResolver` hydrates decrypted values into a process-global overlay that `requireEnv`/`optionalEnv` consult, so call sites are unchanged. `process.env` remains the fallback. Migration `1000000000042_provisioning-secrets.cjs`.
- **2026-06-15 — User-initiated cancellation is in scope.** `provisioning_jobs.status` CHECK extended with `canceled`, plus a `cancel_requested` flag the worker polls to terminate the spawned `terraform` child. Migration `1000000000043_provisioning-job-cancel.cjs`. (Cancel route + worker kill-signal land with the Phase 3 worker.)
- **2026-06-15 — Phase 2 storage modeling decisions.** (a) `deployments.name` stores the broker's deployment **slug** (config basename = its `deploymentId`/join key), not the YAML display name. (b) A `provisioned_resources` row requires its deployment row to exist (the `deployment_id` FK) — the `up` path/seed persists the deployment first. (c) `ResourceRecord.configPath` has no column (Phase 0 dropped it for the FK); reconstructed as the slug on read. (d) `terraformStatePath` ↔ `terraform_workspace` transitionally (a workspace name, not a path). (e) App profiles + config add-ons have **no tables** — `PostgresConfigRepository` reads them from shipped file artifacts (code-like, not user config).
- **2026-06-15 — Migration numbering around the in-flight krisp branch.** Phase 2 migrations are `042`/`043` (not `041`) so `041` stays free for the `krisp_integration` branch, avoiding a duplicate migration number on merge.
- **2026-06-15 — Single user, forever (auth out of scope).** Per the user, the provisioning service will only ever serve one (the pinned default) user; auth may come later but is out of this migration's scope. So Phase 3 builds **one** `ProvisioningService` + **one** `ProvisioningJobWorker` at API startup pinned to the default user — no per-user broker factory, no cross-user job claiming. The MCP server process + per-turn agent client build their own enqueue/read `ProvisioningService` (no worker). The schema's per-user RLS stays as future-proofing; `SELECT … FOR UPDATE SKIP LOCKED` still earns its keep as multi-replica safety + serial execution for that user.
- **2026-06-15 — Phase 3 job/worker shape.** Lifecycle verbs (deploy/deprovision/up/down/run-action) are NOT run inline — `enqueueJob` inserts a durable `provisioning_jobs` row (`status='queued'`, the full self-contained spec — kind/deploymentRef/resourceAction/runParams — in `params` JSONB) that the worker claims and runs via the broker's lifecycle methods with a Postgres-streaming log (serialized `saveJob` so the append-only log diff never races). Reads (deployments/resources/jobs) and quick power toggles run inline; power toggles honor the active-job guard (409 during a job) while `refreshPowerState` skips it so status reads keep working. The broker's in-memory `runJob` is bypassed (dead in PG mode). Cancellation uses a **process-global AbortSignal overlay** (mirrors the secret overlay) that `runCommand`/`captureCommand` consult — terminates the spawned terraform child without threading a signal through every adapter, safe because jobs are serial. Boot **orphan-recovery** fails any job left `running` by a dead process and clears `active_job_id`.

---

## Target Postgres schema (Phase 0)

One `node-pg-migrate` `.cjs` migration. All tables per-user with forced RLS (`user_id = current_setting('app.current_user_id', true)::bigint`), except child tables which inherit via the `EXISTS (parent)` pattern (cf. `account_contacts`). `set_updated_at()` trigger on each. Proposed shapes (finalized when we write the migration against the broker's actual `src/types/*`):

**`deployments`** — the config that was a YAML file
- `id TEXT PK` (= slug of name; the broker's `deploymentId`) · `user_id BIGINT FK users` · `name TEXT NOT NULL` · `provider_type TEXT NOT NULL` · `provider_profile TEXT` (→ `provider_profiles.name`) · `provider_config JSONB` · `steps JSONB` (ordered step list) · timestamps · `UNIQUE (user_id, name)`

**`deployment_resources`** — child of `deployments` (RLS via parent)
- `id BIGSERIAL PK` · `deployment_id TEXT FK deployments ON DELETE CASCADE` · `ordinal INT` · `kind TEXT NOT NULL` · `name TEXT` · `hostname TEXT NOT NULL` · `terraform_profile TEXT` · `config JSONB NOT NULL` (full polymorphic resource config: placement, vm sizing, license refs, managementServer, bootstrap…) · `UNIQUE (deployment_id, hostname)`

**`provider_profiles`** — reusable CSP records
- `id BIGSERIAL PK` · `user_id BIGINT FK` · `name TEXT NOT NULL` · `type TEXT NOT NULL` (aws/proxmox) · `config JSONB` (region/AZ/endpoint refs; secrets via env refs) · timestamps · `UNIQUE (user_id, name)`

**`resource_profiles`** — `TerraformResourceProfile` (the TF mapping)
- `id BIGSERIAL PK` · `user_id BIGINT FK` · `name TEXT NOT NULL` · `provider TEXT NOT NULL` · `kind TEXT NOT NULL` · `terraform JSONB NOT NULL` (`{ stack, outputs, environment, vars }`; `vars` is the recursive `TerraformValueSpec` — perfect for JSONB) · timestamps · `UNIQUE (user_id, name)`

**`provisioned_resources`** — the runtime `ResourceRecord`
- `id TEXT PK` (`res_<sha1>`) · `user_id BIGINT FK` · `deployment_id TEXT FK deployments` · `name TEXT` · `hostname TEXT NOT NULL` · `kind TEXT` · `lifecycle_status TEXT NOT NULL` (broker treats as string; TEXT avoids enum-migration friction) · `provider TEXT` · `vm_id INT` · `provider_resource_id TEXT` · `bootstrap_iso_path TEXT` · `bootstrap_iso_file_id TEXT` · `terraform_workspace TEXT` (replaces the old `terraformStatePath` under the pg backend) · `panos JSONB` · `outputs JSONB` · `last_job_id TEXT` · `power_state TEXT` · `power_state_checked_at TIMESTAMPTZ` · timestamps · `UNIQUE (user_id, deployment_id, hostname)` · indexes on `(user_id, hostname)`, `(user_id, name)`, `(deployment_id)`
- ⚠️ `auth_code` / `serial` / `panos.vmAuthKey` can hold **resolved secret values**. Decision: avoid persisting resolved secrets where possible; if a field must be stored, flag for encryption-at-rest in the follow-on. (Open: confirm at Phase 0.)

**`provisioning_jobs`** — the `JobRecord`
- `id TEXT PK` (`<ts>-<rand>`) · `user_id BIGINT FK` · `action TEXT NOT NULL` · `hostname TEXT` · `resource_id TEXT FK provisioned_resources` (nullable) · `status provisioning_job_status` (enum: `queued`,`running`,`succeeded`,`failed` — `queued` added for the worker-claim model) · `claimed_by TEXT` (worker/replica id, for SKIP LOCKED) · `started_at` · `finished_at` · `error TEXT` · `created_at` · index `(user_id, status, created_at DESC)`

**`provisioning_job_logs`** — child of `provisioning_jobs` (RLS via parent), append-only
- `id BIGSERIAL PK` · `job_id TEXT FK provisioning_jobs ON DELETE CASCADE` · `ts TIMESTAMPTZ` · `line TEXT` · index `(job_id, id)`

**`broker_state`** — per-user singleton (keeps the broker's serial guard)
- `user_id BIGINT PK FK` · `active_job_id TEXT` · `schema_version INT DEFAULT 2` · `updated_at`

**`terraform_state` schema** — dedicated PG schema for Terraform's `pg` backend (Terraform auto-creates its `states` table on `init`; migration creates the schema + grants to the app role). One **workspace per resource**, named `<deployment>__<hostname>`.

Then: `npm --prefix api run db:schema` to regenerate `api/SCHEMA.md` in the **same commit**.

**As built (Phase 0, 2026-06-08)** — live schema is now in `api/SCHEMA.md`. Deviations from the proposal above: job `status` is `TEXT` + `CHECK (status IN ('queued','running','succeeded','failed'))`, not a PG enum (matches the repo's TEXT-status convention, avoids `ALTER TYPE` friction); `provisioning_jobs` gained `params JSONB` + `deployment_id` + `claimed_by` + `claimed_at` so the durable DB-claim worker can re-execute a job after a restart; `provisioned_resources.deployment_id` is `ON DELETE RESTRICT` (deleting a deployment must not silently orphan tracked infra).

---

## Repository adapter design (Phase 2)

Both swaps stay behind the existing interfaces — honoring "just change the adapter":

- **`PostgresConfigRepository implements ConfigRepository`** — serves `DeploymentConfig` / provider profiles / TF resource profiles from PG. Reassembles a `DeploymentConfig` from `deployments` + `deployment_resources`.
- **`PostgresStateRepository extends StateRepository`** — **override the granular public ops** (`upsertResource`, `patchResource`, `setActiveJob`, `saveJob`, `getResource`, `listResources`, `getState`) with row-level SQL, rather than the base class's read-whole/write-whole-file primitives. `saveJob` upserts the job row and **inserts only new log lines** into `provisioning_job_logs` (track a persisted-count to diff against `job.logs`), so the interface is unchanged but logs append efficiently.
- Both get a per-user client via the repo's `getPool()` / `withUser()` (`api/src/db/connection.ts`).

---

## Terraform runner: `pg` backend (Phase 2)

The broker's runner (`src/resources/terraformRunner.ts`) currently does `terraform -chdir=<stack> init` then `apply/destroy/output … -state=<path>`. Change to:
- Add a `backend "pg" {}` block to each stack (type only; no connection details in the file).
- Configure at init: `terraform init -backend-config="conn_str=…" -backend-config="schema_name=terraform_state"`.
- **Workspace per resource** (`terraform workspace select|new <deployment>__<hostname>`); drop the `-state` flag.
- Locking is handled natively (Postgres advisory locks).

---

## Five-surface parity wiring (Phase 3)

Mandatory per CLAUDE.md — all land together:

1. **Service** — `api/src/services/provisioning/*` (orchestrator + adapters + runner + bootstrap, imported in Phase 1).
2. **HTTP routes** — `api/src/routes/provisioning/*` with swagger schemas. Surface: enqueue → poll-by-id → list jobs; list/get resources; `up`/`down`/`deploy`/`deprovision`; `start`/`stop`; deployment/profile CRUD. Registered under `/api` in `api/src/index.ts`.
3. **MCP tool** — `provisioning` (action-dispatched) in `api/src/mcp/tools.ts`.
4. **Both `services` bags** — `api/src/mcp/server.ts` (external MCP) **and** `api/src/agent/mcp-client.ts` (in-process agent). Easy to forget the second.
5. **Instructions** — `REFS` entries + "When to Use"/"Common Workflows" prose in `api/src/instructions.ts`.

**Job worker:** DB-claim loop (`SELECT … FOR UPDATE SKIP LOCKED`) + orphan-recovery on boot. Heavy work is a spawned `terraform` child (cf. `api/src/services/backup/backup.ts`), so a hung apply is killed by timeout, not wedging the event loop.

---

## Phases & checkpoints

- [x] **Phase 0 — Database schema.** ✅ Done 2026-06-08. Migration `api/migrations/1000000000040_provisioning.cjs` — 8 tables (`deployments`, `deployment_resources`, `provider_profiles`, `resource_profiles`, `provisioned_resources`, `provisioning_jobs`, `provisioning_job_logs`, `broker_state`) + `terraform_state` schema, per-user RLS (child tables via `EXISTS(parent)`), TEXT statuses (no enums). Verified up/down on the dev DB; `test:all` green (114 pass) confirms it applies from scratch on the throwaway PG; `SCHEMA.md` regenerated (34 tables).
- [x] **Phase 1 — Port broker code + Terraform stacks.** ✅ Done 2026-06-15. 56 TS files copied to `api/src/services/provisioning/` — a drop-in port (both repos are NodeNext with explicit `.js` imports, so **no import rewriting**). Added `yaml` + `ssh2` (+ `@types/ssh2`). Reworked `utils/paths.ts` from `import.meta.url` `../..` math to env-driven roots (`PROVISIONING_ROOT` / `PROVISIONING_TERRAFORM_ROOT`). Stacks → `…/provisioning/terraform/` (`.tf` source + `.terraform.lock.hcl` only; 3.9 GB of provider caches excluded); `database/*.yaml` copied transiently. `tsc --noEmit` green; smoke under `tsx` discovered all 10 deployments + ran the descriptor path.
- [x] **Phase 2 — Postgres storage + `pg` backend.** ✅ Code-complete 2026-06-15. `PostgresStateRepository` (overrides the granular ops with row-level SQL; base refactored to export normalization; resource/job/active-job + append-only logs). `PostgresConfigRepository` (reassembles `DeploymentConfig` from `deployments` + ordered `deployment_resources`; app/config profiles read from file artifacts). **Half-real seam closed** — `ConfigRepository` extended with provider/app/config/resource-profile accessors; the broker's 5 inline YAML loaders now delegate to it. Encrypted secrets (migration 042 + crypto/repo/service + `SecretResolver` + overlay primed in `runJob`). Cancellation schema (migration 043). `TerraformRunner` → `pg` backend (env-injected `PG_CONN_STR`, workspace per resource, `-state` dropped) + `backend.tf` on 9 stacks. `seedProvisioningConfig` importer.
  - *Verified against a throwaway PG:* migrations up/down (single correct `canceled` constraint), secrets round-trip (encrypt→store→decrypt, no plaintext leak), state-repo round-trip (resource CRUD + JSONB + append-only logs).
  - *Done when (remaining):* run the Phase 2 smoke tests — config-repo parity, closed-seam load via PG, secret resolver/overlay, `terraform init` + `workspace select -or-create` against the `pg` backend (the one piece needing a real `terraform`, ≥1.4), and end-to-end with mocked terraform. Then add as `api/test/provisioning.test.js` and regenerate `SCHEMA.md`.
- [x] **Phase 3 — Expose + run.** ✅ Code-complete 2026-06-15. Five-surface parity: `ProvisioningService` + `ProvisioningJobWorker` (service, `api/src/services/provisioning/{provisioningService,jobWorker,jobView}.ts`); `api/src/routes/provisioning/provisioning.ts` registered under `/api` with swagger (HTTP); the `provisioning` action-tool in `api/src/mcp/tools.ts` (MCP); **both** service bags (`api/src/mcp/server.ts` + `api/src/agent/mcp-client.ts`); REFS + prose in `api/src/instructions.ts`. DB-claim worker: `FOR UPDATE SKIP LOCKED` claim + NOT-EXISTS serial guard, per-line PG log streaming, boot orphan-recovery, user cancellation (`cancel_requested` poll → process-global AbortSignal kills the terraform child). Image dep: `terraform` (+ `unzip`) added to both Dockerfile stages via the HashiCorp apt repo (`xorriso` deferred — the AWS path uses user-data, not an ISO). Idempotent seed-on-boot wired in `index.ts` (`PROVISIONING_SEED_ON_BOOT`). `tsc --noEmit` green across the api.
  - *Done when (remaining):* the live AWS end-to-end — enqueue → poll → logs stream → `ready`; `down` tears it down — via both `curl` and an MCP client. Needs AWS creds in the runtime + an explicit go-ahead (mutating, costs money). Smoke/e2e plan below.
- [ ] **Phase 4 — Homelab GUI tab.** `gui/src/pages/HomelabList.tsx` + `HomelabDetail.tsx`, create modal, job-status + streaming-log polling (reuse `MeetingView` poll pattern), status pills (reuse theme primitives / `StatusBadge`), nav (`Layout.tsx`) + route (`App.tsx`) + api methods (`lib/api.ts`). Mobile-responsive at 375px.
  - *Done when:* create / launch / monitor / tear down a deployment from the browser, desktop + mobile.
- [ ] **Follow-on.** Port/verify AWS + Windows-endpoint adapters beyond the first target; secret encryption-at-rest; Terraform provider plugin-cache volume to cut egress.

`npm run test:all` stays green at every phase. New api tests under `api/test/provisioning.test.js` (stays `.js`), Terraform mocked.

### Phase 3 smoke / e2e plan (not yet executed)

Staged cheapest-first; **D is the only step that touches AWS — run it only with creds + an explicit go-ahead.** A–C need no cloud.

**A. Static.** `npm --prefix api run typecheck` (green ✅). `npm --prefix api test` (db-test, terraform untouched) stays green.

**B. Boot + surfaces (db-test, no terraform apply).** Start the api against db-test; confirm the logs `Seeded provisioning config from database/*.yaml` and `provisioning job worker started`. Then:
- `curl GET /api/provisioning/deployments` → the 10 seeded deployments; `…/deployments/aws-gp-lab-trusted-users` → resources + steps + inferred inputs + `requiredEnv`.
- Secrets: `PUT /api/provisioning/secrets/PANW_PANORAMA_AUTH_CODE` `{"value":"x"}` → `{name}`; `GET …/secrets` shows it **without the value**; `DELETE` → 200.
- `GET /docs/json` contains the `provisioning` tag + paths (swagger registered).
- MCP parity: via an MCP client call `provisioning` actions `list_deployments` / `get_deployment` / `list_secrets` → identical results (proves the tool + both service bags + instructions).

**C. Worker mechanics (db-test, fake `terraform` on `PATH`).** Drop a stub `terraform` that logs, sleeps, and writes a dummy tfstate so no cloud is hit:
- `POST /api/provisioning/deployments/<dep>/deploy` → **202** + queued job; poll `GET /api/provisioning/jobs/:id` → `running` → `succeeded`; log lines stream; a row appears in `list_resources`.
- Cancel: enqueue against a slow stub; `POST /jobs/:id/cancel` while `running` → job → `canceled`, child killed; `GET /jobs?status=canceled` lists it. Cancel a `queued` job → immediate `canceled`.
- Orphan recovery: kill the api mid-run → on restart the job is `failed (interrupted by an API restart)` and `broker_state.active_job_id` is cleared.
- Serial guard: enqueue two jobs → they run strictly one-at-a-time; a `start`/`stop` during a job → **409**.

**D. Live AWS e2e (go-ahead + creds only).** Set the gp-lab `requiredEnv` secrets → `deploy aws-gp-lab-trusted-users` → poll to `ready` → `run_action … verify-connected-resources` → `deprovision` tears it down. Exercise via **both** `curl` and an MCP client. This is the Phase 3 "done when."

---

## Component mapping (broker → se-os)

| Broker (read-only ref) | se-os target |
|---|---|
| `src/resourceBroker.ts` (`ResourceBroker`) | `services/provisioning/` orchestrator |
| `src/providers/*` (aws, proxmox, registry, `index.ts`) | `services/provisioning/providers/*` |
| `src/resources/terraformRunner.ts` | `services/provisioning/` TF runner (→ `pg` backend) |
| `src/resources/*ResourceAdapter.ts` (generic, palo/panorama, palo/vm-series, windows) | `services/provisioning/resources/*` |
| `src/resources/palo/shared/*` (bootstrap, client, ssh) | `services/provisioning/.../palo/shared/*` (`ssh2`) |
| `src/repositories/*` `ConfigRepository` (YAML) | `PostgresConfigRepository` |
| `src/state/stateRepository.ts` `StateRepository` (JSON) | `PostgresStateRepository` |
| `src/types/*` | migration + Fastify/MCP schemas |
| `src/entrypoints/server.ts` (HTTP) | `routes/provisioning/*` |
| `src/entrypoints/cli.ts` | dropped (API/MCP/GUI replace it) |
| `terraform/` stacks + modules | `api/terraform/*` artifacts (NOT DB rows) |
| `database/*.yaml` | seed/import fixtures only |

*(Broker file paths above are from a fresh read of the source and supersede broker.md's older guesses; verify exact paths at Phase 1.)*

---

## Runtime / infra changes

- **Image:** add `terraform` + `xorriso` (Linux ISO path; macOS dev uses `hdiutil`). Needs network reach to Proxmox (LAN) and/or AWS.
- **Env:** `PROVISIONING_TERRAFORM_ROOT` (stacks dir), work dir for transient ISO/render artifacts, Terraform `pg` backend `conn_str`, plus the broker's existing secret env vars (`PROXMOX_VE_*`, `PANW_*`, `PANOS_ADMIN_PASSWORD`, AWS creds).
- **Dev rebuild:** Dockerfile change ⇒ rebuild required; follow `dev/DEV.md` exactly (full multi-profile command). See [[feedback_se_os_env_and_rebuild]].

---

## Risks & caveats

1. **Blast radius / image bloat** — terraform + ISO tooling + Proxmox/AWS egress now live in the CRM image; a provision runs in-process. Mitigated by spawned-child + timeouts. (Price of absorb-vs-standalone.)
2. **Network placement under Azure scale-out** — scaled API replicas in Azure won't have LAN reach to Proxmox; Proxmox jobs must run where the LAN is reachable. Revisit when scaling. See [[project_azure_deployment]].
3. **Secrets** — env-ref indirection now; encrypted rows later. Don't log resolved auth codes / vmAuthKey.
4. **ISO tooling branch** — if the AWS path uses user-data (not an ISO), `xorriso` is deferrable; the Proxmox follow-on exercises the Linux `xorriso`/`mkisofs` branch in-container (dev has been on macOS `hdiutil`) — test it then.
5. **Single-host → multi-replica** — the DB-claim worker + `pg` backend are what make absorption safe under scaling; don't regress to the in-memory `activeJobId` model.

---

## Open questions

1. ~~First end-to-end target~~ → **Resolved 2026-06-08: AWS** (`aws-gp-lab` path). Proxmox/Windows follow.
2. ~~Existing state~~ → **Resolved 2026-06-08: Greenfield** — start clean, no import. Seed `database/*.yaml` as starter config only.
3. ~~Secrets storage~~ → **Resolved 2026-06-15: encrypted `provisioning_secrets` table** (AES-256-GCM at rest), reversing the 2026-06-08 env-ref decision. See Decisions log.
4. ~~User cancellation~~ → **Resolved 2026-06-15: in scope** — `canceled` status + `cancel_requested` flag (migration 043); cancel route + worker kill-signal land with the Phase 3 worker.
5. **(Open, defer to Phase 4) GUI deployment-creation model:** clone-and-edit seeded examples / author from scratch / paste-or-upload YAML.
6. **(Open, for Phase 3) AWS credentials in-container:** how to supply AWS creds to the api image — mount `~/.aws` (as the broker compose did) vs. `AWS_*` env vars vs. an instance/role. Resolve when we add image deps + env in Phase 3.

---

## Reference: key files

**Broker source (read-only):** `src/resourceBroker.ts`; `src/state/stateRepository.ts`; `src/repositories/` (ConfigRepository); `src/types/{state,deployment,resource,provider,terraformResourceProfile}.ts`; `src/providers/index.ts`; `src/resources/{terraformRunner,types,genericTerraformResourceAdapter}.ts`; `src/resources/palo/{panorama,vm-series}/*`, `src/resources/palo/shared/{bootstrapService,client,ssh}.ts`, `src/resources/windows/*`; `src/entrypoints/{server,cli}.ts`; `Dockerfile`, `compose.yaml`, `docker-entrypoint.sh`, `.env.example`; `terraform/`.

**se-os patterns to mirror:** async precedent `api/src/services/outreach/*` (in-memory — to be **replaced** by the PG/worker model); CRUD template `api/src/services/vendors/*` + `api/src/routes/vendors/*`; spawn precedent `api/src/services/backup/backup.ts`; DB/RLS `api/src/db/connection.ts` (`getPool`, `withUser`); migrations `api/migrations/*.cjs`; schema dump `dev/scripts/dump-schema.js`; surfaces `api/src/mcp/{tools,server}.ts`, `api/src/agent/mcp-client.ts`, `api/src/instructions.ts`, `api/src/index.ts`; GUI `gui/src/App.tsx`, `gui/src/components/Layout.tsx`, `gui/src/lib/api.ts`, `gui/src/components/{Modal,FormField,Button,StatusBadge}.tsx`, `gui/src/index.css` (theme primitives), and the `MeetingView` enrichment-poll pattern.
