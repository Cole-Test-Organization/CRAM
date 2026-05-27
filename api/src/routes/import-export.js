// Portable JSON import/export for accounts (plus their details, contacts,
// meetings, opportunities, and partner shells). Different from the existing
// markdown export under /api/export — those produce human-readable tar.gz
// bundles; these produce JSON suitable for re-importing into another tenant.

export default async function importExportRoutes(fastify, { importExportService }) {
  fastify.post('/import-export/export', {
    schema: {
      description: 'Export one or more accounts (with details, contacts, meetings, opportunities, partner shells) as a portable JSON bundle that can be re-imported into another tenant.',
      tags: ['import-export'],
      body: {
        type: 'object',
        required: ['slugs'],
        properties: {
          slugs: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const bundle = await importExportService.exportAccounts(request.userId, request.body.slugs);
      reply.header('Content-Type', 'application/json');
      reply.header(
        'Content-Disposition',
        `attachment; filename="accounts-export-${new Date().toISOString().slice(0, 10)}.json"`
      );
      return bundle;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  fastify.get('/import-export/accounts/:slug', {
    schema: {
      description: 'Export a single account as a portable JSON bundle (same shape as the bulk export, with one entry in `accounts`).',
      tags: ['import-export'],
      params: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    },
  }, async (request, reply) => {
    const bundle = await importExportService.exportAccounts(request.userId, [request.params.slug]);
    if (!bundle.accounts.length) {
      reply.code(404);
      return { error: `Account not found: ${request.params.slug}` };
    }
    reply.header('Content-Type', 'application/json');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${request.params.slug}.json"`
    );
    return bundle;
  });

  fastify.post('/import-export/import', {
    schema: {
      description: 'Import a portable account bundle. Idempotent merge: existing rows are updated by slug/filename/email/name; missing rows are created. Returns a per-account summary.',
      tags: ['import-export'],
      // Body is the bundle itself — too dynamic to fully spec here; the service validates.
    },
    bodyLimit: 50 * 1024 * 1024, // 50 MB ceiling for large multi-account bundles
  }, async (request, reply) => {
    try {
      return await importExportService.importBundle(request.userId, request.body);
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });
}
