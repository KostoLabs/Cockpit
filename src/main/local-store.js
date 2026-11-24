'use strict';
/* Lecture seule des bases locales d'Hermes, quand le gateway tourne sur cette machine.
 *
 * L'API server ne transmet ni le dossier de travail ni le projet d'une session.
 * Hermes Desktop les lit dans :
 *   $HERMES_HOME/projects.db  projets nommés (projects) et leurs dossiers (project_folders)
 *   $HERMES_HOME/state.db     sessions : cwd, git_repo_root, git_branch, source, created_source
 * Les deux bases sont ouvertes en lecture seule (node:sqlite, intégré à Electron),
 * jamais modifiées. Toute erreur (base absente, schéma différent) renvoie ok:false
 * et l'app retombe sur les seules données de l'API. */
const fs = require('fs');
const os = require('os');
const path = require('path');

let sqlite = null;
function driver() {
  if (sqlite === null) {
    try {
      const emit = process.emitWarning;
      process.emitWarning = () => {}; // avertissement « experimental » de node:sqlite
      sqlite = require('node:sqlite');
      process.emitWarning = emit;
    } catch { sqlite = false; }
  }
  return sqlite || null;
}

function hermesHome(override) {
  const raw = override || process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
  return raw.replace(/^~(?=$|\/)/, os.homedir());
}

function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0';
  } catch { return false; }
}

function openReadOnly(file) {
  const d = driver();
  if (!d || !fs.existsSync(file)) return null;
  const db = new d.DatabaseSync(file, { readOnly: true, timeout: 2000 });
  return db;
}

function columns(db, table) {
  try { return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map((r) => r.name)); } catch { return new Set(); }
}

function norm(p) {
  if (!p) return '';
  return String(p).replace(/[\\/]+$/, '') || '/';
}

function readProjects(home) {
  const db = openReadOnly(path.join(home, 'projects.db'));
  if (!db) return [];
  try {
    const pc = columns(db, 'projects');
    if (!pc.has('id') || !pc.has('name')) return [];
    const where = pc.has('archived') ? ' WHERE archived = 0' : '';
    const rows = db.prepare('SELECT id, name' + (pc.has('slug') ? ', slug' : '') + (pc.has('primary_path') ? ', primary_path' : '') +
      (pc.has('color') ? ', color' : '') + (pc.has('icon') ? ', icon' : '') + ' FROM projects' + where).all();
    const folders = columns(db, 'project_folders').has('path')
      ? db.prepare('SELECT project_id, path FROM project_folders').all() : [];
    return rows.map((p) => ({
      id: String(p.id), name: p.name, slug: p.slug || '', color: p.color || null, icon: p.icon || null,
      path: norm(p.primary_path || ''),
      folders: Array.from(new Set([norm(p.primary_path || '')].concat(folders.filter((f) => f.project_id === p.id).map((f) => norm(f.path))).filter(Boolean)))
    }));
  } finally { db.close(); }
}

function readSessionMeta(home) {
  const db = openReadOnly(path.join(home, 'state.db'));
  if (!db) return {};
  try {
    const sc = columns(db, 'sessions');
    if (!sc.has('id')) return {};
    const want = ['cwd', 'git_repo_root', 'git_branch', 'source', 'created_source'].filter((c) => sc.has(c));
    if (!want.length) return {};
    const out = {};
    for (const r of db.prepare('SELECT id, ' + want.join(', ') + ' FROM sessions').all()) {
      out[r.id] = { cwd: r.cwd || '', root: r.git_repo_root || '', branch: r.git_branch || '', source: r.source || '', createdSource: r.created_source || '' };
    }
    return out;
  } finally { db.close(); }
}

/* Projet d'une session : le dossier de projet le plus profond qui contient son espace
 * (racine Git, sinon cwd). */
function projectFor(workspace, projects) {
  const ws = norm(workspace);
  if (!ws) return null;
  let best = null, depth = -1;
  for (const p of projects) {
    for (const f of p.folders) {
      if (ws === f || ws.startsWith(f + '/')) {
        if (f.length > depth) { best = p; depth = f.length; }
      }
    }
  }
  return best;
}

function snapshot(opts) {
  const home = hermesHome(opts && opts.hermesHome);
  if (!driver()) return { ok: false, error: 'SQLite indisponible dans cette version d’Electron.' };
  if (!fs.existsSync(home)) return { ok: false, error: 'Dossier Hermes introuvable : ' + home };
  try {
    const projects = readProjects(home);
    const meta = readSessionMeta(home);
    const sessions = {};
    for (const id of Object.keys(meta)) {
      const m = meta[id];
      const ws = m.root || m.cwd;
      const p = projectFor(ws, projects);
      sessions[id] = Object.assign({}, m, { workspace: ws, projectId: p ? p.id : null });
    }
    return { ok: true, home: home, projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path, color: p.color, folders: p.folders })), sessions: sessions };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { snapshot, isLocalUrl, projectFor, hermesHome };
