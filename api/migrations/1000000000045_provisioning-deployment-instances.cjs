// Deployment instances: a deployment row can now be a *clone* of a seeded template
// so the same blueprint (e.g. aws-windows-endpoint) can be launched any number of
// times under a user-chosen name, each fully isolated.
//
//   - template_name  the slug of the template a clone was made from. NULL means this
//                    row *is* a catalog template (the YAML-seeded originals).
//   - display_name   the human label the user typed for the instance (the slug in
//                    `name` is sanitized/unique; this preserves the original).
//
// Seed only ever upserts the YAML-named template rows and never sets template_name,
// so instances (non-YAML names) are untouched by the boot reseed.
exports.up = (pgm) => {
  pgm.addColumn('deployments', {
    template_name: { type: 'text', notNull: false },
    display_name: { type: 'text', notNull: false },
  });
  pgm.createIndex('deployments', ['user_id', 'template_name'], {
    name: 'idx_deployments_user_template',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('deployments', ['user_id', 'template_name'], {
    name: 'idx_deployments_user_template',
  });
  pgm.dropColumn('deployments', ['template_name', 'display_name']);
};
