const { contextBridge, ipcRenderer } = require('electron');

// Keep the renderer bridge deliberately narrow. The bundled CRAM UI can ask
// the main process to create one native window for a known meeting id; it does
// not receive ipcRenderer or any general-purpose Node/Electron capability.
contextBridge.exposeInMainWorld('cramDesktop', Object.freeze({
  isDesktop: true,
  openMeetingNotes: (meetingId) =>
    ipcRenderer.invoke('cram-desktop:open-meeting-notes', meetingId),
}));
