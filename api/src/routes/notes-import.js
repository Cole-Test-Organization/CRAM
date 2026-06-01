import { filesFromZip } from '../services/notes-import.js';

// Notes-import HTTP surface. Two intakes, one pipeline:
//   - POST /api/notes-import           — JSON { files: [{path, content}] }.
//       The GUI reads a chosen directory client-side (<input webkitdirectory>)
//       and posts the text files. Canonical input; also the MCP-reachable shape.
//   - POST /api/notes-import/upload-zip — raw application/octet-stream .zip.
//       Server unpacks text entries into the same files[] list.
// Both return { jobId } immediately; poll GET /api/notes-import/jobs/:jobId.
//
// Bodies are large (a directory of notes), so this plugin raises the body limit
// well above Fastify's 1MB default and registers an octet-stream passthrough
// parser scoped to this plugin (mirrors the backup upload route).

const BODY_LIMIT = Number(process.env.NOTES_IMPORT_BODY_LIMIT) || 64 * 1024 * 1024; // 64MB

export default async function notesImportRoutes(fastify, { notesImportService }) {
  // Raw zip upload: keep request.body as the unparsed stream so we can buffer it.
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
    done(null, body);
  });

  // JSON intake — the directory-picker path.
  fastify.post('/notes-import', {
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
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Zip upload — server unpacks text entries, then same pipeline.
  fastify.post('/notes-import/upload-zip', {
    bodyLimit: BODY_LIMIT,
    schema: {
      description: 'Import notes from an uploaded .zip. Send the raw archive as application/octet-stream. The server extracts text entries (.md/.markdown/.txt/.org/.rst; binaries, dotfiles, and __MACOSX junk are ignored) into the same files[] list as POST /api/notes-import and enqueues the job. Returns { jobId, file_count }. Poll GET /api/notes-import/jobs/:jobId. Exporting from Google Drive? A raw folder download is all .docx/.pdf, which get skipped — run Google Takeout with Documents set to Plain Text (.txt), or download docs individually as Markdown (.md), before zipping.',
      tags: ['notes-import'],
      consumes: ['application/octet-stream'],
    },
  }, async (request, reply) => {
    const buf = request.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      reply.code(400);
      return { error: 'Empty body. POST the raw .zip bytes with Content-Type: application/octet-stream.' };
    }
    let files;
    try {
      files = filesFromZip(buf);
    } catch (err) {
      reply.code(400);
      return { error: `Could not read zip: ${err.message}` };
    }
    if (files.length === 0) {
      reply.code(400);
      return { error: 'No text notes found in the archive (looked for .md/.markdown/.txt/.org/.rst).' };
    }
    try {
      const jobId = notesImportService.enqueue(request.userId, { files });
      reply.code(202);
      return { jobId, file_count: files.length };
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Poll a single import job.
  fastify.get('/notes-import/jobs/:jobId', {
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
  fastify.get('/notes-import/jobs', {
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
