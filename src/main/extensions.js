'use strict';
/* Extensions du process main exposées au renderer via `klai.ext.*`.
 * Chaque module ajoute ses méthodes dans METHODS ; liste blanche dans preload.js. */

const METHODS = {};
const shutdownHooks = [];

function register(ctx) {
  METHODS.hudOpen = (sessionId) => { ctx.openHud(String(sessionId || '')); return { ok: true }; };
  METHODS.hudClose = () => { ctx.closeHud(); return { ok: true }; };

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

module.exports = { register, shutdown, METHODS, shutdownHooks };
