// Provisioning broker → Postgres (Phase 0 of the broker migration; see
// BROKER-MIGRATION.md at the repo root). Storage foundation for the in-process
// `provisioning` service ported from panw-broker. No application code yet.
//
//   deployments / deployment_resources — the config that used to live in
//       database/*.yaml (broker ConfigRepository). A deployment is a named spec
//       (provider + ordered steps); its resources are child rows whose
//       polymorphic, kind-specific shape is kept verbatim in `config` JSONB.
//   provider_profiles / resource_profiles — reusable CSP records and Terraform
//       resource-profile mappings (also ex-YAML). `resource_profiles.terraform`
//       holds the recursive TerraformValueSpec var map as JSONB.
//   provisioned_resources — the runtime ResourceRecord (broker StateRepository,
//       ex data/state.json). TEXT PK keeps the broker's res_<sha1> ids. The
//       broker's terraformStatePath becomes terraform_workspace (one Terraform
//       `pg`-backend workspace per resource); the panos/outputs blobs stay JSONB.
//   provisioning_jobs / provisioning_job_logs — async lifecycle jobs and their
//       streamed log lines (ex data/jobs.json). Logs are a child table (one row
//       per line), NOT a JSONB array, because the broker rewrites the job on
//       every log line. Each job is self-contained (action + deployment + target
//       + params) so a durable DB-claim worker can re-execute it after a restart.
//   broker_state — per-user singleton (active_job_id serial-guard + schema_version).
//   terraform_state schema — home for Terraform's native `pg` backend. Terraform
//       creates its own `states` table there on `init`; it is infra state, not
//       application data, so it gets NO RLS.
//
// RLS: top-level per-user tables use the standard
//   user_id = current_setting('app.current_user_id', true)::bigint
// policy (migration 0003 idiom). deployment_resources and provisioning_job_logs
// are children with no user_id; they ride their parent via the EXISTS(parent)
// idiom from account_contacts / thread_contacts. No auth exists yet, so a single
// default user is pinned via withUser() at runtime — these policies are
// future-proofing, not a live multi-tenant boundary.
//
// Secrets are NOT stored: config keeps the broker's *Env indirection (env-var
// NAMES), and real Proxmox/PANW/AWS values stay in env. The auth_code / serial /
// panos.vmAuthKey columns can hold resolved secret values at runtime — flagged
// in BROKER-MIGRATION.md for encryption-at-rest in the follow-on; do not log them.
//
// Status/lifecycle columns are plain TEXT (with a small CHECK on job status)
// rather than PG enums — matches the repo's TEXT-status convention and avoids
// ALTER TYPE friction as the broker's lifecycle states evolve.

exports.up = (pgm) => {
  // ── deployments (ex-YAML config: the named spec) ──────────────────────────
  pgm.sql(`
    CREATE TABLE deployments (
      id               BIGSERIAL PRIMARY KEY,
      user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      provider_type    TEXT NOT NULL,
      provider_profile TEXT,
      provider_config  JSONB,
      steps            JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE INDEX idx_deployments_user ON deployments(user_id);
    CREATE TRIGGER deployments_updated_at BEFORE UPDATE ON deployments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE deployments FORCE  ROW LEVEL SECURITY;
    CREATE POLICY deployments_isolation ON deployments
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── deployment_resources (child of deployments; rides parent RLS) ─────────
  pgm.sql(`
    CREATE TABLE deployment_resources (
      id                BIGSERIAL PRIMARY KEY,
      deployment_id     BIGINT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      ordinal           INTEGER NOT NULL DEFAULT 0,
      kind              TEXT NOT NULL,
      name              TEXT,
      hostname          TEXT NOT NULL,
      terraform_profile TEXT,
      config            JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (deployment_id, hostname)
    );
    CREATE INDEX idx_deployment_resources_deployment ON deployment_resources(deployment_id);
    CREATE TRIGGER deployment_resources_updated_at BEFORE UPDATE ON deployment_resources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE deployment_resources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE deployment_resources FORCE  ROW LEVEL SECURITY;
    CREATE POLICY deployment_resources_isolation ON deployment_resources
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM deployments d WHERE d.id = deployment_resources.deployment_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM deployments d WHERE d.id = deployment_resources.deployment_id)
      );
  `);

  // ── provider_profiles (reusable CSP records) ──────────────────────────────
  pgm.sql(`
    CREATE TABLE provider_profiles (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      config      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE TRIGGER provider_profiles_updated_at BEFORE UPDATE ON provider_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provider_profiles FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provider_profiles_isolation ON provider_profiles
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── resource_profiles (Terraform resource-profile mappings) ───────────────
  pgm.sql(`
    CREATE TABLE resource_profiles (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      provider    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      terraform   JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE TRIGGER resource_profiles_updated_at BEFORE UPDATE ON resource_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE resource_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE resource_profiles FORCE  ROW LEVEL SECURITY;
    CREATE POLICY resource_profiles_isolation ON resource_profiles
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── provisioned_resources (runtime ResourceRecord; ex data/state.json) ────
  pgm.sql(`
    CREATE TABLE provisioned_resources (
      id                     TEXT PRIMARY KEY,
      user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deployment_id          BIGINT NOT NULL REFERENCES deployments(id) ON DELETE RESTRICT,
      name                   TEXT,
      hostname               TEXT NOT NULL,
      kind                   TEXT,
      lifecycle_status       TEXT NOT NULL DEFAULT 'idle',
      provider               TEXT,
      vm_id                  INTEGER,
      provider_resource_id   TEXT,
      auth_code              TEXT,
      serial                 TEXT,
      bootstrap_iso_path     TEXT,
      bootstrap_iso_file_id  TEXT,
      terraform_workspace    TEXT,
      panos                  JSONB,
      outputs                JSONB,
      last_job_id            TEXT,
      power_state            TEXT,
      power_state_checked_at TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (deployment_id, hostname)
    );
    CREATE INDEX idx_provisioned_resources_user_host  ON provisioned_resources(user_id, hostname);
    CREATE INDEX idx_provisioned_resources_user_name  ON provisioned_resources(user_id, name);
    CREATE INDEX idx_provisioned_resources_deployment ON provisioned_resources(deployment_id);
    CREATE TRIGGER provisioned_resources_updated_at BEFORE UPDATE ON provisioned_resources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE provisioned_resources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provisioned_resources FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provisioned_resources_isolation ON provisioned_resources
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── provisioning_jobs (async lifecycle jobs; ex data/jobs.json) ───────────
  pgm.sql(`
    CREATE TABLE provisioning_jobs (
      id            TEXT PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deployment_id BIGINT REFERENCES deployments(id) ON DELETE SET NULL,
      action        TEXT NOT NULL,
      hostname      TEXT,
      params        JSONB,
      status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
      claimed_by    TEXT,
      claimed_at    TIMESTAMPTZ,
      error         TEXT,
      started_at    TIMESTAMPTZ,
      finished_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_provisioning_jobs_user_status ON provisioning_jobs(user_id, status, created_at DESC);
    CREATE INDEX idx_provisioning_jobs_claimable   ON provisioning_jobs(created_at) WHERE status = 'queued';
    CREATE TRIGGER provisioning_jobs_updated_at BEFORE UPDATE ON provisioning_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE provisioning_jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provisioning_jobs FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provisioning_jobs_isolation ON provisioning_jobs
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── provisioning_job_logs (child of provisioning_jobs; append per line) ───
  pgm.sql(`
    CREATE TABLE provisioning_job_logs (
      id     BIGSERIAL PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES provisioning_jobs(id) ON DELETE CASCADE,
      ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      line   TEXT NOT NULL
    );
    CREATE INDEX idx_provisioning_job_logs_job ON provisioning_job_logs(job_id, id);

    ALTER TABLE provisioning_job_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provisioning_job_logs FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provisioning_job_logs_isolation ON provisioning_job_logs
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM provisioning_jobs j WHERE j.id = provisioning_job_logs.job_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM provisioning_jobs j WHERE j.id = provisioning_job_logs.job_id)
      );
  `);

  // ── broker_state (per-user singleton: serial-job guard + schema version) ──
  pgm.sql(`
    CREATE TABLE broker_state (
      user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      active_job_id  TEXT,
      schema_version INTEGER NOT NULL DEFAULT 2,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER broker_state_updated_at BEFORE UPDATE ON broker_state
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE broker_state ENABLE ROW LEVEL SECURITY;
    ALTER TABLE broker_state FORCE  ROW LEVEL SECURITY;
    CREATE POLICY broker_state_isolation ON broker_state
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── terraform_state schema (Terraform native `pg` backend lives here) ─────
  // Terraform creates its own `states` table on `init`; one workspace per
  // resource. Not application data — no RLS. Owned by the connecting app role.
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS terraform_state;
  `);
};

exports.down = (pgm) => {
  // Children before parents; DROP TABLE removes each table's policies, triggers,
  // and indexes automatically.
  pgm.sql(`
    DROP SCHEMA IF EXISTS terraform_state CASCADE;
    DROP TABLE IF EXISTS provisioning_job_logs;
    DROP TABLE IF EXISTS provisioning_jobs;
    DROP TABLE IF EXISTS broker_state;
    DROP TABLE IF EXISTS provisioned_resources;
    DROP TABLE IF EXISTS resource_profiles;
    DROP TABLE IF EXISTS provider_profiles;
    DROP TABLE IF EXISTS deployment_resources;
    DROP TABLE IF EXISTS deployments;
  `);
};
