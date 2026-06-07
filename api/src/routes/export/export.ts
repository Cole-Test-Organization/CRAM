import { gzipSync } from 'zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ExportService } from '../../services/export/export.js';

export default async function exportRoutes(fastify: FastifyInstance, { exportService }: { exportService: ExportService }) {
  // Export a single account as a tar.gz
  fastify.get<{ Params: { slug: string } }>('/export/accounts/:slug', {
    schema: {
      description: 'Export a single account as a .tar.gz archive of markdown files.',
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
    return sendTar(reply, `${request.params.slug}.tar.gz`, files);
  });

  // Export everything
  fastify.get('/export/all', {
    schema: {
      description: 'Export all accounts and internal notes as a .tar.gz archive.',
      tags: ['export'],
    },
  }, async (request, reply) => {
    const files = await exportService.exportAll(request.userId);
    return sendTar(reply, 'all-notes.tar.gz', files);
  });
}

/**
 * Build a tar archive in memory and stream it gzipped.
 * Uses a minimal tar implementation (no external dep needed).
 */
function sendTar(reply: FastifyReply, filename: string, files: { path: string; content: string }[]) {
  reply.header('Content-Type', 'application/gzip');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);

  const chunks: Buffer[] = [];

  for (const file of files) {
    const content = Buffer.from(file.content, 'utf-8');
    const header = createTarHeader(file.path, content.length);
    chunks.push(header);
    chunks.push(content);
    const remainder = content.length % 512;
    if (remainder > 0) {
      chunks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));

  const tarBuffer = Buffer.concat(chunks);

  const gzipped = gzipSync(tarBuffer);
  return reply.send(gzipped);
}

function createTarHeader(name: string, size: number) {
  const header = Buffer.alloc(512, 0);

  header.write(name.slice(0, 100), 0, 100, 'utf-8');
  header.write('0000644\0', 100, 8, 'utf-8');
  header.write('0001000\0', 108, 8, 'utf-8');
  header.write('0001000\0', 116, 8, 'utf-8');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
  header.write(mtime, 136, 12, 'utf-8');
  header.write('0', 156, 1, 'utf-8');
  header.write('ustar\0', 257, 6, 'utf-8');
  header.write('00', 263, 2, 'utf-8');

  header.write('        ', 148, 8, 'utf-8');
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

  return header;
}
