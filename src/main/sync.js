'use strict';
/* Pont Cockpit ↔ ctx_handover : lit l'état du plugin sur cet appareil
 * (~/.hermes/ctx_handover), interroge le master (HTTP avec jeton, ou SSH),
 * rend la transcription d'une session d'un autre appareil, installe et configure
 * le plugin. Le protocole est celui de plugins/ctx_handover (core.py, server.py). */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function hermesHome() { return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'); }
function pluginConfigPath() { return process.env.CTX_HANDOVER_CONFIG || path.join(hermesHome(), 'ctx_handover.json'); }
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return d; } }
function safeName(v) { return String(v || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 120) || 'x'; }

function pluginConfig() {
  const cfg = readJson(pluginConfigPath(), null);
  if (!cfg) return null;
  const out = Object.assign({}, cfg);
  out.hasToken = !!cfg.token;
  delete out.token;
  delete out.api_key;
  return out;
}

function storeDir(cfg) { return (cfg && cfg.store) || path.join(hermesHome(), 'ctx_handover'); }

function localState() {
  const cfg = readJson(pluginConfigPath(), null);
  const root = path.join(storeDir(cfg), 'device');
  const state = readJson(path.join(root, 'state.json'), null);
  const mirror = [];
  try {
    for (const origin of fs.readdirSync(path.join(root, 'mirror'))) {
      for (const f of fs.readdirSync(path.join(root, 'mirror', origin))) {
        if (!f.endsWith('.json')) continue;
        const b = readJson(path.join(root, 'mirror', origin, f), null);
        if (b) mirror.push({ origin: b.origin, session_id: b.session_id, title: b.title, updated_at: b.updated_at, size: (b.jsonl || '').length, local: true });
      }
    }
  } catch { /* pas de miroir */ }
  mirror.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return {
    installed: fs.existsSync(path.join(hermesHome(), 'plugins', 'ctx_handover', 'plugin.yaml')),
    configured: !!cfg,
    config: pluginConfig(),
    state: state ? { cursor: state.cursor, pushed: Object.keys(state.pushed || {}).length, lastPush: state.last_push, lastPull: state.last_pull, lastError: state.last_error } : null,
    mirror: mirror
  };
}

/* ---------------- master ---------------- */

function masterRequest(sync, token, method, pathname, timeoutMs) {
  return new Promise(function (resolve) {
    if (sync.transport === 'ssh') {
      if (!sync.sshTarget) return resolve({ ok: false, error: 'Cible SSH manquante.' });
      const parts = pathname.replace(/^\/v1\//, '').split('/');
      let args;
      if (parts[0] === 'status') args = ['status', '--json'];
      else if (parts[0] === 'sessions' && parts.length === 1) args = ['changes', '--since', '0'];
      else if (parts[0] === 'sessions') args = ['get', safeName(decodeURIComponent(parts[1])), safeName(decodeURIComponent(parts[2]))];
      else return resolve({ ok: false, error: 'Opération non disponible en SSH.' });
      const remote = (sync.sshCommand || 'python3 -m ctx_handover') + ' ' + args.join(' ');
      execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sync.sshTarget, remote], { timeout: timeoutMs || 30000, maxBuffer: 64 * 1024 * 1024 },
        function (err, stdout, stderr) {
          if (err) return resolve({ ok: false, error: 'ssh : ' + String(stderr || err.message).trim().slice(0, 300) });
          try {
            let data = JSON.parse(stdout);
            if (parts[0] === 'status' && data.master) data = data.master;
            if (parts[0] === 'sessions' && parts.length === 1) data = { sessions: data.entries || [] };
            resolve({ ok: true, data: data });
          } catch (e) { resolve({ ok: false, error: 'Réponse SSH illisible.' }); }
        });
      return undefined;
    }
    if (!sync.masterUrl) return resolve({ ok: false, error: 'URL du master manquante.' });
    if (!token) return resolve({ ok: false, error: 'Jeton du master manquant.' });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    fetch(sync.masterUrl.replace(/\/+$/, '') + pathname, {
      method: method, signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    }).then(async function (res) {
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* corps non JSON */ }
      resolve(res.ok ? { ok: true, data: data } : { ok: false, status: res.status, error: res.status === 401 ? 'Jeton refusé par le master.' : 'HTTP ' + res.status });
    }).catch(function (err) {
      resolve({ ok: false, error: err.name === 'AbortError' ? 'Master injoignable (délai dépassé).' : String(err.message || err) });
    }).finally(function () { clearTimeout(t); });
    return undefined;
  });
}

/* ---------------- transcription (même rendu que core.transcript) ---------------- */

function textOf(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p && /text/.test(p.type || '') ? p.text || '' : p && /image/.test(p.type || '') ? '[image]' : '')).join('');
  if (typeof c === 'object') return c.text || JSON.stringify(c);
  return String(c);
}

function transcript(bundle, maxChars) {
  const lines = [];
  for (const line of String(bundle.jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    for (const m of rec.messages || []) {
      if (m.active === false) continue;
      const role = m.role || m.type || '';
      if (role === 'system' || role === 'tool') continue;
      let body = textOf(m.content !== undefined ? m.content : m.text).trim();
      const calls = (m.tool_calls || []).map((c) => (c.function || c).name || 'outil');
      if (calls.length && role === 'assistant') body = (body ? body + '\n' : '') + '_outils : ' + calls.join(', ') + '_';
      if (!body) continue;
      lines.push('**' + ({ user: 'Utilisateur', assistant: 'Hermes' }[role] || role) + '** — ' + body);
    }
  }
  let out = lines.join('\n\n');
  if (maxChars && out.length > maxChars) {
    const keep = Math.floor(maxChars / 2);
    out = out.slice(0, keep) + '\n\n[… ' + (out.length - 2 * keep) + ' caractères omis …]\n\n' + out.slice(-keep);
  }
  return out;
}

/* ---------------- installation du plugin ---------------- */

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '__pycache__' || name === 'tests') continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s)); // lecture compatible asar
  }
}

function register(METHODS, settings, appRoot) {
  const sync = () => settings.all().sync || {};
  const token = () => settings.secret('syncToken');

  METHODS.syncStatus = async function () {
    const local = localState();
    const s = sync();
    let master = null;
    if (s.enabled && (s.masterUrl || s.sshTarget)) master = await masterRequest(s, token(), 'GET', '/v1/status');
    return { ok: true, local: local, master: master, settings: s };
  };

  METHODS.syncFeed = async function () {
    const s = sync();
    const local = localState().mirror;
    if (!s.enabled) return { ok: true, sessions: local, source: 'local' };
    const r = await masterRequest(s, token(), 'GET', '/v1/sessions?limit=300');
    if (!r.ok) return { ok: true, sessions: local, source: 'local', error: r.error };
    return { ok: true, sessions: (r.data && r.data.sessions) || [], source: 'master' };
  };

  METHODS.syncSession = async function (origin, sessionId, maxChars) {
    const o = safeName(origin), sid = String(sessionId || '');
    let bundle = null;
    const cfg = readJson(pluginConfigPath(), null);
    const localFile = path.join(storeDir(cfg), 'device', 'mirror', o, safeName(sid) + '.json');
    const s = sync();
    if (s.enabled) {
      const r = await masterRequest(s, token(), 'GET', '/v1/sessions/' + encodeURIComponent(o) + '/' + encodeURIComponent(sid), 60000);
      if (r.ok) bundle = r.data;
    }
    if (!bundle) bundle = readJson(localFile, null);
    if (!bundle) return { ok: false, error: 'Session introuvable sur le master et dans le miroir local.' };
    return { ok: true, origin: bundle.origin, sessionId: bundle.session_id, title: bundle.title, updatedAt: bundle.updated_at,
      transcript: transcript(bundle, Number(maxChars) || 0) };
  };

  METHODS.syncTest = async function () {
    return masterRequest(sync(), token(), 'GET', '/v1/status');
  };

  /* Écrit la configuration du plugin de cet appareil (~/.hermes/ctx_handover.json)
   * et, si demandé, copie le plugin dans ~/.hermes/plugins/ctx_handover. */
  METHODS.syncSave = async function (opts) {
    opts = opts || {};
    const out = {};
    if (opts.install) {
      const src = path.join(appRoot, 'plugins', 'ctx_handover');
      const dst = path.join(hermesHome(), 'plugins', 'ctx_handover');
      if (!fs.existsSync(hermesHome())) return { ok: false, error: 'Hermes n’est pas installé ici (' + hermesHome() + ' absent).' };
      copyTree(src, dst);
      out.installed = dst;
    }
    if (opts.configure) {
      const s = sync();
      const p = pluginConfigPath();
      const prev = readJson(p, {});
      const next = Object.assign({}, prev, {
        enabled: true, role: 'device',
        device: safeName(s.device || os.hostname().split('.')[0].toLowerCase()),
        transport: s.transport === 'ssh' ? 'ssh' : 'http'
      });
      if (s.masterUrl) next.master_url = s.masterUrl;
      if (s.sshTarget) next.ssh_target = s.sshTarget;
      if (s.sshCommand) next.ssh_command = s.sshCommand;
      if (token()) next.token = token();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
      out.configured = p;
    }
    return Object.assign({ ok: true }, out);
  };
}

module.exports = { register, transcript, localState, safeName };
