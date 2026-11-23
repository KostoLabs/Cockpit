'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { createHermesClient } = require('./pilote');

const isDev = process.argv.includes('--dev');
let win = null;

/* ============================ Réglages persistants ============================ */

const DEFAULTS = {
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesApiKey: '',
  model: 'hermes-agent',
  provider: '',
  theme: 'light',
  windowBounds: null // { x, y, width, height, maximized }
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    return Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch {
    return Object.assign({}, DEFAULTS);
  }
}

function saveSettings(next) {
  const merged = Object.assign(loadSettings(), next);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function applyTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
  if (win && !win.isDestroyed()) win.webContents.send('klai:theme', theme);
}

/* ============================ Pilote Hermes ============================
 * Toute la vie réseau vit ici, dans le process main, via pilote.js (testé
 * sans Electron par tests/test-pilote-hermes.js). Le renderer ne voit que
 * l'API ipc klai.hermes. */

function sendEvent(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('klai:hermes:event', payload);
}

const hermes = createHermesClient({ getSettings: loadSettings, onEvent: sendEvent });

/* ============================ IPC ============================ */

function registerIpc() {
  ipcMain.handle('klai:settings:get', () => loadSettings());
  ipcMain.handle('klai:settings:set', (_e, next) => {
    const merged = saveSettings(next || {});
    if (merged.theme === 'dark' || merged.theme === 'light') applyTheme(merged.theme);
    return merged;
  });
  ipcMain.handle('klai:hermes:status', () => hermes.status());
  ipcMain.handle('klai:hermes:capabilities', () => hermes.capabilities());
  ipcMain.handle('klai:hermes:sessions', () => hermes.sessions());
  ipcMain.handle('klai:hermes:projects', () => hermes.projects());
  ipcMain.handle('klai:hermes:messages', (_e, arg) => hermes.sessionMessages(String((arg && arg.sessionId) || '')));
  ipcMain.handle('klai:hermes:jobs', () => hermes.jobs());
  ipcMain.handle('klai:hermes:model-options', () => hermes.modelOptions());
  ipcMain.handle('klai:hermes:set-session-model', (_e, arg) =>
    hermes.setSessionModel(String((arg && arg.sessionId) || ''), String((arg && arg.model) || ''), String((arg && arg.provider) || '')));
  ipcMain.handle('klai:hermes:create-session', (_e, arg) => hermes.createSession(String((arg && arg.title) || '')));
  ipcMain.handle('klai:hermes:create-project', (_e, arg) => hermes.createProject(String((arg && arg.name) || '')));
  ipcMain.handle('klai:hermes:fork', (_e, arg) => hermes.forkSession(String((arg && arg.sessionId) || ''), String((arg && arg.title) || '')));
  ipcMain.handle('klai:hermes:send', (_e, arg) => hermes.send(String((arg && arg.sessionId) || ''), String((arg && arg.content) || '')));
  ipcMain.handle('klai:hermes:stop', (_e, arg) => hermes.stop(String((arg && arg.sessionId) || '')));
  ipcMain.handle('klai:hermes:approve', (_e, arg) =>
    hermes.approve(String((arg && arg.runId) || ''), String((arg && arg.requestId) || ''), String((arg && arg.choice) || 'once')));
}

/* ============================ Fenêtre (géométrie persistée) ============================ */

let saveBoundsTimer = null;
function scheduleSaveBounds() {
  if (!win || win.isDestroyed()) return;
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? (loadSettings().windowBounds || null) : win.getBounds();
    saveSettings({ windowBounds: Object.assign({}, bounds, { maximized: maximized }) });
  }, 400);
}

function createWindow() {
  const saved = loadSettings().windowBounds;
  const opts = {
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 24 },
    backgroundColor: '#e8e8eb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) && saved.width >= opts.minWidth && saved.height >= opts.minHeight) {
    opts.width = saved.width;
    opts.height = saved.height;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      opts.x = saved.x;
      opts.y = saved.y;
    }
  }
  win = new BrowserWindow(opts);

  win.once('ready-to-show', () => {
    if (saved && saved.maximized) win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
  win.on('close', scheduleSaveBounds);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const settings = loadSettings();
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : 'light';
  registerIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Cockpit',
      submenu: [
        { role: 'about', label: 'À propos du Cockpit' },
        { type: 'separator' },
        { label: 'Nouvelle session', accelerator: 'CmdOrCtrl+N', click: () => win && win.webContents.send('klai:new-session') },
        { label: 'Rechercher', accelerator: 'CmdOrCtrl+K', click: () => win && win.webContents.send('klai:focus-search') },
        { label: 'Réglages Hermes…', accelerator: 'CmdOrCtrl+,', click: () => win && win.webContents.send('klai:settings-open') },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer le Cockpit' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter le Cockpit' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'pasteAndMatchStyle', label: 'Coller et adapter le style' },
        { type: 'separator' },
        { role: 'delete', label: 'Supprimer' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Thème clair', accelerator: 'CmdOrCtrl+L', click: () => { saveSettings({ theme: 'light' }); applyTheme('light'); } },
        { label: 'Thème sombre', accelerator: 'CmdOrCtrl+D', click: () => { saveSettings({ theme: 'dark' }); applyTheme('dark'); } }
      ]
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'close', label: 'Fermer' }
      ]
    }
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
