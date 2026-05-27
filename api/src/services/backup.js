// Scheduled / manual database backups via pg_dump. Dumps are written in the
// custom format (-Fc) so pg_restore --clean --if-exists can drop and recreate
// objects on restore — that's what "restore from nothing" requires.
//
// The target directory is bind-mounted into the container; in docker-compose
// it defaults to ./backups on the host, but BACKUP_HOST_DIR overrides to any
// absolute host path. Inside the container the path defaults to /backups,
// configurable per-instance via the `target_dir` setting (must be absolute).

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { getPool } from '../db/connection.js';
import { logger as rootLogger } from '../lib/logger.js';
import * as cron from '../lib/cron.js';

const logger = rootLogger.child({ component: 'backup' });

const DEFAULT_SETTINGS = {
  enabled: false,
  cron: '0 2 * * *',
  retention_count: 30,
  target_dir: process.env.BACKUP_DIR || '/backups',
};

const FILENAME_PREFIX = 'crm-';
const FILENAME_EXT = '.dump';
const FILENAME_RE = /^crm-[0-9TZ\-]+\.dump$/;

function timestampForFilename(date = new Date()) {
  // ISO with `:` swapped for `-` so the filename is filesystem-safe everywhere.
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

function parsePgConnection(databaseUrl) {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

function pgEnv(conn) {
  // PG* env vars are how pg_dump / pg_restore consume connection params without
  // surfacing the password on the command line.
  return {
    ...process.env,
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGDATABASE: conn.database,
  };
}

function runProcess(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export class BackupService {
  constructor({ databaseUrl } = {}) {
    this.databaseUrl = databaseUrl || process.env.DATABASE_URL || 'postgres://crm:devpassword@db:5432/crm';
    this.onSettingsChanged = null;
  }

  // Hook called after updateSettings — the scheduler subscribes so a saved
  // cron change takes effect without a process restart.
  setOnSettingsChanged(fn) {
    this.onSettingsChanged = fn;
  }

  async getSettings() {
    const pool = getPool();
    const row = (await pool.query(
      "SELECT value FROM app_settings WHERE key = 'backup'"
    )).rows[0];
    return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
  }

  async updateSettings(patch) {
    if (patch == null || typeof patch !== 'object') {
      throw Object.assign(new Error('settings patch must be an object'), { statusCode: 400 });
    }
    if (patch.cron !== undefined && !cron.validate(patch.cron)) {
      throw Object.assign(new Error(`invalid cron expression: ${patch.cron}`), { statusCode: 400 });
    }
    if (patch.retention_count !== undefined) {
      if (!Number.isInteger(patch.retention_count) || patch.retention_count < 0) {
        throw Object.assign(new Error('retention_count must be a non-negative integer (0 = keep all)'), { statusCode: 400 });
      }
    }
    if (patch.target_dir !== undefined) {
      if (typeof patch.target_dir !== 'string' || !path.isAbsolute(patch.target_dir)) {
        throw Object.assign(new Error('target_dir must be an absolute path'), { statusCode: 400 });
      }
    }
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
      throw Object.assign(new Error('enabled must be a boolean'), { statusCode: 400 });
    }

    const current = await this.getSettings();
    const next = { ...current, ...patch };
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('backup', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(next)]
    );
    if (this.onSettingsChanged) {
      try { await this.onSettingsChanged(next); } catch (err) {
        logger.error({ err: err.message }, 'onSettingsChanged hook threw');
      }
    }
    return next;
  }

  async _ensureTargetDir() {
    const { target_dir } = await this.getSettings();
    await fs.mkdir(target_dir, { recursive: true });
    return target_dir;
  }

  async listBackups() {
    const target_dir = await this._ensureTargetDir();
    let entries;
    try {
      entries = await fs.readdir(target_dir);
    } catch (err) {
      if (err.code === 'ENOENT') return { target_dir, backups: [] };
      throw err;
    }
    const files = entries.filter((f) => FILENAME_RE.test(f));
    const stats = await Promise.all(files.map(async (name) => {
      const full = path.join(target_dir, name);
      const st = await fs.stat(full);
      return {
        filename: name,
        size_bytes: st.size,
        created_at: st.mtime.toISOString(),
      };
    }));
    stats.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { target_dir, backups: stats };
  }

  async runBackup() {
    const settings = await this.getSettings();
    const target_dir = await this._ensureTargetDir();
    const conn = parsePgConnection(this.databaseUrl);
    const filename = `${FILENAME_PREFIX}${timestampForFilename()}${FILENAME_EXT}`;
    const outPath = path.join(target_dir, filename);

    logger.info({ event: 'backup.start', filename, target_dir }, 'starting pg_dump');
    const startedAt = Date.now();
    try {
      await runProcess(
        'pg_dump',
        ['-Fc', '-Z', '6', '-f', outPath],
        pgEnv(conn)
      );
    } catch (err) {
      // Leave partial dump alone for inspection; pg_dump aborts atomically on
      // error in -Fc mode so the file is likely zero-byte or absent.
      await fs.unlink(outPath).catch(() => {});
      logger.error({ event: 'backup.failed', err: err.message }, 'pg_dump failed');
      throw err;
    }

    const st = await fs.stat(outPath);
    const result = {
      filename,
      size_bytes: st.size,
      created_at: st.mtime.toISOString(),
      duration_ms: Date.now() - startedAt,
    };
    logger.info({ event: 'backup.completed', ...result }, 'pg_dump completed');

    if (settings.retention_count > 0) {
      await this._prune(target_dir, settings.retention_count);
    }
    return result;
  }

  async _prune(target_dir, keep) {
    const { backups } = await this.listBackups();
    const toDelete = backups.slice(keep);
    for (const b of toDelete) {
      await fs.unlink(path.join(target_dir, b.filename)).catch((err) => {
        logger.warn({ event: 'backup.prune_failed', filename: b.filename, err: err.message }, 'prune failed');
      });
    }
    if (toDelete.length > 0) {
      logger.info({ event: 'backup.pruned', count: toDelete.length }, 'pruned old backups');
    }
  }

  async restoreBackup(filename) {
    if (!FILENAME_RE.test(filename)) {
      throw Object.assign(new Error('invalid backup filename'), { statusCode: 400 });
    }
    const target_dir = await this._ensureTargetDir();
    const fullPath = path.join(target_dir, filename);
    try { await fs.access(fullPath); }
    catch { throw Object.assign(new Error(`backup not found: ${filename}`), { statusCode: 404 }); }

    const conn = parsePgConnection(this.databaseUrl);
    logger.warn({ event: 'restore.start', filename }, 'starting pg_restore --clean');
    const startedAt = Date.now();
    try {
      await runProcess(
        'pg_restore',
        // --clean drops existing objects before recreating; --if-exists prevents
        // errors when targets are missing (e.g. restoring into a freshly-init'd
        // database). --no-owner / --no-privileges keep the dump portable across
        // role names; --exit-on-error halts on the first non-fatal issue.
        ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '-d', conn.database, fullPath],
        pgEnv(conn)
      );
    } catch (err) {
      logger.error({ event: 'restore.failed', err: err.message }, 'pg_restore failed');
      throw err;
    }
    const result = { filename, restored_at: new Date().toISOString(), duration_ms: Date.now() - startedAt };
    logger.warn({ event: 'restore.completed', ...result }, 'pg_restore completed');
    return result;
  }

  async deleteBackup(filename) {
    if (!FILENAME_RE.test(filename)) {
      throw Object.assign(new Error('invalid backup filename'), { statusCode: 400 });
    }
    const target_dir = await this._ensureTargetDir();
    const fullPath = path.join(target_dir, filename);
    try { await fs.unlink(fullPath); }
    catch (err) {
      if (err.code === 'ENOENT') throw Object.assign(new Error(`backup not found: ${filename}`), { statusCode: 404 });
      throw err;
    }
    return { deleted: true, filename };
  }

  // Returns a (stream, fullPath) pair for the HTTP download route. Caller is
  // responsible for piping to the reply.
  async openBackupStream(filename) {
    if (!FILENAME_RE.test(filename)) {
      throw Object.assign(new Error('invalid backup filename'), { statusCode: 400 });
    }
    const target_dir = await this._ensureTargetDir();
    const fullPath = path.join(target_dir, filename);
    try { await fs.access(fullPath); }
    catch { throw Object.assign(new Error(`backup not found: ${filename}`), { statusCode: 404 }); }
    return { stream: createReadStream(fullPath), fullPath };
  }
}
