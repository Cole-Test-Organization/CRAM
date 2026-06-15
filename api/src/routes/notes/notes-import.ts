import type { FastifyInstance } from 'fastify';
import { noteFilesFromZip, SUPPORTED_NOTE_FILE_DESCRIPTION } from '../../services/_shared/_note-file-conversion.js';
import type { NotesImportService } from '../../services/notes/notes-import.js';

// Notes-import HTTP surface. Two intakes, one pipeline:
//   - POST /api/notes-import           — JSON { files: [{path, content}] }.
//       The GUI reads a chosen directory client-side (<input webkitdirectory>)
//       and posts the text files. Canonical input; also the MCP-reachable shape.
//   - POST /api/notes-import/upload-zip — raw application/octet-stream .zip.
//       Server unpacks text entries and converts supported document formats into
//       the same files[] list.
// Both return { jobId } immediately; poll GET /api/notes-import/jobs/:jobId.
//
// Bodies are large (a directory of notes), so this plugin raises the body limit
// well above Fastify's 1MB default and registers an octet-stream passthrough
// parser scoped to this plugin (mirrors the backup upload route).

const BODY_LIMIT = Number(process.env.NOTES_IMPORT_BODY_LIMIT) || 64 * 1024 * 1024; // 64MB

export default async function notesImportRoutes(fastify: FastifyInstance, { notesImportService }: { notesImportService: NotesImportService }) {
  // Raw zip upload: keep request.body as the unparsed stream so we can buffer it.
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body: Buffer, done) => {
    done(null, body);
  });

  // JSON intake — the directory-picker path.
  fastify.post<{ Body: { files: { path: string; content: string }[] } }>('/notes-import', {
    bodyLimit: BODY_LIMIT,
    schema: {
      description: 'Import a directory of notes. Body is { files: [{ path, content }] } — read the notes client-side and send their text. Each file is run through the local model one at a time to extract metadata (date, title, account, attendees), then resolved to an account: a confident match is linked; an unknown company auto-creates a flagged account; an ambiguous match parks the note for triage. Returns { jobId } immediately — poll GET /api/notes-import/jobs/:jobId. Re-importing the same files is idempotent (skipped on a filename match).',
      tags: ['notes-import'],
      body: {
        type: 'object',
        required: ['files'],
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['path', 'content'],
              properties: {
                path: { type: 'string', description: 'Relative path within the dropped directory (used to derive a stable meeting filename for idempotency).' },
                content: { type: 'string', description: 'Full text of the note (markdown/plain). Stored verbatim as the meeting body.' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const jobId = notesImportService.enqueue(request.userId, { files: request.body.files });
      reply.code(202);
      return { jobId };
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Zip upload — server normalizes text-ish entries and supported documents into
  // files[] text records, then uses the same pipeline as JSON intake.
  fastify.post<{ Body: Buffer }>('/notes-import/upload-zip', {
    bodyLimit: BODY_LIMIT,
    schema: {
      description: 'Import notes from an uploaded .zip. Send the raw archive as application/octet-stream. The server extracts text entries (.md/.markdown/.txt/.org/.rst) and converts supported document entries (.docx and text-based .pdf) into the same files[] list as POST /api/notes-import, then enqueues the normal notes-import pipeline. Returns { jobId, file_count, converted_count, skipped_count, summary }. Poll GET /api/notes-import/jobs/:jobId. This supports zipped Google Drive folder downloads when the files are exported as .docx or text-based .pdf; scanned/image-only PDFs are skipped because they have no extractable text.',
      tags: ['notes-import'],
      consumes: ['application/octet-stream'],
    },
  }, async (request, reply) => {
    const buf = request.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      reply.code(400);
      return { error: 'Empty body. POST the raw .zip bytes with Content-Type: application/octet-stream.' };
    }
    let extracted;
    try {
      extracted = await noteFilesFromZip(buf);
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      reply.code(400);
      return { error: `Could not read zip: ${e.message}` };
    }
    const { files, summary } = extracted;
    if (files.length === 0) {
      reply.code(400);
      return {
        error: `No supported notes found in the archive (looked for ${SUPPORTED_NOTE_FILE_DESCRIPTION}).`,
        summary,
      };
    }
    try {
      const jobId = notesImportService.enqueue(request.userId, { files });
      reply.code(202);
      return {
        jobId,
        file_count: files.length,
        converted_count: summary.converted_files,
        skipped_count: summary.skipped_files,
        summary,
      };
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Poll a single import job.
  fastify.get<{ Params: { jobId: string } }>('/notes-import/jobs/:jobId', {
    schema: {
      description: 'Get the state of a notes-import job. status progresses queued → running → completed | failed; while running, stage shows progress ("extracting 12/40"). results[] holds a per-file outcome (linked | created | parked | skipped | error) and counts aggregates them.',
      tags: ['notes-import'],
      params: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const job = notesImportService.getJob(request.params.jobId);
    if (!job) { reply.code(404); return { error: `Notes-import job not found: ${request.params.jobId}. Jobs are in-memory and reset on server restart.` }; }
    return job;
  });

  // List recent import jobs.
  fastify.get<{ Querystring: { status?: 'queued' | 'running' | 'completed' | 'failed'; limit?: number } }>('/notes-import/jobs', {
    schema: {
      description: 'List recent notes-import jobs (newest first). Optional status filter (queued|running|completed|failed).',
      tags: ['notes-import'],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request) => {
    const { status, limit } = request.query;
    return { jobs: notesImportService.listJobs({ status, limit }) };
  });
}
