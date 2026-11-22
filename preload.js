'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/*
 * Pont renderer <-> main.
 * - klai.hermes : appels au pilote Hermes réservés au process main (réseau,
 *   réglages). Le renderer reste isolé du Node et du réseau.
 * - canaux descendants (main -> renderer) : thème, focus, palette, réglages.
 */
const ALLOWED_EVENTS = ['klai:theme', 'klai:focus-search', 'klai:new-session', 'klai:settings-open'];

contextBridge.exposeInMainWorld('klai', {
  on(channel, handler) {
    if (!ALLOWED_EVENTS.includes(channel)) return () => {};
    const listener = (_event, value) => handler(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onHermesEvent(handler) {
    const listener = (_event, value) => handler(value);
    ipcRenderer.on('klai:hermes:event', listener);
    return () => ipcRenderer.removeListener('klai:hermes:event', listener);
  },
  hermes: {
    status: () => ipcRenderer.invoke('klai:hermes:status'),
    send: (sessionId, content) => ipcRenderer.invoke('klai:hermes:send', { sessionId, content }),
    stop: (sessionId) => ipcRenderer.invoke('klai:hermes:stop', { sessionId })
  },
  settings: {
    get: () => ipcRenderer.invoke('klai:settings:get'),
    set: (next) => ipcRenderer.invoke('klai:settings:set', next)
  }
});
