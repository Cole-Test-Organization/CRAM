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
import { createMeetingScheduler } from './meeting-scheduler.mjs';
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  buildUpstreamUrl,
  createProtocolHandler,
} from './protocol.mjs';

app.setName('CRAM Desktop');
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
const meetingNotesWindows = new Map();

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
    if (showWhenReady) window.show();
  });
  installWindowNavigationBoundary(window);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(APP_URL);
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
  void window.loadURL(meetingNotesUrl({ ...meeting, id: meetingId }));
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
  serverConfig = await resolveServerConfig({
    argv: process.argv,
    env: process.env,
    userDataPath: app.getPath('userData'),
  });

  const storageKey = serverStorageKey(serverConfig.serverUrl);
  desktopPartition = `persist:cram-${storageKey}`;
  desktopSession = session.fromPartition(desktopPartition, { cache: true });
  installPermissionBoundary(desktopSession);
  desktopSession.protocol.handle(APP_SCHEME, createProtocolHandler({
    rendererRoot,
    serverUrl: serverConfig.serverUrl,
    fetchUpstream: (url, init) => desktopSession.fetch(url, init),
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
      onError: (error) => console.warn('[meeting-scheduler]', error?.message || error),
    });
    await meetingScheduler.start();
  }
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
      dialog.showErrorBox('CRAM Desktop could not start', error?.stack || String(error));
      app.quit();
    });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => meetingScheduler?.stop());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
