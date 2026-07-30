import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4_000;
const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key|body|headers/i;

function redactText(value) {
  const truncated = value.length > MAX_TEXT_LENGTH
    ? `${value.slice(0, MAX_TEXT_LENGTH)}…`
    : value;
  return truncated
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(
      /\b(authorization|cookie|set-cookie|password|secret|token|api[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      '$1$2[REDACTED]',
    )
    .replace(/([?&][A-Za-z0-9_.~-]+=)[^&#\s]*/g, '$1…');
}

function safeValue(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
      code: typeof value.code === 'string' || typeof value.code === 'number'
        ? value.code
        : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => safeValue(entry, '', seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
      result[entryKey] = safeValue(entryValue, entryKey, seen);
    }
    seen.delete(value);
    return result;
  }
  return redactText(String(value));
}

export function diagnosticError(error) {
  return safeValue(error instanceof Error ? error : new Error(String(error)));
}

export function createClientLogger({
  directory,
  filename = 'client.log',
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => new Date(),
} = {}) {
  if (!path.isAbsolute(directory || '')) {
    throw new Error('A private absolute log directory is required.');
  }
  const filePath = path.join(directory, filename);
  const previousFilePath = path.join(directory, `${filename}.previous`);

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(directory, 0o700);

  function rotateIfNeeded(nextBytes = 0) {
    if (!existsSync(filePath)) return;
    if (statSync(filePath).size + nextBytes < maxBytes) return;
    rmSync(previousFilePath, { force: true });
    renameSync(filePath, previousFilePath);
  }

  function write(level, event, details = {}) {
    try {
      const line = `${JSON.stringify({
        timestamp: now().toISOString(),
        level,
        event: redactText(String(event)),
        details: safeValue(details),
      })}\n`;
      rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(filePath, line, { encoding: 'utf8', mode: 0o600 });
      chmodSync(filePath, 0o600);
    } catch (error) {
      process.stderr.write(`[CRAM Desktop logger failed] ${error?.message || String(error)}\n`);
    }
  }

  // Create the file immediately so "Show Diagnostic Log" always has a target.
  write('info', 'log.opened', { filePath, maxBytes });

  return {
    filePath,
    previousFilePath,
    debug: (event, details) => write('debug', event, details),
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}
