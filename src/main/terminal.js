'use strict';
/* Exécuteur de commandes du volet Terminal : chaque commande tourne dans le
 * shell de connexion de l'utilisateur (zsh sur macOS), dans le dossier choisi,
 * et sa sortie est diffusée en continu au renderer. Ce n'est pas un PTY (pas de
 * programmes plein écran) : un vrai terminal demanderait un module natif. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const procs = new Map();

function shellPath() {
  const sh = process.env.SHELL;
  if (sh && fs.existsSync(sh)) return sh;
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

function run(id, cwd, command, emit) {
  id = String(id || '');
  command = String(command || '');
  if (!id || !command.trim()) return { ok: false, error: 'Commande vide.' };
  if (procs.has(id)) return { ok: false, error: 'Identifiant déjà utilisé.' };
  let dir = cwd && path.isAbsolute(cwd) ? cwd : os.homedir();
  try { if (!fs.statSync(dir).isDirectory()) dir = os.homedir(); } catch { dir = os.homedir(); }
  const child = spawn(shellPath(), ['-lc', command], {
    cwd: dir,
    env: Object.assign({}, process.env, { TERM: 'dumb', NO_COLOR: '1', CLICOLOR: '0', GIT_PAGER: 'cat', PAGER: 'cat' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procs.set(id, child);
  const started = Date.now();
  child.stdout.on('data', function (b) { emit({ id: id, kind: 'out', data: b.toString('utf-8') }); });
  child.stderr.on('data', function (b) { emit({ id: id, kind: 'err', data: b.toString('utf-8') }); });
  child.on('error', function (err) { emit({ id: id, kind: 'err', data: String(err.message) + '\n' }); });
  child.on('close', function (code, signal) {
    procs.delete(id);
    emit({ id: id, kind: 'exit', code: code, signal: signal, duration: (Date.now() - started) / 1000 });
  });
  return { ok: true, cwd: dir, pid: child.pid };
}

function kill(id) {
  const p = procs.get(String(id || ''));
  if (!p) return { ok: true };
  p.kill('SIGTERM');
  setTimeout(function () { if (procs.get(id) === p) p.kill('SIGKILL'); }, 3000);
  return { ok: true };
}

function killAll() { for (const p of procs.values()) { try { p.kill('SIGTERM'); } catch { /* déjà fini */ } } }

module.exports = { run, kill, killAll };
