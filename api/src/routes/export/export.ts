import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ExportFile, ExportService } from '../../services/export/export.js';
import { buildDriveArchive } from '../../services/export/drive-archive.js';

export default async function exportRoutes(fastify: FastifyInstance, { exportService }: { exportService: ExportService }) {
  // Export a caller-selected set of accounts as one Drive-ready zip.
  fastify.post<{ Body: { slugs: string[] } }>('/export/accounts', {
    schema: {
      description: 'Export one or more selected accounts as a single .zip. The archive contains one folder per account, with an overview, contacts (when present), and one editable .docx document per meeting.',
      tags: ['export'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['slugs'],
        properties: {
          slugs: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const files = await exportService.exportAccounts(request.userId, request.body.slugs);
      return sendDriveZip(reply, driveArchiveFilename(request.body.slugs), files);
    } catch (err) {
      const error = err as { statusCode?: number; message?: string };
      if (error.statusCode) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw err;
    }
  });

  // Export a single account as a Drive-ready zip of Word documents.
  fastify.get<{ Params: { slug: string } }>('/export/accounts/:slug', {
    schema: {
      description: 'Export a single account as a .zip that unpacks into a Google Drive-ready folder. Contains an account overview, contacts (when present), and one editable .docx document per meeting.',
      tags: ['export'],
      params: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
    },
  }, async (request, reply) => {
    const files = await exportService.exportAccount(request.userId, request.params.slug);
    if (!files) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return sendDriveZip(reply, `${request.params.slug}-google-drive.zip`, files);
  });

  // Export everything
  fastify.get('/export/all', {
    schema: {
      description: 'Export all accounts and internal notes as a .zip of Google Drive-friendly .docx documents.',
      tags: ['export'],
    },
  }, async (request, reply) => {
    const files = await exportService.exportAll(request.userId);
    return sendDriveZip(reply, 'all-accounts-google-drive.zip', files);
  });
}

async function sendDriveZip(reply: FastifyReply, filename: string, files: ExportFile[]) {
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  return reply.send(await buildDriveArchive(files));
}

function driveArchiveFilename(slugs: string[]) {
  if (slugs.length === 1) {
    const slug = slugs[0].replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'account';
    return `${slug}-google-drive.zip`;
  }
  return `accounts-google-drive-${new Date().toISOString().slice(0, 10)}.zip`;
}
