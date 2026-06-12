# Broker → SE-OS Migration

Living tracker for absorbing the provisioning broker (`panw-broker`) into this repo as an in-process API service, with all storage moved to Postgres.

- **Source (read-only reference):** `/Users/colewilkinson/Projects/terraform/panw-broker`
- **Target:** this repo (`se-operating-system`)
- **Created:** 2026-06-08
- **Status:** **Phase 0 complete** (2026-06-08) — migration `1000000000040_provisioning.cjs` applied up/down, `SCHEMA.md` regenerated, `test:all` green (114 pass). **Phase 1 next.** Targets: **AWS-first**, **greenfield**.
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
- **2026-06-08 — Secrets stay as env-var references.** Preserve the broker's `authCodeEnv`/`serialEnv` indirection: store the env-var *name* in PG config rows, keep actual Proxmox token / PANW auth codes / AWS creds in `.env`. No plaintext secrets in config rows. Encryption-at-rest = follow-on. See [[project_internal_domains_load_bearing]] is unrelated; this is new.
- **2026-06-08 — Job logs in a child table** (`provisioning_job_logs`, append-only), not a JSONB array — the broker rewrites the job on every log line, so a child table is the right shape and lets the GUI stream logs.
- **2026-06-08 — DB-claim job worker** (`SELECT … FOR UPDATE SKIP LOCKED` + recover orphaned `running` jobs on boot), replacing the broker's single in-memory `activeJobId` lock, so any API replica can run jobs safely.
- **2026-06-08 — Drop the standalone CLI.** API + MCP + GUI replace it. Terraform stacks ship as artifacts in the image.
- **2026-06-08 — First target = AWS** (the `aws-gp-lab` path the broker `.env` currently runs). Proxmox + Windows-endpoint adapters follow. Drives which stacks/creds Phase 3 needs first.
- **2026-06-08 — Greenfield start** (no import of existing runtime state / tfstate). The PG store begins empty; existing `database/*.yaml` is still seeded as starter **config**. No `terraform state push` import step. Existing broker-tracked resources, if any, stay out of scope — manage/tear them down via the standalone broker if ever needed.

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
- [ ] **Phase 1 — Port broker code + Terraform stacks** into `api/src/services/provisioning/` and `api/terraform/<stack>/`. Fix NodeNext imports (explicit `.js`); add `yaml` + `ssh2` to api deps. Keep file/YAML adapters transiently.
  - *Done when:* `tsc --noEmit` green; a smoke instantiation runs under `tsx`.
- [ ] **Phase 2 — Postgres storage + `pg` backend.** `PostgresConfigRepository` + `PostgresStateRepository`; wire `ResourceBroker` to them; runner → `pg` backend; seed `database/*.yaml` into config tables as starter config. (Greenfield: no runtime-state import.)
  - *Done when:* repository round-trip tests pass (deployment create→read; resource upsert/patch; job enqueue→append logs→read); `terraform init` succeeds against the `pg` backend in a throwaway schema.
- [ ] **Phase 3 — Expose + run.** All five surfaces (parity) + DB-claim worker + image deps (`terraform`; `xorriso` only if the path builds an ISO — the AWS path may use user-data instead, confirm) + env (incl. AWS creds — see Open Q4).
  - *Done when:* full lifecycle runs end-to-end against **AWS** via **both** `curl` and an MCP client — enqueue → poll → logs stream → `ready`; `down` tears it down.
- [ ] **Phase 4 — Homelab GUI tab.** `gui/src/pages/HomelabList.tsx` + `HomelabDetail.tsx`, create modal, job-status + streaming-log polling (reuse `MeetingView` poll pattern), status pills (reuse theme primitives / `StatusBadge`), nav (`Layout.tsx`) + route (`App.tsx`) + api methods (`lib/api.ts`). Mobile-responsive at 375px.
  - *Done when:* create / launch / monitor / tear down a deployment from the browser, desktop + mobile.
- [ ] **Follow-on.** Port/verify AWS + Windows-endpoint adapters beyond the first target; secret encryption-at-rest; Terraform provider plugin-cache volume to cut egress.

`npm run test:all` stays green at every phase. New api tests under `api/test/provisioning.test.js` (stays `.js`), Terraform mocked.

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
3. **(Open, defer to Phase 4) GUI deployment-creation model:** clone-and-edit seeded examples / author from scratch / paste-or-upload YAML.
4. **(Open, for Phase 3) AWS credentials in-container:** how to supply AWS creds to the api image — mount `~/.aws` (as the broker compose did) vs. `AWS_*` env vars vs. an instance/role. Resolve when we add image deps + env in Phase 3.

---

## Reference: key files

**Broker source (read-only):** `src/resourceBroker.ts`; `src/state/stateRepository.ts`; `src/repositories/` (ConfigRepository); `src/types/{state,deployment,resource,provider,terraformResourceProfile}.ts`; `src/providers/index.ts`; `src/resources/{terraformRunner,types,genericTerraformResourceAdapter}.ts`; `src/resources/palo/{panorama,vm-series}/*`, `src/resources/palo/shared/{bootstrapService,client,ssh}.ts`, `src/resources/windows/*`; `src/entrypoints/{server,cli}.ts`; `Dockerfile`, `compose.yaml`, `docker-entrypoint.sh`, `.env.example`; `terraform/`.

**se-os patterns to mirror:** async precedent `api/src/services/outreach/*` (in-memory — to be **replaced** by the PG/worker model); CRUD template `api/src/services/vendors/*` + `api/src/routes/vendors/*`; spawn precedent `api/src/services/backup/backup.ts`; DB/RLS `api/src/db/connection.ts` (`getPool`, `withUser`); migrations `api/migrations/*.cjs`; schema dump `dev/scripts/dump-schema.js`; surfaces `api/src/mcp/{tools,server}.ts`, `api/src/agent/mcp-client.ts`, `api/src/instructions.ts`, `api/src/index.ts`; GUI `gui/src/App.tsx`, `gui/src/components/Layout.tsx`, `gui/src/lib/api.ts`, `gui/src/components/{Modal,FormField,Button,StatusBadge}.tsx`, `gui/src/index.css` (theme primitives), and the `MeetingView` enrichment-poll pattern.
