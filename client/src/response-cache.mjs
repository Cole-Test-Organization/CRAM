import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RESPONSE_CACHE_VERSION = 1;
const INDEX_FILENAME = 'index.json';
const RESPONSES_DIRECTORY = 'responses';
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const CACHEABLE_API_PATHS = [
  /^\/api\/health$/,
  /^\/api\/accounts(?:\/|$)/,
  /^\/api\/contacts(?:\/|$)/,
  /^\/api\/meetings(?:\/|$)/,
  /^\/api\/opportunities(?:\/|$)/,
  /^\/api\/products(?:\/|$)/,
  /^\/api\/product-categories(?:\/|$)/,
  /^\/api\/vendors(?:\/|$)/,
  /^\/api\/vendor-products(?:\/|$)/,
  /^\/api\/events(?:\/|$)/,
  /^\/api\/notes(?:\/|$)/,
  /^\/api\/threads(?:\/|$)/,
];

export function isDesktopCacheKey(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'cram:'
      && url.host === 'app'
      && !url.username
      && !url.password
      && CACHEABLE_API_PATHS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

function responseFilename(key) {
  return `${createHash('sha256').update(key).digest('hex')}.json`;
}

function normalizeCachedResponse(value) {
  const status = Number(value?.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('Cached response status must be an HTTP status code.');
  }
  const statusText = typeof value?.statusText === 'string'
    ? value.statusText.slice(0, 256)
    : '';
  if (!value?.headers || typeof value.headers !== 'object' || Array.isArray(value.headers)) {
    throw new Error('Cached response headers must be an object.');
  }
  const headers = {};
  for (const [name, headerValue] of Object.entries(value.headers)) {
    if (typeof headerValue !== 'string') {
      throw new Error('Cached response header values must be strings.');
    }
    headers[String(name).slice(0, 256)] = headerValue.slice(0, 16_384);
  }
  if (typeof value?.bodyBase64 !== 'string') {
    throw new Error('Cached response body must be base64 text.');
  }
  const decodedBytes = Buffer.byteLength(value.bodyBase64, 'base64');
  if (decodedBytes > MAX_BODY_BYTES) {
    throw new Error('Cached response body exceeds the desktop cache limit.');
  }
  return {
    status,
    statusText,
    headers,
    bodyBase64: value.bodyBase64,
  };
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (process.platform !== 'win32') await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
}

export function createFileResponseCache({ directory }) {
  if (!path.isAbsolute(directory || '')) {
    throw new Error('A private absolute response-cache directory is required.');
  }

  const responsesDirectory = path.join(directory, RESPONSES_DIRECTORY);
  const indexPath = path.join(directory, INDEX_FILENAME);
  let initialization;
  let knownKeys = new Set();
  const pendingWrites = new Set();

  async function initialize() {
    if (!initialization) {
      initialization = (async () => {
        await mkdir(responsesDirectory, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') {
          await chmod(directory, 0o700);
          await chmod(responsesDirectory, 0o700);
        }
        try {
          const parsed = JSON.parse(await readFile(indexPath, 'utf8'));
          if (parsed?.version !== RESPONSE_CACHE_VERSION || !Array.isArray(parsed.keys)) return;
          knownKeys = new Set(parsed.keys.filter(isDesktopCacheKey));
        } catch (error) {
          if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
      })();
    }
    await initialization;
  }

  function entryPath(key) {
    return path.join(responsesDirectory, responseFilename(key));
  }

  async function flushIndex() {
    await writeJsonAtomically(indexPath, {
      version: RESPONSE_CACHE_VERSION,
      keys: [...knownKeys].sort(),
    });
  }

  function put(key, response) {
    if (!isDesktopCacheKey(key)) {
      return Promise.reject(new Error('CRAM Desktop rejected a non-cacheable API key.'));
    }
    let normalized;
    try {
      normalized = normalizeCachedResponse(response);
    } catch (error) {
      return Promise.reject(error);
    }

    const operation = (async () => {
      await initialize();
      await writeJsonAtomically(entryPath(key), {
        version: RESPONSE_CACHE_VERSION,
        key,
        response: normalized,
      });
      knownKeys.add(key);
    })();
    pendingWrites.add(operation);
    return operation.finally(() => pendingWrites.delete(operation));
  }

  async function waitForWrites() {
    await Promise.all([...pendingWrites]);
  }

  async function get(key) {
    if (!isDesktopCacheKey(key)) return null;
    await initialize();
    try {
      const parsed = JSON.parse(await readFile(entryPath(key), 'utf8'));
      if (
        parsed?.version !== RESPONSE_CACHE_VERSION
        || parsed?.key !== key
        || !parsed?.response
      ) {
        return null;
      }
      const response = normalizeCachedResponse(parsed.response);
      knownKeys.add(key);
      return response;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function keys() {
    await initialize();
    await waitForWrites();
    await flushIndex();
    return [...knownKeys].sort();
  }

  async function deleteKey(key) {
    if (!isDesktopCacheKey(key)) return;
    await initialize();
    await waitForWrites();
    await rm(entryPath(key), { force: true });
    knownKeys.delete(key);
    await flushIndex();
  }

  async function prune(keeping) {
    if (!Array.isArray(keeping) || !keeping.every(isDesktopCacheKey)) {
      throw new Error('CRAM Desktop rejected an invalid cache-prune request.');
    }
    await initialize();
    await waitForWrites();
    const keep = new Set(keeping);
    const removed = [...knownKeys].filter((key) => !keep.has(key));
    await Promise.all(removed.map((key) => rm(entryPath(key), { force: true })));
    knownKeys = new Set([...knownKeys].filter((key) => keep.has(key)));
    await flushIndex();
  }

  return {
    directory,
    put,
    get,
    keys,
    delete: deleteKey,
    prune,
  };
}
