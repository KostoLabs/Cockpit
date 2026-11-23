'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, Menu, safeStorage, shell, screen } = require('electron');
const path = require('path');
const { createSettingsStore } = require('./src/main/settings');
const { createHermesClient } = require('./src/main/hermes-client');
const extensions = require('./src/main/extensions');

const isDev = process.argv.includes('--dev');
// Dossier de données isolé (tests e2e, profils multiples) : KLAI_USER_DATA=/chemin
if (process.env.KLAI_USER_DATA) app.setPath('userData', process.env.KLAI_USER_DATA);
const windows = new Set();
let mainWin = null;
let settings = null;
let hermes = null;

/* ============================ Diffusion vers les fenêtres ============================ */

function broadcast(channel, payload) {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/* ============================ Tours de conversation ============================
 * Un tour par session à la fois. On garde l'AbortController (coupure du flux)
 * et le run_id (stop coopératif, approbations, orientation). */
const turns = new Map();

async function startTurn(arg) {
  const sessionId = String(arg.sessionId || '');
  const input = String(arg.input || '').trim();
  if (!sessionId || !input) return { ok: false, error: 'session ou message manquant' };
  if (turns.has(sessionId)) return { ok: false, error: 'Un tour est déjà en cours dans cette session.' };
  const entry = { ctrl: new AbortController(), runId: null };
  turns.set(sessionId, entry);
  broadcast('klai:hermes:event', { session: sessionId, type: 'start' });
  try {
    return await hermes.runTurn({
      sessionId: sessionId,
      input: input,
      model: arg.model || settings.all().model || '',
      signal: entry.ctrl.signal,
      onEvent: function (ev) {
        if (ev.type === 'run') entry.runId = ev.runId;
        broadcast('klai:hermes:event', Object.assign({ session: sessionId, runId: entry.runId }, ev));
      }
    });
  } finally {
    turns.delete(sessionId);
    broadcast('klai:hermes:event', { session: sessionId, type: 'end' });
  }
}

async function stopTurn(arg) {
  const entry = turns.get(String(arg.sessionId || ''));
  if (!entry) return { ok: true };
  if (entry.runId) {
    const r = await hermes.stop(entry.runId);
    // Filet de sécurité : si le run ne s'arrête pas, on coupe le flux local.
    setTimeout(function () { if (turns.get(arg.sessionId) === entry) entry.ctrl.abort(); }, 8000);
    if (r.ok) return r;
  }
  entry.ctrl.abort();
  return { ok: true };
}

function runIdFor(arg) {
  if (arg.runId) return String(arg.runId);
  const entry = turns.get(String(arg.sessionId || ''));
  return entry && entry.runId;
}

/* ============================ IPC ============================ */

const HERMES_METHODS = {
  status: () => hermes.status(),
  capabilities: () => hermes.capabilities(true),
  sessions: (p) => hermes.sessions(p),
  projects: () => hermes.projects(),
  messages: (id) => hermes.messages(String(id || '')),
  session: (id) => hermes.session(String(id || '')),
  createSession: (body) => hermes.createSession(body || {}),
  renameSession: (id, title) => hermes.renameSession(String(id), String(title || '')),
  deleteSession: (id) => hermes.deleteSession(String(id)),
  forkSession: (id, title) => hermes.forkSession(String(id), title),
  send: (arg) => startTurn(arg || {}),
  stop: (arg) => stopTurn(arg || {}),
  steer: (arg) => { const id = runIdFor(arg || {}); return id ? hermes.steer(id, String(arg.text || '')) : { ok: false, error: 'aucun run actif' }; },
  approve: (arg) => { const id = runIdFor(arg || {}); return id ? hermes.approve(id, arg) : { ok: false, error: 'aucun run actif' }; },
  clarify: (arg) => { const id = runIdFor(arg || {}); return id ? hermes.clarify(id, arg) : { ok: false, error: 'aucun run actif' }; },
  run: (id) => hermes.run(String(id)),
  activeTurns: () => Array.from(turns.entries()).map(([s, e]) => ({ session: s, runId: e.runId })),
  jobs: () => hermes.jobs(),
  createJob: (b) => hermes.createJob(b || {}),
  updateJob: (id, b) => hermes.updateJob(String(id), b || {}),
  deleteJob: (id) => hermes.deleteJob(String(id)),
  jobAction: (id, a) => hermes.jobAction(String(id), String(a)),
  skills: () => hermes.skills(),
  toolsets: () => hermes.toolsets(),
  modelOptions: () => hermes.modelOptions()
};

function registerIpc() {
  ipcMain.handle('klai:hermes', async (_e, method, args) => {
    const fn = HERMES_METHODS[method];
    if (!fn) return { ok: false, error: 'méthode inconnue : ' + method };
    try { return await fn.apply(null, Array.isArray(args) ? args : []); }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('klai:settings:get', () => settings.publicView());
  ipcMain.handle('klai:settings:set', (_e, next) => {
    const before = settings.all();
    const merged = settings.set(next || {});
    if (next && ('hermesBaseUrl' in next || 'hermesApiKey' in next || 'hermesProfile' in next)) hermes.resetCapabilities();
    if (merged.theme !== before.theme) applyTheme(merged.theme);
    broadcast('klai:settings', merged);
    return merged;
  });
  ipcMain.handle('klai:app:info', () => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, isDev: isDev
  }));
  ipcMain.handle('klai:app:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^(https?:|hermes:|mailto:)/.test(url)) return shell.openExternal(url).then(() => true);
    return false;
  });
  extensions.register({ ipcMain, settings, broadcast, app, openHud, closeHud, isDev });
}

function applyTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'system' ? 'system' : 'light';
  broadcast('klai:theme', theme);
}

/* ============================ Fenêtres ============================ */

function windowBounds() {
  const saved = settings.all().window;
  if (!saved || !saved.width) return { width: 1440, height: 920 };
  const area = screen.getDisplayMatching(saved).workArea;
  const visible = saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y < area.y + area.height && saved.y + saved.height > area.y;
  return visible ? saved : { width: saved.width, height: saved.height };
}

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false
  };
}

function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

function createMainWindow() {
  const b = windowBounds();
  mainWin = new BrowserWindow(Object.assign({}, b, {
    minWidth: 1060,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 28 },
    backgroundColor: settings.all().theme === 'dark' ? '#0B0B0C' : '#FFFFFF',
    show: false,
    webPreferences: secureWebPreferences()
  }));
  windows.add(mainWin);
  lockNavigation(mainWin);
  if (settings.all().window && settings.all().window.maximized) mainWin.maximize();
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) mainWin.webContents.openDevTools({ mode: 'detach' });

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWin || mainWin.isDestroyed()) return;
      settings.set({ window: Object.assign({}, mainWin.getNormalBounds(), { maximized: mainWin.isMaximized() }) });
    }, 400);
  };
  mainWin.on('resize', saveBounds);
  mainWin.on('move', saveBounds);
  mainWin.on('closed', () => { windows.delete(mainWin); mainWin = null; });
}

/* HUD : barre flottante toujours au premier plan, même renderer en mode compact. */
let hudWin = null;
function openHud(sessionId) {
  if (hudWin && !hudWin.isDestroyed()) { hudWin.focus(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  hudWin = new BrowserWindow({
    width: 560, height: 420, x: area.x + area.width - 600, y: area.y + 60,
    frame: false, alwaysOnTop: true, resizable: true, skipTaskbar: true,
    transparent: false, backgroundColor: settings.all().theme === 'dark' ? '#0B0B0C' : '#FFFFFF',
    webPreferences: secureWebPreferences()
  });
  hudWin.setAlwaysOnTop(true, 'floating');
  windows.add(hudWin);
  lockNavigation(hudWin);
  hudWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: 'hud', session: sessionId || '' } });
  hudWin.on('closed', () => { windows.delete(hudWin); hudWin = null; if (mainWin) mainWin.show(); });
  if (mainWin) mainWin.hide();
}
function closeHud() {
  if (hudWin && !hudWin.isDestroyed()) hudWin.close();
}
function toggleHud() {
  if (hudWin && !hudWin.isDestroyed()) closeHud(); else openHud('');
}

function send(channel, value) {
  const w = BrowserWindow.getFocusedWindow() || mainWin;
  if (w && !w.isDestroyed()) w.webContents.send(channel, value);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    {
      label: 'Cockpit',
      submenu: [
        { role: 'about', label: 'À propos du Cockpit' },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'CmdOrCtrl+,', click: () => send('klai:navigate', 'settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer le Cockpit' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter le Cockpit' }
      ]
    },
    {
      label: 'Session',
      submenu: [
        { label: 'Nouvelle session', accelerator: 'CmdOrCtrl+N', click: () => send('klai:command', 'new-session') },
        { label: 'Palette de commandes', accelerator: 'CmdOrCtrl+K', click: () => send('klai:command', 'palette') },
        { label: 'Rechercher dans la conversation', accelerator: 'CmdOrCtrl+F', click: () => send('klai:command', 'find') },
        { type: 'separator' },
        { label: 'Arrêter le tour', accelerator: 'CmdOrCtrl+.', click: () => send('klai:command', 'stop') },
        { label: 'Fermer l’onglet', accelerator: 'CmdOrCtrl+W', click: () => send('klai:command', 'close-tab') }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
        { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' },
        { role: 'pasteAndMatchStyle', label: 'Coller et adapter le style' }, { role: 'delete', label: 'Supprimer' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Vue d’ensemble', accelerator: 'CmdOrCtrl+1', click: () => send('klai:navigate', 'overview') },
        { label: 'Tâches planifiées', accelerator: 'CmdOrCtrl+2', click: () => send('klai:navigate', 'jobs') },
        { label: 'Capacités', accelerator: 'CmdOrCtrl+3', click: () => send('klai:navigate', 'capabilities') },
        { label: 'Synchro', accelerator: 'CmdOrCtrl+4', click: () => send('klai:navigate', 'sync') },
        { type: 'separator' },
        { label: 'Mode HUD', accelerator: 'CmdOrCtrl+Shift+H', click: toggleHud },
        { type: 'separator' },
        { label: 'Thème clair', click: () => { settings.set({ theme: 'light' }); applyTheme('light'); } },
        { label: 'Thème sombre', click: () => { settings.set({ theme: 'dark' }); applyTheme('dark'); } },
        { label: 'Thème du système', click: () => { settings.set({ theme: 'system' }); applyTheme('system'); } },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' }, { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }
      ]
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Réduire' }, { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Tout ramener au premier plan' }] : [{ role: 'close', label: 'Fermer' }])
      ]
    }
  ]);
}

/* ============================ Cycle de vie ============================ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); } });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: 'KostoLabs AI Cockpit', applicationVersion: app.getVersion(), copyright: '© KostoLabs Company' });
    settings = createSettingsStore({ file: path.join(app.getPath('userData'), 'settings.json'), safeStorage: safeStorage });
    hermes = createHermesClient({
      getConfig: () => {
        const s = settings.all();
        return { baseUrl: s.hermesBaseUrl, apiKey: settings.secret('hermesApiKey'), model: s.model, profile: s.hermesProfile };
      }
    });
    const t = settings.all().theme;
    nativeTheme.themeSource = t === 'dark' ? 'dark' : t === 'system' ? 'system' : 'light';
    nativeTheme.on('updated', () => broadcast('klai:system-theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    registerIpc();
    Menu.setApplicationMenu(buildMenu());
    createMainWindow();
    app.on('activate', () => { if (!mainWin) createMainWindow(); else mainWin.show(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { for (const e of turns.values()) e.ctrl.abort(); extensions.shutdown(); });
}
