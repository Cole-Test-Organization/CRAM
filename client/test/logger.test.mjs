import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClientLogger, diagnosticError } from '../src/logger.mjs';

test('writes private JSONL diagnostics and redacts sensitive values', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-client-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = createClientLogger({
    directory,
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  });

  logger.error('protocol.api.failed', {
    path: '/api/accounts',
    authorization: 'Bearer should-never-land',
    message: 'token=also-secret connection refused at cram://app/api/search?q=private-name',
    error: new Error('Authorization: Bearer hidden-value'),
  });

  const contents = await readFile(logger.filePath, 'utf8');
  const lines = contents.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).timestamp, '2026-07-29T12:00:00.000Z');
  assert.equal(lines.at(-1).event, 'protocol.api.failed');
  assert.equal(lines.at(-1).details.authorization, '[REDACTED]');
  assert.match(lines.at(-1).details.message, /token=\[REDACTED\]/);
  assert.doesNotMatch(contents, /should-never-land|also-secret|hidden-value|private-name/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(logger.filePath)).mode & 0o777, 0o600);
  }
});

test('rotates one bounded previous log', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-client-log-rotate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = createClientLogger({ directory, maxBytes: 300 });

  logger.info('large.first', { message: 'a'.repeat(250) });
  logger.info('large.second', { message: 'b'.repeat(250) });

  assert.match(await readFile(logger.previousFilePath, 'utf8'), /large\.first/);
  assert.match(await readFile(logger.filePath, 'utf8'), /large\.second/);
});

test('normalizes thrown non-errors for diagnostics', () => {
  const details = diagnosticError('network unavailable');
  assert.equal(details.name, 'Error');
  assert.equal(details.message, 'network unavailable');
  assert.match(details.stack, /network unavailable/);
  assert.equal(details.code, undefined);
});
