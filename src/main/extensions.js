'use strict';
/* Extensions du process main exposées au renderer via `klai.ext.*`
 * (liste blanche dans preload.js) : HUD, revue Git, terminal, fichiers, synchro. */
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const git = require('./git');
const terminal = require('./terminal');

const METHODS = {};
const shutdownHooks = [terminal.killAll];

function register(ctx) {
  METHODS.hudOpen = (sessionId) => { ctx.openHud(String(sessionId || '')); return { ok: true }; };
  METHODS.hudClose = () => { ctx.closeHud(); return { ok: true }; };

  METHODS.gitStatus = (cwd) => git.status(String(cwd || ''));
  METHODS.gitDiff = (cwd, scope, file, sessionId) => git.diff(String(cwd || ''), String(scope || 'uncommitted'), file ? String(file) : '', sessionId);
  METHODS.gitStage = (cwd, files, on) => git.stage(String(cwd || ''), files, !!on);
  METHODS.gitCommit = (cwd, message, push) => git.commit(String(cwd || ''), message, !!push);

  METHODS.termRun = (id, cwd, command) => terminal.run(id, cwd ? String(cwd) : '', command, (ev) => ctx.broadcast('klai:terminal', ev));
  METHODS.termKill = (id) => terminal.kill(String(id || ''));

  METHODS.revealPath = (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) return { ok: false, error: 'Chemin introuvable sur cet appareil.' };
    shell.showItemInFolder(p);
    return { ok: true };
  };
  METHODS.openPath = (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) return { ok: false, error: 'Chemin introuvable sur cet appareil.' };
    return shell.openPath(p).then((err) => ({ ok: !err, error: err }));
  };
  METHODS.readFile = (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return { ok: false, error: 'Chemin invalide.' };
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return { ok: false, error: 'Pas un fichier.' };
      if (st.size > 256 * 1024) return { ok: false, error: 'Fichier trop lourd pour l’aperçu (256 Ko max).' };
      const buf = fs.readFileSync(p);
      if (buf.slice(0, 4096).includes(0)) return { ok: false, error: 'Fichier binaire.' };
      return { ok: true, text: buf.toString('utf-8'), size: st.size, mtime: st.mtimeMs };
    } catch (err) { return { ok: false, error: String(err.message) }; }
  };

  ctx.ipcMain.handle('klai:ext', async (_e, method, args) => {
    const fn = METHODS[method];
    if (!fn) return { ok: false, error: 'extension indisponible : ' + method };
    try { return await fn.apply(null, Array.isArray(args) ? args : []); }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
}

function shutdown() {
  for (const h of shutdownHooks) { try { h(); } catch { /* arrêt best-effort */ } }
}

module.exports = { register, shutdown, METHODS, shutdownHooks, git };
