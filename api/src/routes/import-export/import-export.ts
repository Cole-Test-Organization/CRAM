// Portable JSON import/export for accounts (plus their details, contacts,
// meetings, opportunities, and partner shells). Different from the existing
// document export under /api/export — those routes produce human-readable ZIP
// files; these produce JSON suitable for re-importing into another tenant.

import type { FastifyInstance } from 'fastify';
import type { ImportExportService } from '../../services/import-export/import-export.js';

export default async function importExportRoutes(fastify: FastifyInstance, { importExportService }: { importExportService: ImportExportService }) {
  fastify.post<{ Body: { slugs: string[] } }>('/import-export/export', {
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
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.get<{ Params: { slug: string } }>('/import-export/accounts/:slug', {
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
      description: 'Import a portable account bundle. Idempotent merge: existing rows are updated by slug/filename/email/name; missing rows are created. Meeting attendees are re-linked only when they are contacts on the imported account — unlinked attendees in the bundle are dropped, not created as standalone contacts. Returns a per-account summary.',
      tags: ['import-export'],
      // Body is the bundle itself — too dynamic to fully spec here; the service validates.
    },
    bodyLimit: 50 * 1024 * 1024, // 50 MB ceiling for large multi-account bundles
  }, async (request, reply) => {
    try {
      return await importExportService.importBundle(request.userId, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
