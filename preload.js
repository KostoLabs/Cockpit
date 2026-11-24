'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/*
 * Pont renderer <-> main (preload sandboxé : seul `electron` est requis).
 * - klai.hermes.<méthode>(…) : appels au gateway Hermes, réalisés dans le main ;
 * - klai.settings : réglages sans secrets ;
 * - klai.ext.<méthode>(…) : git, terminal, synchro, HUD (src/main/extensions.js) ;
 * - klai.on(canal, fn) : événements descendants, liste blanche.
 */
const EVENTS = ['klai:theme', 'klai:system-theme', 'klai:settings', 'klai:navigate', 'klai:command',
  'klai:hermes:event', 'klai:terminal', 'klai:sync'];

const HERMES = ['status', 'capabilities', 'sessions', 'projects', 'messages', 'session', 'createSession',
  'renameSession', 'deleteSession', 'forkSession', 'send', 'stop', 'steer', 'approve', 'clarify', 'run',
  'activeTurns', 'jobs', 'createJob', 'updateJob', 'deleteJob', 'jobAction', 'skills', 'toolsets', 'modelOptions', 'setSessionModel', 'localMeta', 'desktopStatus'];

const EXT = ['gitStatus', 'gitDiff', 'gitStage', 'gitCommit', 'termRun', 'termKill', 'syncStatus', 'syncFeed',
  'syncSession', 'syncTest', 'syncSave', 'hudOpen', 'hudClose', 'revealPath', 'openPath', 'readFile'];

const hermes = {};
for (const m of HERMES) hermes[m] = (...args) => ipcRenderer.invoke('klai:hermes', m, args);
const ext = {};
for (const m of EXT) ext[m] = (...args) => ipcRenderer.invoke('klai:ext', m, args);

contextBridge.exposeInMainWorld('klai', {
  on(channel, handler) {
    if (!EVENTS.includes(channel)) return () => {};
    const listener = (_event, value) => handler(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  hermes,
  ext,
  settings: {
    get: () => ipcRenderer.invoke('klai:settings:get'),
    set: (next) => ipcRenderer.invoke('klai:settings:set', next)
  },
  app: {
    info: () => ipcRenderer.invoke('klai:app:info'),
    openExternal: (url) => ipcRenderer.invoke('klai:app:openExternal', url)
  }
});
