const { contextBridge, ipcRenderer } = require('electron');

// Keep the renderer bridge deliberately narrow. The bundled CRAM UI can ask
// the main process to create one native window for a known meeting id; it does
// not receive ipcRenderer or any general-purpose Node/Electron capability.
contextBridge.exposeInMainWorld('cramDesktop', Object.freeze({
  isDesktop: true,
  cache: Object.freeze({
    put: (key, response) =>
      ipcRenderer.invoke('cram-desktop:cache-put', key, response),
    get: (key) =>
      ipcRenderer.invoke('cram-desktop:cache-get', key),
    keys: () =>
      ipcRenderer.invoke('cram-desktop:cache-keys'),
    delete: (key) =>
      ipcRenderer.invoke('cram-desktop:cache-delete', key),
    prune: (keeping) =>
      ipcRenderer.invoke('cram-desktop:cache-prune', keeping),
  }),
  openMeetingNotes: (meetingId) =>
    ipcRenderer.invoke('cram-desktop:open-meeting-notes', meetingId),
}));
