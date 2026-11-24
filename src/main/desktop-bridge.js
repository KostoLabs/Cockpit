'use strict';
/* Écriture dans les sessions tenues par Hermes Desktop (et CLI, TUI, messagerie).
 *
 * L'API server refuse d'écrire dans une session d'une autre surface (409). Hermes
 * Desktop passe par le gateway partagé : WebSocket locale `/api/ws`, protocole
 * `hermes-gateway-v1`, JSON-RPC 2.0 (doc « Programmatic Integration » et
 * « Gateway Internals → hermes gateway attach »).
 *
 *   1. `hermes gateway attach --json` → { url, protocols (dont le ticket), protocol }.
 *      Le ticket est à usage unique et expire en 30 s : on relance attach à chaque connexion.
 *   2. WebSocket depuis la boucle locale, sans en-tête Origin (process main).
 *   3. runtime.describe, puis client.capabilities { server_requests: true } et { client }.
 *   4. session.resume { session_id, omit_messages } attache le Cockpit comme spectateur.
 *   5. prompt.submit { session_id, text, input_id, model_override? }.
 *   6. Événements `{"method":"event","params":{type, session_id, payload, execution_generation}}` :
 *      message.delta / complete, tool.start / complete, reasoning.delta, subagent.*,
 *      approval.request / settled, clarify.request / settled, error.
 *   7. Contrôles : approval.respond, clarify.respond, session.interrupt
 *      (tous liés à execution_generation).
 *
 * Les événements sont traduits dans le format de hermes-client.js (delta, tool, approval…),
 * de sorte que le renderer affiche une session Desktop exactement comme une session du Cockpit. */
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLIENT_NAME = 'klai-cockpit';

function candidates(custom) {
  const home = os.homedir();
  return [custom,
    path.join(home, '.local', 'bin', 'hermes'),
    path.join(home, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes', '/usr/bin/hermes'].filter(Boolean);
}

/* Les apps lancées depuis le Finder n'héritent pas du PATH du shell : on cherche
 * l'exécutable aux emplacements connus, puis via le shell de connexion. */
function findHermes(custom, execFileImpl) {
  for (const c of candidates(custom)) {
    try { fs.accessSync(c, fs.constants.X_OK); return Promise.resolve(c); } catch { /* suivant */ }
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    (execFileImpl || execFile)(shell, ['-lc', 'command -v hermes'], { timeout: 8000 }, (err, stdout) => {
      const p = String(stdout || '').trim().split('\n').pop();
      resolve(!err && p && path.isAbsolute(p) ? p : null);
    });
  });
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((p) => (typeof p === 'string' ? p : p && p.text) || '').join('');
  return String(v.text || '');
}

function createDesktopBridge(opts) {
  const getSettings = opts.getSettings;
  const passive = opts.onEvent || (() => {});
  const log = opts.log || (() => {});
  const WS = opts.WebSocketImpl || globalThis.WebSocket;
  const run = opts.execFileImpl || execFile;
  const version = opts.version || '';

  let ws = null;
  let connecting = null;
  let started = false;
  let seq = 0;
  const pending = new Map();   // id JSON-RPC -> { resolve, reject, timer }
  const attached = new Map();  // session_id -> { generation }
  const turns = new Map();     // session_id -> { onEvent, finish, gotText, prompts:Set }

  async function attachGrant() {
    const s = getSettings();
    const bin = await findHermes(s.hermesBin, run);
    if (!bin) throw new Error('Commande « hermes » introuvable. Indiquez son chemin dans Réglages → Hermes local.');
    const args = ['gateway', 'attach', '--json'];
    if (!started) args.push('--start');
    const env = Object.assign({}, process.env);
    if (s.hermesHome) env.HERMES_HOME = s.hermesHome.replace(/^~(?=$|\/)/, os.homedir());
    const out = await new Promise((resolve) => {
      run(bin, args, { timeout: 90000, env: env, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    });
    started = true;
    let grant = null;
    const lines = out.stdout.trim().split('\n').filter(Boolean);
    try { grant = JSON.parse(lines[lines.length - 1] || '{}'); } catch { grant = null; }
    if (!grant || !grant.url || !Array.isArray(grant.protocols)) {
      const msg = (grant && (grant.message || grant.detail)) || out.stderr.trim() || (out.err && out.err.message) || 'réponse illisible';
      throw new Error('Gateway Hermes indisponible : ' + String(msg).split('\n')[0].slice(0, 300));
    }
    return grant;
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) throw new Error('connexion au gateway fermée');
    ws.send(JSON.stringify(obj));
  }

  function request(method, params, timeoutMs) {
    return connect().then(() => new Promise((resolve, reject) => {
      const id = 'klai-' + (++seq);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' : délai dépassé')); }, timeoutMs || 30000);
      pending.set(id, { resolve, reject, timer, method });
      try { send({ jsonrpc: '2.0', id: id, method: method, params: params || {} }); }
      catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
    }));
  }

  function rawRequest(method, params) {
    // pendant la connexion : même mécanique, sans repasser par connect()
    return new Promise((resolve, reject) => {
      const id = 'klai-' + (++seq);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' : délai dépassé')); }, 20000);
      pending.set(id, { resolve, reject, timer, method });
      try { send({ jsonrpc: '2.0', id: id, method: method, params: params || {} }); }
      catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
    });
  }

  function connect() {
    if (ws && ws.readyState === 1) return Promise.resolve();
    if (connecting) return connecting;
    connecting = (async () => {
      if (!WS) throw new Error('WebSocket indisponible dans ce runtime.');
      const grant = await attachGrant();
      const sock = new WS(grant.url, grant.protocols);
      await new Promise((resolve, reject) => {
        sock.addEventListener('open', () => resolve(), { once: true });
        sock.addEventListener('error', () => reject(new Error('connexion WebSocket au gateway refusée')), { once: true });
        sock.addEventListener('close', (ev) => reject(new Error('gateway fermé pendant la connexion (' + ev.code + ')')), { once: true });
      });
      if (grant.protocol && sock.protocol && sock.protocol !== grant.protocol) {
        sock.close();
        throw new Error('protocole inattendu : ' + sock.protocol);
      }
      ws = sock;
      sock.addEventListener('message', (ev) => onFrame(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf-8')));
      sock.addEventListener('close', () => onClose(sock));
      await rawRequest('runtime.describe', {});
      try { await rawRequest('client.capabilities', { server_requests: true }); } catch { /* ancien gateway */ }
      try { await rawRequest('client.capabilities', { client: Object.assign({ name: CLIENT_NAME }, version ? { version: version } : {}) }); } catch { /* ignoré */ }
      log('pont Desktop connecté');
    })();
    return connecting.finally(() => { connecting = null; });
  }

  function onClose(sock) {
    if (ws !== sock) return;
    ws = null;
    attached.clear();
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error('connexion au gateway perdue')); pending.delete(id); }
    for (const [sid, t] of turns) { t.onEvent({ type: 'error', text: 'Connexion au gateway Hermes perdue pendant le tour.' }); t.finish(); turns.delete(sid); }
  }

  function onFrame(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id != null && (Object.prototype.hasOwnProperty.call(msg, 'result') || msg.error) && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const e = new Error(msg.error.message || ('erreur ' + msg.error.code));
        e.code = msg.error.code;
        e.data = msg.error.data;
        p.reject(e);
      } else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'event' && msg.params) return onEvent(msg.params);
    if (msg.method && msg.id != null) {
      // Requête serveur → client non prise en charge (sudo, secret, terminal.read…) :
      // on répond tout de suite pour que l'agent n'attende pas l'expiration.
      try { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'non pris en charge par le Cockpit' } }); } catch { /* fermé */ }
    }
  }

  function emit(sid, ev) {
    const t = turns.get(sid);
    if (t) t.onEvent(ev); else passive(Object.assign({ session: sid, via: 'desktop' }, ev));
  }

  function onEvent(ev) {
    const sid = ev.session_id;
    if (!sid) return;
    if (typeof ev.execution_generation === 'number') {
      const a = attached.get(sid) || {};
      a.generation = ev.execution_generation;
      attached.set(sid, a);
    }
    const p = ev.payload || {};
    const t = turns.get(sid);
    switch (ev.type) {
      case 'message.start':
        if (!t) passive({ session: sid, via: 'desktop', type: 'start' });
        return;
      case 'message.delta':
        if (p.text) { if (t) t.gotText = true; emit(sid, { type: 'delta', text: textOf(p.text) }); }
        return;
      case 'reasoning.delta':
      case 'thinking.delta':
        if (p.text) emit(sid, { type: 'reasoning', text: textOf(p.text) });
        return;
      case 'tool.start':
        emit(sid, { type: 'tool', phase: 'started', tool: p.name || 'outil', id: p.tool_id || '', preview: p.preview || p.args_text || p.context || '' });
        return;
      case 'tool.complete': {
        const result = String(p.summary || p.result_text || '');
        emit(sid, { type: 'tool', phase: 'completed', tool: p.name || 'outil', id: p.tool_id || '', duration: Number(p.duration_s || 0),
          preview: result.slice(0, 500), error: /^(BLOCKED|Error|error)/.test(result) });
        return;
      }
      case 'subagent.start':
        emit(sid, { type: 'subagent', phase: 'start', name: p.goal || 'sous-agent', delegationId: p.delegation_id || '', childSessionId: p.child_session_id || '' });
        return;
      case 'subagent.complete':
        emit(sid, { type: 'subagent', phase: 'complete', name: p.goal || 'sous-agent', status: p.status || 'completed', summary: p.summary || '',
          duration: Number(p.duration_s || 0), childSessionId: p.child_session_id || '' });
        return;
      case 'approval.request':
        emit(sid, { type: 'approval', requestId: p.prompt_id, generation: p.execution_generation != null ? p.execution_generation : ev.execution_generation,
          command: p.command || '', description: p.description || '', choices: p.choices || (p.allow_permanent === false ? ['once', 'session', 'deny'] : ['once', 'session', 'always', 'deny']) });
        return;
      case 'clarify.request': {
        const q = p.question || (p.questions && p.questions[0] && p.questions[0].question) || '';
        const choices = p.choices || (p.questions && p.questions[0] && p.questions[0].choices) || [];
        emit(sid, { type: 'clarify', requestId: p.prompt_id, generation: p.execution_generation != null ? p.execution_generation : ev.execution_generation, question: q, choices: choices || [] });
        return;
      }
      case 'approval.settled':
        emit(sid, { type: 'settled', kind: 'approval', requestId: p.prompt_id });
        return;
      case 'clarify.settled':
        emit(sid, { type: 'settled', kind: 'clarify', requestId: p.prompt_id });
        return;
      case 'message.complete': {
        const status = p.status || '';
        if (t && !t.gotText && p.text) emit(sid, { type: 'delta', text: textOf(p.text) });
        if (status === 'error' || p.error) emit(sid, { type: 'error', text: p.error || p.failure_reason || 'Le tour a échoué.' });
        else if (status === 'interrupted') emit(sid, { type: 'cancelled' });
        else emit(sid, { type: 'done', usage: p.usage || null });
        if (t) { turns.delete(sid); t.finish(); } else passive({ session: sid, via: 'desktop', type: 'end' });
        return;
      }
      case 'error':
        emit(sid, { type: 'error', text: p.message || 'Erreur du gateway.' });
        if (t) { turns.delete(sid); t.finish(); }
        return;
      default:
        return;
    }
  }

  async function ensureAttached(sid) {
    if (attached.has(sid) && ws && ws.readyState === 1) return attached.get(sid);
    const snap = await request('session.resume', { session_id: sid, omit_messages: true });
    const a = { generation: snap && typeof snap.execution_generation === 'number' ? snap.execution_generation : 0 };
    attached.set(sid, a);
    return a;
  }

  /* Un tour dans une session Desktop. Résout à la fin du tour (message.complete). */
  async function runTurn(args) {
    const sid = args.sessionId;
    const onEvent = args.onEvent;
    if (turns.has(sid)) return { ok: false, error: 'Un tour est déjà en cours dans cette session.' };
    try {
      await ensureAttached(sid);
    } catch (err) {
      onEvent({ type: 'error', text: 'Impossible de rejoindre la session Desktop : ' + err.message });
      return { ok: false, error: err.message };
    }
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    turns.set(sid, { onEvent: onEvent, finish: finish, gotText: false });
    const params = { session_id: sid, text: args.input, input_id: crypto.randomUUID() };
    if (args.model) params.model_override = Object.assign({ model: args.model }, args.provider ? { provider: args.provider } : {});
    try {
      const adm = await request('prompt.submit', params, 60000);
      onEvent({ type: 'run', runId: adm && adm.admission_id || '' });
      if (adm && adm.status === 'queued') onEvent({ type: 'notice', text: 'Message mis en file : un tour est déjà en cours dans Hermes Desktop.' });
      if (adm && typeof adm.execution_generation === 'number') attached.get(sid).generation = adm.execution_generation;
    } catch (err) {
      turns.delete(sid);
      onEvent({ type: 'error', text: 'Envoi refusé par le gateway : ' + err.message });
      return { ok: false, error: err.message };
    }
    if (args.signal) args.signal.addEventListener('abort', () => { interrupt(sid).catch(() => {}); }, { once: true });
    await done;
    return { ok: true, via: 'desktop' };
  }

  function generation(sid, given) {
    if (typeof given === 'number') return given;
    const a = attached.get(sid);
    return a ? a.generation : 0;
  }

  const interrupt = (sid) => request('session.interrupt', { session_id: sid, execution_generation: generation(sid) });
  const approve = (sid, a) => request('approval.respond', { session_id: sid, execution_generation: generation(sid, a.generation), prompt_id: a.requestId, choice: a.choice });
  const clarify = (sid, a) => request('clarify.respond', { session_id: sid, execution_generation: generation(sid, a.generation), prompt_id: a.requestId, answer: a.answer });

  async function status() {
    try {
      const bin = await findHermes(getSettings().hermesBin, run);
      return { ok: !!bin, bin: bin, connected: !!(ws && ws.readyState === 1), error: bin ? '' : 'commande « hermes » introuvable' };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  function close() { if (ws) { try { ws.close(); } catch { /* déjà fermé */ } } }

  return { runTurn, interrupt, approve, clarify, status, close, connect, owns: (sid) => turns.has(sid) || attached.has(sid) };
}

module.exports = { createDesktopBridge, findHermes };
