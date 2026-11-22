'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');
let win = null;

/* ============================ Réglages persistants ============================ */

const DEFAULTS = {
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesApiKey: '',
  model: 'hermes-agent',
  theme: 'light'
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

/* ============================ Pilote Hermes (API OpenAI-compatible) ============================
 * Le gateway Hermes expose /v1 en OpenAI-compatible : chat/completions en
 * streaming SSE, sessions via X-Hermes-Session-Id, modèles sur /v1/models.
 * Toute la vie réseau reste dans le process main ; le renderer ne voit que
 * l'API ipc klai.hermes. Doc : hermes-agent.nousresearch.com/docs, API Server. */

function hermesFetch(pathname, init) {
  const s = loadSettings();
  const url = s.hermesBaseUrl.replace(/\/+$/, '') + pathname;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
  if (s.hermesApiKey) headers.Authorization = 'Bearer ' + s.hermesApiKey;
  return fetch(url, Object.assign({}, init, { headers }));
}

async function hermesStatus() {
  try {
    const res = await hermesFetch('/v1/models', { method: 'GET' });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    const models = (data.data || []).map(function (m) { return m.id; });
    return { ok: true, models: models };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* Tournées en cours : un AbortController par session, pour le bouton Arrêter. */
const running = new Map();

function sendEvent(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('klai:hermes:event', payload);
}

async function hermesSend(sessionId, content) {
  const s = loadSettings();
  const key = crypto.randomUUID();
  const ctrl = new AbortController();
  running.set(sessionId, ctrl);
  sendEvent({ session: sessionId, type: 'start' });
  try {
    const res = await hermesFetch('/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'X-Hermes-Session-Id': sessionId,
        'Idempotency-Key': key
      },
      body: JSON.stringify({
        model: s.model || 'hermes-agent',
        messages: [{ role: 'user', content: content }],
        stream: true
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + body.slice(0, 300));
    }
    // Lecture du flux SSE : tampon sur les lignes, "data: …" parsées une par une.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // garde la ligne incomplète
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.slice(5).trim();
        if (payloadStr === '[DONE]') {
          sendEvent({ session: sessionId, type: 'done' });
          return { ok: true };
        }
        try {
          const chunk = JSON.parse(payloadStr);
          const choice = chunk.choices && chunk.choices[0];
          const delta = choice && choice.delta && choice.delta.content;
          if (delta) sendEvent({ session: sessionId, type: 'delta', text: delta });
          const finish = choice && choice.finish_reason;
          if (finish && finish !== 'stop') {
            sendEvent({ session: sessionId, type: 'notice', text: 'finish_reason : ' + finish });
          }
        } catch { /* ligne non-JSON (commentaire SSE, keep-alive) : ignorée */ }
      }
    }
    sendEvent({ session: sessionId, type: 'done' });
    return { ok: true };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
    if (aborted) {
      sendEvent({ session: sessionId, type: 'cancelled' });
      return { ok: false, cancelled: true };
    }
    sendEvent({ session: sessionId, type: 'error', text: String(err && err.message || err) });
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    running.delete(sessionId);
  }
}

/* ============================ IPC ============================ */

function registerIpc() {
  ipcMain.handle('klai:settings:get', () => loadSettings());
  ipcMain.handle('klai:settings:set', (_e, next) => {
    const merged = saveSettings(next || {});
    if (merged.theme === 'dark' || merged.theme === 'light') {
      if (win) win.webContents.send('klai:theme', merged.theme);
    }
    return merged;
  });
  ipcMain.handle('klai:hermes:status', () => hermesStatus());
  ipcMain.handle('klai:hermes:send', (_e, arg) => hermesSend(arg.sessionId, String(arg.content || '')));
  ipcMain.handle('klai:hermes:stop', (_e, arg) => {
    const ctrl = running.get(arg.sessionId);
    if (ctrl) ctrl.abort();
    return { ok: true };
  });
}

/* ============================ Fenêtre et menu ============================ */

function createWindow() {
  win = new BrowserWindow({
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
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

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
        { label: 'Thème clair', accelerator: 'CmdOrCtrl+L', click: () => { saveSettings({ theme: 'light' }); win && win.webContents.send('klai:theme', 'light'); } },
        { label: 'Thème sombre', accelerator: 'CmdOrCtrl+D', click: () => { saveSettings({ theme: 'dark' }); win && win.webContents.send('klai:theme', 'dark'); } }
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
