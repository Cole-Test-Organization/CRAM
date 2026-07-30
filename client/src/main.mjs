import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { resolveServerConfig, serverStorageKey } from './config.mjs';
import { createClientLogger, diagnosticError } from './logger.mjs';
import { createMeetingScheduler } from './meeting-scheduler.mjs';
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  buildUpstreamUrl,
  createProtocolHandler,
} from './protocol.mjs';

app.setName('CRAM Desktop');
app.setAppLogsPath();
app.enableSandbox();

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    allowServiceWorkers: true,
    codeCache: true,
    corsEnabled: true,
    secure: true,
    standard: true,
    stream: true,
    supportFetchAPI: true,
  },
}]);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(currentDirectory, '..', 'dist', 'renderer');
const preloadPath = path.join(currentDirectory, 'preload.cjs');
let mainWindow = null;
let desktopSession = null;
let serverConfig = null;
let desktopPartition = null;
let meetingScheduler = null;
let clientLogger = null;
const meetingNotesWindows = new Map();
const earlyDiagnostics = [];

function recordDiagnostic(level, event, details = {}) {
  const selectedLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
  if (clientLogger) {
    clientLogger[selectedLevel](event, details);
    return;
  }
  earlyDiagnostics.push({ level: selectedLevel, event, details });
}

function initializeDiagnostics() {
  clientLogger = createClientLogger({ directory: app.getPath('logs') });
  for (const entry of earlyDiagnostics.splice(0)) {
    clientLogger[entry.level](entry.event, entry.details);
  }
  clientLogger.info('app.start', {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    packaged: app.isPackaged,
    platform: process.platform,
    architecture: process.arch,
    userDataPath: app.getPath('userData'),
  });
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  recordDiagnostic('error', 'process.uncaught-exception', {
    origin,
    error: diagnosticError(error),
  });
});
process.on('unhandledRejection', (reason) => {
  recordDiagnostic('error', 'process.unhandled-rejection', {
    error: diagnosticError(reason),
  });
});

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function installPermissionBoundary(targetSession) {
  const isClipboardWrite = (permission, origin) =>
    permission === 'clipboard-sanitized-write' && isAppUrl(origin);

  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isClipboardWrite(permission, requestingOrigin));
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents?.getURL() || '';
    callback(isClipboardWrite(permission, requestingUrl));
  });
}

function revealDiagnosticLog() {
  if (!clientLogger) return;
  clientLogger.info('log.reveal-requested');
  shell.showItemInFolder(clientLogger.filePath);
}

function installMenu(config) {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: `Server: ${config.serverUrl}`,
          enabled: false,
        },
        {
          label: `Automatic Meeting Notes: ${config.autoOpenMeetingNotes ? 'On' : 'Off'}`,
          enabled: false,
        },
        {
          label: `Launch at Login: ${config.launchAtLogin ? 'On' : 'Off'}`,
          enabled: false,
        },
        {
          label: 'Show Configuration File',
          click: () => shell.showItemInFolder(config.configPath),
        },
        {
          label: 'Open Local Data Folder',
          click: () => void shell.openPath(app.getPath('userData')),
        },
        {
          label: 'Show Diagnostic Log',
          click: revealDiagnosticLog,
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function windowWebPreferences(partition) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    partition,
    preload: preloadPath,
    sandbox: true,
    webSecurity: true,
  };
}

function installWindowNavigationBoundary(window) {
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAppUrl(targetUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function diagnosticLocation(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return String(value || '');
  }
}

function consoleDiagnostic(args) {
  const modern = args.find((value) =>
    value
    && typeof value === 'object'
    && typeof value.message === 'string'
    && typeof value.level === 'string');
  if (modern) {
    return {
      level: modern.level,
      message: modern.message,
      lineNumber: modern.lineNumber,
      source: diagnosticLocation(modern.sourceId),
    };
  }
  const [, numericLevel, message, lineNumber, sourceId] = args;
  const levels = ['debug', 'info', 'warning', 'error'];
  return {
    level: levels[numericLevel] || 'info',
    message: String(message || ''),
    lineNumber,
    source: diagnosticLocation(sourceId),
  };
}

function showLoadFailure(window, label, details) {
  if (window.isDestroyed()) return;
  window.show();
  const logPath = clientLogger?.filePath || app.getPath('logs');
  void dialog.showMessageBox(window, {
    type: 'error',
    title: 'CRAM Desktop',
    message: `${label} could not load.`,
    detail: `${details}\n\nDiagnostic log:\n${logPath}`,
    buttons: ['Show Diagnostic Log', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) revealDiagnosticLog();
  });
}

function installWindowDiagnostics(window, { label, targetUrl }) {
  const target = diagnosticLocation(targetUrl);
  let loadFailureReported = false;
  let unresponsiveReported = false;
  const startupTimer = setTimeout(() => {
    if (window.isDestroyed() || !window.webContents.isLoadingMainFrame()) return;
    const details = 'The local application shell did not finish loading within 15 seconds.';
    recordDiagnostic('error', 'window.load-timeout', { label, target, timeoutMs: 15_000 });
    if (!loadFailureReported) {
      loadFailureReported = true;
      showLoadFailure(window, label, details);
    }
  }, 15_000);

  window.webContents.on('dom-ready', () => {
    clearTimeout(startupTimer);
    recordDiagnostic('info', 'window.dom-ready', { label, target });
  });
  window.webContents.on('did-finish-load', () => {
    clearTimeout(startupTimer);
    recordDiagnostic('info', 'window.load-finished', { label, target });
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      const failedTarget = diagnosticLocation(validatedURL);
      recordDiagnostic(isMainFrame ? 'error' : 'warn', 'window.load-failed', {
        label,
        target: failedTarget,
        errorCode,
        errorDescription,
        isMainFrame,
      });
      if (isMainFrame && errorCode !== -3 && !loadFailureReported) {
        loadFailureReported = true;
        clearTimeout(startupTimer);
        showLoadFailure(window, label, `${errorDescription} (${errorCode})`);
      }
    },
  );
  window.webContents.on('preload-error', (_event, failedPreloadPath, error) => {
    recordDiagnostic('error', 'window.preload-failed', {
      label,
      preloadPath: failedPreloadPath,
      error: diagnosticError(error),
    });
  });
  window.webContents.on('console-message', (...args) => {
    const message = consoleDiagnostic(args);
    if (message.level !== 'warning' && message.level !== 'error') return;
    recordDiagnostic(message.level === 'error' ? 'error' : 'warn', 'renderer.console', {
      label,
      ...message,
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    recordDiagnostic('error', 'window.renderer-gone', { label, ...details });
    showLoadFailure(window, label, `The renderer process exited: ${details.reason}.`);
  });
  window.webContents.on('unresponsive', () => {
    recordDiagnostic('error', 'window.unresponsive', { label, target });
    if (unresponsiveReported || window.isDestroyed()) return;
    unresponsiveReported = true;
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'CRAM Desktop',
      message: `${label} is not responding.`,
      detail: `You can reload it or inspect the diagnostic log at:\n${clientLogger?.filePath || app.getPath('logs')}`,
      buttons: ['Reload', 'Show Diagnostic Log', 'Wait'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0 && !window.isDestroyed()) window.reload();
      if (response === 1) revealDiagnosticLog();
    });
  });
  window.webContents.on('responsive', () => {
    unresponsiveReported = false;
    recordDiagnostic('info', 'window.responsive', { label, target });
  });
  window.webContents.once('destroyed', () => clearTimeout(startupTimer));
}

function loadWindow(window, targetUrl, label) {
  installWindowDiagnostics(window, { label, targetUrl });
  recordDiagnostic('info', 'window.load-started', {
    label,
    target: diagnosticLocation(targetUrl),
  });
  void window.loadURL(targetUrl).catch((error) => {
    recordDiagnostic('error', 'window.load-rejected', {
      label,
      target: diagnosticLocation(targetUrl),
      error: diagnosticError(error),
    });
  });
}

function createWindow(partition, { showWhenReady = true } = {}) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'CRAM Desktop',
    backgroundColor: '#17130f',
    webPreferences: windowWebPreferences(partition),
  });

  window.once('ready-to-show', () => {
    recordDiagnostic('info', 'window.ready-to-show', { label: 'Main window' });
    if (showWhenReady) window.show();
  });
  installWindowNavigationBoundary(window);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  loadWindow(window, APP_URL, 'Main window');
  return window;
}

function meetingWindowTitle(meeting) {
  return meeting?.title || meeting?.filename || `Meeting ${meeting?.id}`;
}

function meetingNotesUrl(meeting) {
  const url = new URL(APP_URL);
  url.pathname = `/desktop/meeting-notes/${meeting.id}`;
  const title = meetingWindowTitle(meeting);
  if (title) url.searchParams.set('title', title);
  if (meeting?.account_name) url.searchParams.set('account', meeting.account_name);
  if (meeting?.starts_at) url.searchParams.set('startsAt', meeting.starts_at);
  return url.toString();
}

function meetingNotesBounds() {
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const width = 430;
  const height = Math.min(700, display.workArea.height - 48);
  const cascade = (meetingNotesWindows.size % 4) * 24;
  return {
    width,
    height,
    x: Math.max(display.workArea.x, display.workArea.x + display.workArea.width - width - 24 - cascade),
    y: display.workArea.y + 24 + cascade,
  };
}

function openMeetingNotesWindow(meeting) {
  const meetingId = Number(meeting?.id);
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    throw new Error('A positive meeting id is required.');
  }
  if (!desktopPartition) throw new Error('CRAM Desktop is still starting.');

  const existing = meetingNotesWindows.get(meetingId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.moveTop();
    existing.focus();
    return existing;
  }

  const window = new BrowserWindow({
    ...meetingNotesBounds(),
    minWidth: 340,
    minHeight: 420,
    alwaysOnTop: true,
    backgroundColor: '#17130f',
    fullscreenable: false,
    maximizable: false,
    show: false,
    title: `${meetingWindowTitle(meeting)} — Notes`,
    webPreferences: windowWebPreferences(desktopPartition),
  });

  installWindowNavigationBoundary(window);
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    window.setAlwaysOnTop(true);
  }
  window.once('ready-to-show', () => {
    recordDiagnostic('info', 'window.ready-to-show', {
      label: 'Meeting notes',
      meetingId,
    });
    window.show();
    window.moveTop();
    window.focus();
  });
  window.on('closed', () => {
    if (meetingNotesWindows.get(meetingId) === window) {
      meetingNotesWindows.delete(meetingId);
    }
  });

  meetingNotesWindows.set(meetingId, window);
  loadWindow(
    window,
    meetingNotesUrl({ ...meeting, id: meetingId }),
    `Meeting notes ${meetingId}`,
  );
  return window;
}

function isTrustedRendererEvent(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  return isAppUrl(senderUrl);
}

function installDesktopIpc() {
  ipcMain.handle('cram-desktop:open-meeting-notes', (event, meetingId) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error('Untrusted renderer cannot open a meeting notes window.');
    }
    const id = Number(meetingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('A positive meeting id is required.');
    }
    openMeetingNotesWindow({ id });
    return { opened: true, meetingId: id };
  });
}

async function fetchMeetingSchedule() {
  const response = await desktopSession.fetch(buildUpstreamUrl(
    serverConfig.serverUrl,
    `${APP_URL}api/meetings?limit=1000`,
  ), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-CRAM-Client': 'desktop-scheduler',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Meeting schedule refresh failed: ${response.status} ${response.statusText}`);
  }
  const meetings = await response.json();
  if (!Array.isArray(meetings)) {
    throw new Error('Meeting schedule response was not an array.');
  }
  return meetings;
}

function showMainWindow() {
  if (!serverConfig || !desktopPartition) return;
  if (!mainWindow) mainWindow = createWindow(desktopPartition);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function start() {
  initializeDiagnostics();
  serverConfig = await resolveServerConfig({
    argv: process.argv,
    env: process.env,
    userDataPath: app.getPath('userData'),
  });

  const storageKey = serverStorageKey(serverConfig.serverUrl);
  desktopPartition = `persist:cram-${storageKey}`;
  clientLogger.info('app.configuration', {
    configSource: serverConfig.source,
    serverUrl: serverConfig.serverUrl,
    rendererRoot,
    rendererPresent: existsSync(path.join(rendererRoot, 'index.html')),
    partition: desktopPartition,
    autoOpenMeetingNotes: serverConfig.autoOpenMeetingNotes,
    launchAtLogin: serverConfig.launchAtLogin,
  });
  desktopSession = session.fromPartition(desktopPartition, { cache: true });
  installPermissionBoundary(desktopSession);
  desktopSession.protocol.handle(APP_SCHEME, createProtocolHandler({
    rendererRoot,
    serverUrl: serverConfig.serverUrl,
    fetchUpstream: (url, init) => desktopSession.fetch(url, init),
    onDiagnostic: (level, event, details) => recordDiagnostic(level, event, details),
  }));

  installDesktopIpc();
  installMenu(serverConfig);

  if (process.platform === 'darwin' && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: serverConfig.launchAtLogin });
  }
  const openedAtLogin = process.platform === 'darwin'
    && app.isPackaged
    && app.getLoginItemSettings().wasOpenedAtLogin;
  mainWindow = createWindow(desktopPartition, { showWhenReady: !openedAtLogin });

  if (serverConfig.autoOpenMeetingNotes) {
    meetingScheduler = createMeetingScheduler({
      statePath: path.join(app.getPath('userData'), `meeting-schedule-${storageKey}.json`),
      fetchMeetings: fetchMeetingSchedule,
      onMeetingStart: (meeting) => openMeetingNotesWindow(meeting),
      onError: (error) => {
        recordDiagnostic('warn', 'meeting-scheduler.failed', {
          error: diagnosticError(error),
        });
        console.warn('[meeting-scheduler]', error?.message || error);
      },
    });
    await meetingScheduler.start();
  }
  clientLogger.info('app.ready', { mainWindowVisible: mainWindow?.isVisible() });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady()
    .then(start)
    .catch((error) => {
      recordDiagnostic('error', 'app.start-failed', {
        error: diagnosticError(error),
      });
      dialog.showErrorBox('CRAM Desktop could not start', error?.stack || String(error));
      app.quit();
    });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    recordDiagnostic('info', 'app.before-quit');
    meetingScheduler?.stop();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
