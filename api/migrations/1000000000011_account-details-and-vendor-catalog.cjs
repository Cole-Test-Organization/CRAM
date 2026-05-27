// Account details + vendor catalog.
//
// Introduces three new tables to replace the loosely-typed accounts.environment
// JSONB blob with a structured "technical profile" model:
//
//   vendors          — global catalog of vendors (Cisco, Palo Alto, …). No
//                      user_id, no RLS: the catalog is shared. Soft-delete via
//                      deleted_at so historical references in account_details
//                      arrays don't dangle.
//
//   vendor_products  — global catalog of products under a vendor (Palo Alto
//                      PA-3220, CrowdStrike Falcon, …). Each product has a
//                      free-text `category` (firewall, edr, siem, …). Soft-
//                      delete same as vendors.
//
//   account_details  — 1-1 with accounts. Typed columns for the firmographic
//                      and tech facts the user wants to query (revenue,
//                      employee_count, site_count, etc.), plus one bigint[]
//                      per product category that references vendor_products.id
//                      values. `technical_notes` carries the unstructured
//                      prose that doesn't compress into a column. RLS is
//                      enforced via the parent account's ownership.
//
// As part of this migration, accounts.environment is backfilled into
// account_details.technical_notes (one `key: value` line per top-level JSONB
// key, sorted) and then dropped. accounts.search_vector is rebuilt without
// the environment field.

exports.up = (pgm) => {
  // ── vendors ────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE vendors (
      id            BIGSERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      website       TEXT,
      notes         TEXT,
      needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_vendors_slug         ON vendors(slug);
    CREATE INDEX idx_vendors_needs_review ON vendors(needs_review) WHERE needs_review = TRUE;
    CREATE INDEX idx_vendors_active       ON vendors(id) WHERE deleted_at IS NULL;
    CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── vendor_products ────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE vendor_products (
      id            BIGSERIAL PRIMARY KEY,
      vendor_id     BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL,
      category      TEXT NOT NULL,
      notes         TEXT,
      needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vendor_id, slug)
    );
    CREATE INDEX idx_vendor_products_vendor       ON vendor_products(vendor_id);
    CREATE INDEX idx_vendor_products_category     ON vendor_products(category);
    CREATE INDEX idx_vendor_products_needs_review ON vendor_products(needs_review) WHERE needs_review = TRUE;
    CREATE INDEX idx_vendor_products_active       ON vendor_products(id) WHERE deleted_at IS NULL;
    CREATE TRIGGER vendor_products_updated_at BEFORE UPDATE ON vendor_products
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── account_details ────────────────────────────────────────────────────
  // One row per account. account_id is the PK and FK both — true 1-1.
  // Vendor product arrays default to '{}' so we never have to coalesce NULLs
  // on the read side.
  pgm.sql(`
    CREATE TABLE account_details (
      account_id            BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

      -- firmographic
      industry              TEXT,
      revenue_usd           BIGINT,
      employee_count        INT,
      user_count            INT,
      endpoint_count        INT,
      server_count          INT,
      site_count            INT,
      dc_count              INT,
      hq_city               TEXT,
      hq_state              TEXT,
      hq_country            TEXT,
      it_team_size          INT,
      security_team_size    INT,

      -- categorical (non-vendor)
      soc_model             TEXT,
      compliance_frameworks TEXT[]  NOT NULL DEFAULT '{}',
      has_ot_environment    BOOLEAN,
      has_iot_environment   BOOLEAN,

      -- vendor product arrays (each element is vendor_products.id)
      firewall_ids          BIGINT[] NOT NULL DEFAULT '{}',
      edr_ids               BIGINT[] NOT NULL DEFAULT '{}',
      siem_ids              BIGINT[] NOT NULL DEFAULT '{}',
      idp_ids               BIGINT[] NOT NULL DEFAULT '{}',
      mfa_ids               BIGINT[] NOT NULL DEFAULT '{}',
      pam_ids               BIGINT[] NOT NULL DEFAULT '{}',
      email_security_ids    BIGINT[] NOT NULL DEFAULT '{}',
      mdr_ids               BIGINT[] NOT NULL DEFAULT '{}',
      msp_ids               BIGINT[] NOT NULL DEFAULT '{}',
      sase_ids              BIGINT[] NOT NULL DEFAULT '{}',
      sdwan_ids             BIGINT[] NOT NULL DEFAULT '{}',
      vpn_ids               BIGINT[] NOT NULL DEFAULT '{}',
      dlp_ids               BIGINT[] NOT NULL DEFAULT '{}',
      casb_ids              BIGINT[] NOT NULL DEFAULT '{}',
      vuln_mgmt_ids         BIGINT[] NOT NULL DEFAULT '{}',
      ticketing_ids         BIGINT[] NOT NULL DEFAULT '{}',
      email_collab_ids      BIGINT[] NOT NULL DEFAULT '{}',
      cloud_provider_ids    BIGINT[] NOT NULL DEFAULT '{}',

      -- prose + meta
      technical_notes       TEXT,
      last_verified_at      TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_account_details_industry         ON account_details(industry);
    CREATE INDEX idx_account_details_revenue          ON account_details(revenue_usd);
    CREATE INDEX idx_account_details_employee_count   ON account_details(employee_count);
    CREATE INDEX idx_account_details_site_count       ON account_details(site_count);
    CREATE INDEX idx_account_details_firewall_ids     ON account_details USING GIN (firewall_ids);
    CREATE INDEX idx_account_details_edr_ids          ON account_details USING GIN (edr_ids);
    CREATE INDEX idx_account_details_siem_ids         ON account_details USING GIN (siem_ids);
    CREATE INDEX idx_account_details_idp_ids          ON account_details USING GIN (idp_ids);
    CREATE INDEX idx_account_details_compliance       ON account_details USING GIN (compliance_frameworks);
    CREATE TRIGGER account_details_updated_at BEFORE UPDATE ON account_details
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // RLS: account_details visibility follows the parent account. vendors and
  // vendor_products are a shared global catalog, no RLS.
  pgm.sql(`
    ALTER TABLE account_details ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_details FORCE  ROW LEVEL SECURITY;

    CREATE POLICY account_details_isolation ON account_details
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_details.account_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_details.account_id)
      );
  `);

  // ── backfill: accounts.environment → account_details.technical_notes ───
  // Build a sorted "key: value" prose blob from the existing JSONB so the
  // structured handoff context isn't lost when we drop the column.
  pgm.sql(`
    INSERT INTO account_details (account_id, technical_notes)
    SELECT
      a.id,
      (
        SELECT string_agg(key || ': ' || value, E'\n' ORDER BY key)
        FROM jsonb_each_text(a.environment)
      )
    FROM accounts a
    WHERE a.environment IS NOT NULL
      AND jsonb_typeof(a.environment) = 'object'
      AND a.environment <> '{}'::jsonb;
  `);

  // ── drop accounts.environment and rebuild search_vector without it ─────
  // The generated search_vector references environment, so it has to be
  // dropped before the column itself.
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts DROP COLUMN environment;

    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);
};

exports.down = (pgm) => {
  // Restore the column (data is unrecoverable — backfill was lossy).
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts ADD COLUMN environment JSONB;

    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(environment::text, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);

  pgm.sql(`
    DROP POLICY IF EXISTS account_details_isolation ON account_details;
    ALTER TABLE account_details DISABLE ROW LEVEL SECURITY;

    DROP TABLE IF EXISTS account_details;
    DROP TABLE IF EXISTS vendor_products;
    DROP TABLE IF EXISTS vendors;
  `);
};
