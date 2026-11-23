'use strict';
/* Revue Git locale (comme le volet Review d'Hermes Desktop) : statut, diff par
 * portée (Non validé / Branche / Dernier tour), indexation, commit, push.
 * Uniquement pour les dossiers présents sur cette machine ; git est appelé sans
 * shell (execFile), chaque chemin passe après « -- ». */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_DIFF = 400 * 1024;
const snapshots = new Map(); // sessionId -> { root, ref, at }

function git(cwd, args, opts) {
  return new Promise(function (resolve) {
    execFile('git', ['-C', cwd].concat(args), Object.assign({ timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }) }, opts || {}),
      function (err, stdout, stderr) {
        resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '').trim(), code: err ? err.code : 0 });
      });
  });
}

function validDir(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

async function repoRoot(cwd) {
  if (!validDir(cwd)) return null;
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? r.out.trim() : null;
}

function safeFiles(files) {
  return (Array.isArray(files) ? files : []).map(String).filter(function (f) { return f && !f.startsWith('-') && !path.isAbsolute(f) && f.split(/[\\/]/).indexOf('..') === -1; });
}

/* Statut porcelain v1 -b : branche, avance / retard, fichiers. */
function parseStatus(out) {
  const lines = out.split('\n').filter(Boolean);
  const res = { branch: '', upstream: '', ahead: 0, behind: 0, files: [] };
  for (const l of lines) {
    if (l.startsWith('## ')) {
      const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/.exec(l);
      if (m) { res.branch = m[1]; res.upstream = m[2] || ''; res.ahead = Number(m[3] || 0); res.behind = Number(m[4] || 0); }
      continue;
    }
    const x = l[0], y = l[1];
    let file = l.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    file = file.replace(/^"|"$/g, '');
    res.files.push({ path: file, index: x, worktree: y, staged: x !== ' ' && x !== '?', untracked: x === '?' });
  }
  return res;
}

async function status(cwd) {
  const root = await repoRoot(cwd);
  if (!root) return { ok: false, error: validDir(cwd) ? 'Pas un dépôt Git.' : 'Dossier inaccessible depuis cet appareil.' };
  const [st, head] = await Promise.all([git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=all']), git(root, ['rev-parse', '--short', 'HEAD'])]);
  if (!st.ok) return { ok: false, error: st.err };
  return Object.assign({ ok: true, root: root, head: head.ok ? head.out.trim() : '' }, parseStatus(st.out));
}

async function defaultBase(root) {
  const r = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (r.ok && r.out.trim()) return r.out.trim();
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
    const v = await git(root, ['rev-parse', '--verify', '--quiet', b]);
    if (v.ok) return b;
  }
  return null;
}

/* Instantané pris au début d'un tour : `git stash create` fabrique un commit de
 * l'arbre de travail sans le modifier ; sur un arbre propre, on garde HEAD. */
async function snapshot(sessionId, cwd) {
  const root = await repoRoot(cwd);
  if (!root) return null;
  const st = await git(root, ['stash', 'create', 'klai-cockpit: début de tour']);
  let ref = st.ok ? st.out.trim() : '';
  if (!ref) { const h = await git(root, ['rev-parse', 'HEAD']); ref = h.ok ? h.out.trim() : ''; }
  if (!ref) return null;
  snapshots.set(sessionId, { root: root, ref: ref, at: Date.now() });
  return ref;
}

/* Diff selon la portée. Sans `file`, renvoie la liste des fichiers (--numstat). */
async function diff(cwd, scope, file, sessionId) {
  const root = await repoRoot(cwd);
  if (!root) return { ok: false, error: 'Dossier inaccessible ou hors Git.' };
  let range;
  if (scope === 'branch') {
    const base = await defaultBase(root);
    if (!base) return { ok: false, error: 'Branche de référence introuvable (origin/HEAD, main, master).' };
    const mb = await git(root, ['merge-base', base, 'HEAD']);
    if (!mb.ok) return { ok: false, error: mb.err };
    range = [mb.out.trim(), 'HEAD'];
  } else if (scope === 'turn') {
    const snap = snapshots.get(String(sessionId || ''));
    if (!snap || snap.root !== root) return { ok: true, files: [], note: 'Aucun tour lancé depuis le cockpit dans ce dépôt.' };
    range = [snap.ref];
  } else {
    range = ['HEAD'];
  }
  const files = safeFiles(file ? [file] : []);
  if (file && !files.length) return { ok: false, error: 'Chemin refusé.' };
  if (!file) {
    const ns = await git(root, ['diff', '--numstat'].concat(range, ['--']));
    if (!ns.ok) return { ok: false, error: ns.err };
    const out = ns.out.split('\n').filter(Boolean).map(function (l) {
      const p = l.split('\t');
      return { path: p[2], added: p[0] === '-' ? null : Number(p[0]), removed: p[1] === '-' ? null : Number(p[1]) };
    });
    if (scope !== 'branch') {
      const un = await git(root, ['ls-files', '--others', '--exclude-standard']);
      un.out.split('\n').filter(Boolean).forEach(function (p) { if (!out.some(function (f) { return f.path === p; })) out.push({ path: p, added: null, removed: null, untracked: true }); });
    }
    return { ok: true, files: out, scope: scope };
  }
  const d = await git(root, ['diff', '--no-color', '-U3'].concat(range, ['--'], files));
  let text = d.out;
  if (!text && scope !== 'branch') {
    try {
      const full = path.join(root, files[0]);
      if (full.startsWith(root + path.sep) && fs.statSync(full).size < MAX_DIFF) {
        text = '+++ ' + files[0] + ' (nouveau fichier)\n' + fs.readFileSync(full, 'utf-8').split('\n').map(function (l) { return '+' + l; }).join('\n');
      }
    } catch { /* fichier supprimé ou illisible */ }
  }
  return { ok: d.ok, text: text.length > MAX_DIFF ? text.slice(0, MAX_DIFF) + '\n… (diff tronqué)' : text, error: d.ok ? '' : d.err };
}

async function stage(cwd, files, on) {
  const root = await repoRoot(cwd);
  if (!root) return { ok: false, error: 'Dossier inaccessible.' };
  const list = safeFiles(files);
  if (!list.length) return { ok: false, error: 'Aucun fichier.' };
  const r = await git(root, on ? ['add', '--'].concat(list) : ['restore', '--staged', '--'].concat(list));
  return { ok: r.ok, error: r.err };
}

async function commit(cwd, message, push) {
  const root = await repoRoot(cwd);
  if (!root) return { ok: false, error: 'Dossier inaccessible.' };
  const msg = String(message || '').trim();
  if (!msg) return { ok: false, error: 'Message de commit vide.' };
  const c = await git(root, ['commit', '-m', msg]);
  if (!c.ok) return { ok: false, error: c.err || c.out };
  if (!push) return { ok: true, output: c.out.trim() };
  const p = await git(root, ['push'], { timeout: 60000 });
  return { ok: p.ok, output: c.out.trim(), error: p.ok ? '' : 'Commit créé, push échoué : ' + p.err };
}

module.exports = { status, diff, stage, commit, snapshot, parseStatus, repoRoot, validDir };
