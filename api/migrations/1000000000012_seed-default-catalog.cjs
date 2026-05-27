// Seed the default user's product catalog with an example vendor lineup.
//
// This bundled example seeds a Palo Alto Networks product catalog because that
// is what the original author sells. **If you are not a PANW SE, edit the
// lists below before running migrations** — replace with your own product
// names and categories, or empty the INSERTs to start with a clean catalog.
//
// Idempotent: re-running this migration is a no-op (ON CONFLICT DO NOTHING on
// the (user_id, name) unique constraints). The migration only seeds the
// *first* user (default user created in 1000000000002_multi-tenancy.cjs), so
// additional users on the same instance start with an empty catalog and add
// their own.

exports.up = (pgm) => {
    pgm.sql(`
    DO $$
    DECLARE
      uid         bigint;
      soc_id      bigint;
      cloud_id    bigint;
      network_id  bigint;
      ai_id       bigint;
      identity_id bigint;
    BEGIN
      SELECT id INTO uid FROM users ORDER BY id LIMIT 1;
      IF uid IS NULL THEN RETURN; END IF;

      INSERT INTO product_categories (user_id, name) VALUES
        (uid, 'SOC'),
        (uid, 'Cloud'),
        (uid, 'Network'),
        (uid, 'AI Security'),
        (uid, 'Identity')
      ON CONFLICT (user_id, name) DO NOTHING;

      SELECT id INTO soc_id      FROM product_categories WHERE user_id = uid AND name = 'SOC';
      SELECT id INTO cloud_id    FROM product_categories WHERE user_id = uid AND name = 'Cloud';
      SELECT id INTO network_id  FROM product_categories WHERE user_id = uid AND name = 'Network';
      SELECT id INTO ai_id       FROM product_categories WHERE user_id = uid AND name = 'AI Security';
      SELECT id INTO identity_id FROM product_categories WHERE user_id = uid AND name = 'Identity';

      INSERT INTO products (user_id, name, category_id) VALUES
        (uid, 'Cortex XDR',    soc_id),
        (uid, 'Cortex XSIAM',  soc_id),
        (uid, 'Cortex XSOAR / Agentix',  soc_id),
        (uid, 'Cortex Xpanse', soc_id),
        (uid, 'Unit 42',       soc_id),

        (uid, 'Cortex Cloud Posture',              cloud_id),
        (uid, 'Cortex Cloud Application Security', cloud_id),
        (uid, 'Cortex Cloud Runtime',              cloud_id),

        (uid, 'PA-Series Firewalls',  network_id),
        (uid, 'VM-Series Firewalls',  network_id),
        (uid, 'Panorama',             network_id),
        (uid, 'Strata Cloud Manager', network_id),
        (uid, 'Prisma Access',        network_id),
        (uid, 'Prisma SD-WAN',        network_id),
        (uid, 'Device Security',      network_id),
        (uid, 'CASB',                 network_id),
        (uid, 'GlobalProtect/PAA',        network_id),
        (uid, 'Prisma Browser',       network_id),

        (uid, 'AI Access',                       ai_id),
        (uid, 'AIRS Network Intercept',                   ai_id),
        (uid, 'AI Security Posture Management (AI-SPM)',  ai_id),
        (uid, 'AI Red Teaming',                           ai_id),
        (uid, 'AIRS API Intercept',                       ai_id),

        (uid, 'CyberArk/Idira',                           identity_id)
      ON CONFLICT (user_id, name) DO NOTHING;
    END $$;
  `);
};

exports.down = (pgm) => {
    // Best-effort teardown: only remove rows that match the seeded names exactly,
    // and only for the default user. Anything the user renamed stays put.
    pgm.sql(`
    DO $$
    DECLARE
      uid bigint;
    BEGIN
      SELECT id INTO uid FROM users ORDER BY id LIMIT 1;
      IF uid IS NULL THEN RETURN; END IF;

      DELETE FROM products WHERE user_id = uid AND name IN (
        'Cortex XDR', 'Cortex XSIAM', 'Cortex XSOAR', 'Cortex Xpanse', 'Unit 42',
        'Cortex Cloud Posture', 'Cortex Cloud Application Security', 'Cortex Cloud Runtime',
        'PA-Series Firewalls', 'VM-Series Firewalls', 'Panorama', 'Strata Cloud Manager',
        'Prisma Access', 'Prisma SD-WAN', 'Device Security', 'CASB',
        'GlobalProtect', 'Prisma Browser',
        'AI Access Security', 'AIRS Network Intercept',
        'AI Security Posture Management (AI-SPM)', 'AI Red Teaming', 'AIRS API Intercept',
        'CyberArk/Idira'
      );

      DELETE FROM product_categories WHERE user_id = uid AND name IN
        ('SOC', 'Cloud', 'Network', 'AI Security', 'Identity');
    END $$;
  `);
};
