// Backup admin endpoints. Backups are global / instance-wide (a pg_dump of the
// whole database, not per-tenant), so these routes don't scope by request.userId.

export default async function backupRoutes(fastify, { backupService }) {
  fastify.get('/backup/settings', {
    schema: {
      description: 'Get the current backup configuration (enabled, cron, retention_count, target_dir).',
      tags: ['backup'],
    },
  }, async () => {
    return backupService.getSettings();
  });

  fastify.put('/backup/settings', {
    schema: {
      description: 'Update the backup configuration. PATCH-merge — only fields you send are changed. Validates the cron expression, retention count, and target_dir (must be an absolute path inside the container — the host mount lives at /backups by default, configurable via the BACKUP_HOST_DIR env var on the host). Saving immediately reschedules the cron job.',
      tags: ['backup'],
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          cron: { type: 'string' },
          retention_count: { type: 'integer', minimum: 0 },
          target_dir: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    try {
      return await backupService.updateSettings(request.body);
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.get('/backup', {
    schema: {
      description: 'List existing backup files in the target directory (newest first).',
      tags: ['backup'],
    },
  }, async () => {
    return backupService.listBackups();
  });

  fastify.post('/backup/run', {
    schema: {
      description: 'Trigger a backup immediately. Returns the resulting filename, size, and duration.',
      tags: ['backup'],
    },
  }, async (request, reply) => {
    try {
      return await backupService.runBackup();
    } catch (err) {
      reply.code(500);
      return { error: err.message };
    }
  });

  fastify.post('/backup/restore', {
    schema: {
      description: 'Restore the database from a backup file. DESTRUCTIVE — drops and recreates all objects (pg_restore --clean --if-exists). Use only when intentionally rolling back; existing data is gone.',
      tags: ['backup'],
      body: {
        type: 'object',
        required: ['filename'],
        properties: { filename: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      return await backupService.restoreBackup(request.body.filename);
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      reply.code(500);
      return { error: err.message };
    }
  });

  fastify.get('/backup/download/:filename', {
    schema: {
      description: 'Download a backup file. Returns the raw pg_dump custom-format binary.',
      tags: ['backup'],
      params: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
    },
  }, async (request, reply) => {
    try {
      const { stream } = await backupService.openBackupStream(request.params.filename);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${request.params.filename}"`);
      return reply.send(stream);
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  fastify.delete('/backup/:filename', {
    schema: {
      description: 'Delete a backup file from disk.',
      tags: ['backup'],
      params: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
    },
  }, async (request, reply) => {
    try {
      return await backupService.deleteBackup(request.params.filename);
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });
}
