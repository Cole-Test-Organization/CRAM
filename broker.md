# Broker Port Notes

Working notes for bringing the provisioning broker (`panw-broker`) into the SE Operating System world.

- **Source repo (read-only reference):** `/Users/colewilkinson/Projects/terraform/panw-broker`
- **Target:** this repo (`se-operating-system`)
- **Last updated:** 2026-06-06
- **Status:** early integration. No code written in either repo yet.

---

## Decisions log

- **2026-06-06 — Integrate as a standalone containerized service over HTTP**, not (yet) absorbed into `api/src`. Keep the broker's TypeScript and file-based storage for now; harden the HTTP API contract by driving it with curl (simulating the frontend).
- **2026-06-06 — Defer the main-repo JS→TS migration.** The service boundary means the broker stays TS and `api/src` stays JS; they talk over HTTP, so the languages don't need to unify to integrate. Revisit later.
- **2026-06-07 — Reversed: migrating `api/` → TypeScript now**, before bringing broker code over (so it drops in without a TS→JS downgrade). Phase 0 (toolchain: `tsconfig` + `tsx` + typecheck gate, no source renames) is complete and green. Tracker: `api/TS-MIGRATION.md`.
- **2026-06-06 — Defer DB integration.** Broker keeps file storage (`state.json`/`jobs.json`/YAML) for now; move to Postgres later, independently, behind its existing repository interfaces.

---

## Architecture: standalone service (chosen) vs. absorb-into-`api/src` (later)

**A. Standalone containerized service over HTTP — CHOSEN for now.**
The broker runs as its own container with its own (TS) codebase and HTTP API. The frontend (and later the main API/agent) talk to it over HTTP. Why this is the right near-term move:

- **Isolation / blast radius** — a terraform hang, ISO build failure, or SSH timeout can't take down the CRM.
- **Different runtime deps** — `terraform` + ISO tooling + Proxmox/AWS egress stay out of the lean CRM image.
- **Matches the broker's scaling profile** — the broker is a single stateful worker (local tfstate, one job at a time); the CRM scales horizontally. Kept separate, the broker's single-host assumptions are *fine* and the "local tfstate vs. scaled VMs" risk disappears for now.
- **Placement** — the broker must run where it can reach Proxmox (LAN) and AWS; that may not be where the cloud CRM runs. A separate service can live where the network access is.
- **Dissolves the TS-vs-JS question** — broker stays TS, `api/src` stays JS.
- **Fits an existing repo pattern** — `calendar-import` already establishes "a deterministic service that talks over HTTP and sits outside the in-process MCP four-surface parity." The broker is the same shape.

**B. Absorb into `api/src` as a `provisioning` service — LATER / optional.**
Collapse the HTTP hop; the broker's logic becomes an in-process service on shared Postgres + RLS, exposed via the five-surface pattern (so the agent/MCP get it). Those benefits mostly matter once multi-user/auth/agent-use arrive. **The repository seam means choosing A now does not foreclose B later** — storage and transport are both swappable behind interfaces.

---

## Does this fit "what this repo needs"? Yes — one principle, two seams.

- **Principle — Postgres is the source of truth.** The repo's #1 rule. File-based broker storage is a **stopgap**, not an end state: deployments/resources/jobs eventually belong in Postgres (under RLS, in backups, optionally agent-visible). Fine for dev/integration now; plan the migration.
- **Lock these two stable seams now:**
  1. The **HTTP API contract** (routes + async enqueue/poll shapes) — this is what the frontend couples to. Stabilize it via curl before building UI.
  2. The **repository interfaces** — already protect the file→Postgres swap.
  Lock these two and everything underneath can change without breaking callers.

---

## Containerization caveats (the things that bite)

1. **⚠️ Persistent volumes for `work/` and `data/` — critical.** The broker writes Terraform state to `work/<host>/terraform/terraform.tfstate` and runtime/job state to `data/{state,jobs}.json`, all under the project dir = *inside the image*. Without mounted volumes, recreating the container (redeploy, crash, image update) **wipes Terraform state → you can no longer destroy the cloud/VM resources you created** (orphaned infra, duplicate applies). Containerizing file state is *more* dangerous than the CLI-on-host you run today unless you mount named volumes. Also persist `database/` if configs are edited there.
2. **ISO tooling path changes.** `bootstrap.ts` `makeIso` uses `hdiutil` on macOS but `xorriso`/`mkisofs` on Linux. You've been on a Mac; in a Linux container the xorriso path runs — install `xorriso` in the image and test that branch.
3. **Network + provider cache.** Container needs routes to Proxmox (LAN) and AWS. `terraform init` pulls providers from the registry — persist the plugin cache (the volume helps) or use a provider mirror to avoid re-downloads and reduce egress.
4. **Secrets.** Broker reads `.env` (Proxmox token, PANW auth codes) and AWS creds from `~/.aws/credentials`. In a container, pass `.env`/env vars and mount or inject AWS creds. Prod-grade storage = encrypted DB rows (per the broker's own CLAUDE.md), later.

---

## "Which migration?" — disentangling

There are **two independent migrations**; don't let them block each other:

- **Broker storage: files → Postgres.** Happens entirely inside the standalone TS service, behind the existing `ConfigRepository` / `StateRepository` interfaces. Does **not** require the main repo to change language.
- **Main repo: JS → TS.** Separate, deferred, and **not** a prerequisite for broker DB integration.

---

## Phasing (current direction)

1. **Containerize the broker** as-is (TS + file storage), with **persistent volumes for `work/` + `data/`**. Install `terraform` + `xorriso` in the image.
2. **Harden the HTTP API** by driving it with curl (simulate the frontend) — stabilize routes + the async enqueue/poll shapes.
3. **Frontend integration** — point the GUI at the broker's API (directly, for now).
4. **(Later) Storage → Postgres** behind the repository interfaces.
5. **(Later) Main-API fronting / MCP exposure** if the agent needs provisioning — build a thin `/api/provisioning/*` proxy + MCP tool then (five-surface rule applies to the proxy).
6. **(Later) Main-repo TS migration**, independently.

---

## Risks (ranked, current direction)

1. **Lost Terraform state in an ephemeral container** (caveat #1) — now the #1 operational risk. Mitigate with persistent volumes.
2. **File storage vs. "Postgres is source of truth"** — stopgap; plan the DB migration.
3. **ISO tooling / network / secrets in-container** (caveats #2–4).
4. **Single-host assumptions** (one-job lock, local state) — fine while the broker is one container; revisit only if it must scale or go multi-user.
5. **Eventual multi-user/RLS + agent exposure** — deferred; needs the main-API proxy + Postgres.

---

# Reference (for the later DB-integration / absorb work)

The deep analysis from the initial exploration, kept for when storage moves to Postgres or the broker is absorbed.

## What the broker is

A LAN provisioning broker for Palo Alto VM-Series: renders a PAN-OS bootstrap ISO → runs Terraform to create the VM (Proxmox fully wired, AWS scaffolded) → SSHes into PAN-OS to finish bootstrap/verify. Exposed as async jobs over a thin Fastify API + button UI, plus a CLI. Cloud-neutral `Lifecycle` orchestrator + pluggable provider adapters; all storage behind `ConfigRepository` + `StateRepository`. Generic Terraform-resource path → new device types need **zero new code**.

## Component mapping (broker → se-os, if/when absorbed)

| Broker (`src/…`) | Role | se-os target | Pattern |
|---|---|---|---|
| `lifecycle.ts` (`Lifecycle`) | Orchestrator (up/down/deploy/bootstrap/verify/status) | `services/provisioning/lifecycle` | a service (DI of repos) |
| `providers/*` (aws, proxmox, registry) | Provider boundary | `services/provisioning/providers/*` | internal module |
| `providers/terraformResource.ts` | Generic `terraform init/apply/destroy/output` | `services/provisioning/terraform` | `spawn` (cf. `services/backup/backup.js`) |
| `bootstrap.ts` | `init-cfg.txt` + ISO build | `services/provisioning/bootstrap` | internal |
| `capabilities/panw/*` | PAN-OS SSH + API | `services/provisioning/capabilities/panw/*` | internal (`ssh2`) |
| `proxmoxDiscovery.ts` | Proxmox inventory | `services/provisioning/discovery` | read-only op |
| `repositories/configRepository.ts` | Config storage interface + YAML impl | `services/provisioning/config-repository` (**PG impl**) | keep interface, swap YAML→PG |
| `state.ts` (`StateRepository`) | Runtime state + jobs interface | `services/provisioning/state-repository` (**PG impl**) | swap JSON→PG |
| `types.ts` | Data model | migrations + schemas | node-pg-migrate + Fastify schemas |
| `server.ts` | HTTP surface | `routes/provisioning/*` | register under `/api` plugin |
| `public/*` | Thin UI | new `gui/src` section | theme primitives + mobile rules |
| `database/*.yaml` | Config records | seed/import fixtures | YAML as import format only |
| `terraform/` (stacks + modules) | IaC code | ship as artifacts | NOT db rows (README is explicit) |

## Proposed Postgres schema (for the storage migration)

Per-user tables with RLS via the `withUser` / `app.current_user_id` pattern:

- **`provider_profiles`** — reusable CSP records (`type`, `config` jsonb).
- **`resource_profiles`** — reusable TF mappings (`provider`, `kind`, `terraform` jsonb = `{stack, vars, environment, outputs}`).
- **`deployments`** + **`deployment_resources`** (child rows, RLS-via-parent like `account_contacts`).
- **`provisioned_resources`** — the `FirewallRecord` runtime state. **Name generically, not `firewalls`** — holds panorama / windows-endpoint / generic too.
- **`provisioning_jobs`** + **`provisioning_job_logs`** (child table — the broker rewrites the job on *every log line*, so don't use a JSONB array).

Then `npm --prefix api run db:schema` to regenerate `SCHEMA.md` in the same commit.

## Async job model — keep persistence, don't copy `outreach`'s in-memory queue

`outreach` is the right *shape* (enqueue → poll-by-id → stats) but the wrong *durability* (in-memory, per-surface, lost on restart). Provisioning jobs run for minutes and manage real infra, so: persist in Postgres (broker already half-does via `jobs.json`); replace the single in-process `activeJobId` with a DB claim (`SELECT … FOR UPDATE SKIP LOCKED`); recover orphaned `running` jobs on boot; keep the async return + poll contract.

## Naming

Keep it **vendor-agnostic** (existing project principle): `provisioning`/`labs`, not `panw`. PANW VM-Series is one `resource_kind` alongside panorama / windows-endpoint / generic-terraform.

## Reference: key files

**Broker (read-only):** orchestrator `src/lifecycle.ts`; providers `src/providers/{index,types}.ts` + `{aws,proxmox}/*`; TF runner `src/providers/terraformResource.ts`; repositories (the seam) `src/repositories/configRepository.ts`, `src/state.ts`; data model `src/types.ts`; HTTP `src/server.ts`; CLI `src/cli.ts`; UI `src/public/*`; bootstrap/ISO `src/bootstrap.ts`; discovery `src/proxmoxDiscovery.ts`.

**se-os targets / patterns:** async-job precedent `api/src/services/outreach/*` + `api/src/mcp/tools.js` (`outreach` tool); CRUD template `api/src/services/vendors/*`; DB handle + RLS `api/src/db/connection.js` (`getPool`, `withUser`); route registration `api/src/index.js` (`/api` plugin); MCP bags `api/src/mcp/server.js` + `api/src/agent/mcp-client.js`; instructions/REFS `api/src/instructions.js`; binary-spawn precedent `api/src/services/backup/backup.js`; migrations `api/migrations/*.cjs`; schema dump `dev/scripts/dump-schema.js` → `api/SCHEMA.md`.
