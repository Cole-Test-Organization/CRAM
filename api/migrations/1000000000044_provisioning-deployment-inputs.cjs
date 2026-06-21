exports.up = (pgm) => {
  pgm.addColumn('deployments', {
    inputs: {
      type: 'jsonb',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('deployments', 'inputs');
};
