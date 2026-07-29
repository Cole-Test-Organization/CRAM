import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  session,
  shell,
} from 'electron';
import { resolveServerConfig, serverStorageKey } from './config.mjs';
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
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
let mainWindow = null;
let desktopSession = null;
let serverConfig = null;

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

function installMenu(configPath, serverUrl) {
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
          label: `Server: ${serverUrl}`,
          enabled: false,
        },
        {
          label: 'Show Configuration File',
          click: () => shell.showItemInFolder(configPath),
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

function createWindow(partition) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'CRAM Desktop',
    backgroundColor: '#17130f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAppUrl(targetUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(APP_URL);
  return window;
}

async function start() {
  serverConfig = await resolveServerConfig({
    argv: process.argv,
    env: process.env,
    userDataPath: app.getPath('userData'),
  });

  const partition = `persist:cram-${serverStorageKey(serverConfig.serverUrl)}`;
  desktopSession = session.fromPartition(partition, { cache: true });
  installPermissionBoundary(desktopSession);
  desktopSession.protocol.handle(APP_SCHEME, createProtocolHandler({
    rendererRoot,
    serverUrl: serverConfig.serverUrl,
    fetchUpstream: (url, init) => desktopSession.fetch(url, init),
  }));

  installMenu(serverConfig.configPath, serverConfig.serverUrl);
  mainWindow = createWindow(partition);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox('CRAM Desktop could not start', error?.stack || String(error));
      app.quit();
    });

  app.on('activate', () => {
    if (!mainWindow && serverConfig) {
      mainWindow = createWindow(`persist:cram-${serverStorageKey(serverConfig.serverUrl)}`);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
