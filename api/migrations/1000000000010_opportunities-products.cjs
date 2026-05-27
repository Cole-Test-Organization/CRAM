// Opportunities, products, and product categories.
//
// Opportunities are sales deals attached to a customer account (the service
// layer rejects opps on partner accounts since channels aren't sold *to*).
// Products are a per-user catalog of things you sell; categories let the user
// group their catalog. Opps and products are many-to-many via opp_products.
//
// All four tables follow the existing per-user RLS pattern.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE product_categories (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE INDEX idx_product_categories_user ON product_categories(user_id);
    CREATE TRIGGER product_categories_updated_at BEFORE UPDATE ON product_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE products (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      category_id BIGINT REFERENCES product_categories(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE INDEX idx_products_user ON products(user_id);
    CREATE INDEX idx_products_category ON products(category_id);
    CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE opportunities (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      amount        NUMERIC(14, 2),
      opp_link      TEXT,
      trr_link      TEXT,
      stage         TEXT NOT NULL DEFAULT 'open'
                    CHECK (stage IN ('open', 'closed_won', 'closed_lost')),
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(name, '') || ' ' ||
          coalesce(stage, '') || ' ' ||
          coalesce(notes, '')
        )
      ) STORED
    );
    CREATE INDEX idx_opportunities_user    ON opportunities(user_id);
    CREATE INDEX idx_opportunities_account ON opportunities(account_id);
    CREATE INDEX idx_opportunities_stage   ON opportunities(stage);
    CREATE INDEX idx_opportunities_search  ON opportunities USING GIN (search_vector);
    CREATE TRIGGER opportunities_updated_at BEFORE UPDATE ON opportunities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE opp_products (
      opportunity_id BIGINT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      PRIMARY KEY (opportunity_id, product_id)
    );
    CREATE INDEX idx_opp_products_product ON opp_products(product_id);
  `);

  pgm.sql(`
    ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE product_categories FORCE  ROW LEVEL SECURITY;
    ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
    ALTER TABLE products           FORCE  ROW LEVEL SECURITY;
    ALTER TABLE opportunities      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE opportunities      FORCE  ROW LEVEL SECURITY;
    ALTER TABLE opp_products       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE opp_products       FORCE  ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    CREATE POLICY product_categories_isolation ON product_categories
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY products_isolation ON products
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY opportunities_isolation ON opportunities
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY opp_products_isolation ON opp_products
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM opportunities o WHERE o.id = opp_products.opportunity_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM opportunities o WHERE o.id = opp_products.opportunity_id)
        AND EXISTS (SELECT 1 FROM products p WHERE p.id = opp_products.product_id)
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS opp_products_isolation       ON opp_products;
    DROP POLICY IF EXISTS opportunities_isolation      ON opportunities;
    DROP POLICY IF EXISTS products_isolation           ON products;
    DROP POLICY IF EXISTS product_categories_isolation ON product_categories;

    ALTER TABLE opp_products       DISABLE ROW LEVEL SECURITY;
    ALTER TABLE opportunities      DISABLE ROW LEVEL SECURITY;
    ALTER TABLE products           DISABLE ROW LEVEL SECURITY;
    ALTER TABLE product_categories DISABLE ROW LEVEL SECURITY;

    DROP TABLE IF EXISTS opp_products;
    DROP TABLE IF EXISTS opportunities;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS product_categories;
  `);
};
