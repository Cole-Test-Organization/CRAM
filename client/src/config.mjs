import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SERVER_URL = 'https://crm.home.justcole.com';
export const CONFIG_FILENAME = 'config.json';
export const DEFAULT_AUTO_OPEN_MEETING_NOTES = true;
export const DEFAULT_LAUNCH_AT_LOGIN = true;

export function normalizeServerUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('serverUrl must be a non-empty URL.');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid CRAM server URL: ${value}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('CRAM server URL must use https:// or http://.');
  }
  const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);
  if (url.protocol === 'http:' && !loopbackHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Plain HTTP is only allowed for loopback development. Use HTTPS for a remote CRAM server.');
  }
  if (url.username || url.password) {
    throw new Error('CRAM server URL must not contain credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('CRAM server URL must not contain a query string or fragment.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const normalized = url.toString();
  return url.pathname === '/' ? normalized.slice(0, -1) : normalized;
}

export function serverUrlFromArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--server-url') return argv[index + 1] || null;
    if (argument.startsWith('--server-url=')) return argument.slice('--server-url='.length);
  }
  return null;
}

export function serverStorageKey(serverUrl) {
  return createHash('sha256')
    .update(normalizeServerUrl(serverUrl))
    .digest('hex')
    .slice(0, 16);
}

async function writeConfigAtomically(configPath, serverUrl) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify({
    serverUrl,
    autoOpenMeetingNotes: DEFAULT_AUTO_OPEN_MEETING_NOTES,
    launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
  }, null, 2)}\n`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, configPath);
}

function optionalBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export async function loadOrCreateConfig(userDataPath, defaultServerUrl = DEFAULT_SERVER_URL) {
  const configPath = path.join(userDataPath, CONFIG_FILENAME);

  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      configPath,
      serverUrl: normalizeServerUrl(parsed?.serverUrl),
      autoOpenMeetingNotes: optionalBoolean(
        parsed?.autoOpenMeetingNotes,
        DEFAULT_AUTO_OPEN_MEETING_NOTES,
      ),
      launchAtLogin: optionalBoolean(parsed?.launchAtLogin, DEFAULT_LAUNCH_AT_LOGIN),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`Unable to read ${configPath}: ${error.message}`, { cause: error });
    }
  }

  const serverUrl = normalizeServerUrl(defaultServerUrl);
  await writeConfigAtomically(configPath, serverUrl);
  return {
    configPath,
    serverUrl,
    autoOpenMeetingNotes: DEFAULT_AUTO_OPEN_MEETING_NOTES,
    launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
  };
}

export async function resolveServerConfig({
  argv = process.argv,
  env = process.env,
  userDataPath,
  defaultServerUrl = DEFAULT_SERVER_URL,
}) {
  if (!userDataPath) throw new Error('userDataPath is required.');

  const stored = await loadOrCreateConfig(userDataPath, defaultServerUrl);
  const commandLineUrl = serverUrlFromArgs(argv);
  const environmentUrl = typeof env.CRAM_SERVER_URL === 'string'
    ? env.CRAM_SERVER_URL.trim()
    : '';
  const selected = commandLineUrl || environmentUrl || stored.serverUrl;

  return {
    configPath: stored.configPath,
    serverUrl: normalizeServerUrl(selected),
    source: commandLineUrl ? 'command-line' : environmentUrl ? 'environment' : 'config',
    autoOpenMeetingNotes: stored.autoOpenMeetingNotes,
    launchAtLogin: stored.launchAtLogin,
  };
}
