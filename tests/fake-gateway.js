'use strict';
/* Faux gateway Hermes (API server) pour les tests et la démo hors ligne.
 *   node tests/fake-gateway.js [--port 8642] [--key test-key]
 * Couvre : /v1/models, /v1/capabilities, /health/detailed, /api/sessions (+messages, fork),
 * /v1/runs (+events SSE, stop, approval, steer, clarify), /api/jobs, /v1/skills, /v1/toolsets,
 * /api/model/options. Un message contenant « approuve » déclenche une demande d'approbation,
 * « délègue » un sous-agent. */
const http = require('http');
const crypto = require('crypto');

function now() { return Date.now() / 1000; }

function seed() {
  const t = now();
  const S = (id, title, ws, source, minsAgo, msgs, extra) => Object.assign({
    session_id: id, title: title, source: source, cwd: ws, model: 'hermes-agent',
    message_count: msgs.length, started_at: t - minsAgo * 60 - 3600, last_message_at: t - minsAgo * 60,
    messages: msgs
  }, extra || {});
  const m = (role, content, extra) => Object.assign({ role: role, content: content, timestamp: t - 600 }, extra || {});
  return [
    S('koordo-recette', 'Recette Preprod App', '/Users/q/Developer/koordo', 'api_server', 3, [
      m('user', 'Lance la recette preprod'),
      m('assistant', '12 tests lancés, **2 échecs** en cours de correction :\n\n1. `auth.spec.ts` — jeton expiré\n2. `upload.spec.ts` — délai dépassé', { tool_calls: [{ function: { name: 'terminal', arguments: '{"command":"npm test"}' } }, { function: { name: 'write_file', arguments: '{"path":"rapport-recette.md"}' } }] }),
      m('assistant', 'Rapport détaillé : https://ci.example.com/koordo/recette/412')
    ], { is_streaming: true }),
    S('koordo-ears', 'Créer EARS pour enregistrement', '/Users/q/Developer/koordo', 'api_server', 14, [m('user', 'Rédige les exigences EARS'), m('assistant', 'Rédaction des exigences 4/9.')]),
    S('koordo-orga', 'Proposer une organisation', '/Users/q/Developer/koordo', 'cli', 90, [m('user', 'Propose une organisation'), m('assistant', 'Plan en 3 lots prêt à relire.')]),
    S('gusai-tests', 'Corriger les tests d’intégration', '/Users/q/Developer/gusai', 'api_server', 6, [m('user', 'Corrige les tests'), m('assistant', 'Étape 2/5 · relance de la suite.')], { is_streaming: true }),
    S('genres-pipeline', 'Pipeline géno-phénotype', '/Users/q/Developer/genres', 'api_server', 2, [m('user', 'Lance le pipeline'), m('assistant', 'Étape 4/7 · associations variants–phénotypes.')], { is_streaming: true }),
    S('accueil-juridique', 'Première analyse juridique', '/Users/q', 'api_server', 45, [
      m('user', 'Première analyse juridique, à froid, de ce contrat'),
      m('assistant', '## Conclusion pratique\n\nLe principal risque n’est pas le prix du BUILD : c’est de dépendre d’un prestataire pour la paie, avec des recours réduits et une sortie mal organisée.\n\n1. Fixer l’identité des parties et sécuriser le montage intragroupe.\n2. Protéger les fonds de paie et recalibrer la garantie d’impayés.\n3. Réécrire responsabilité, preuve et délais de recours.\n\n**En bref :** une base de négociation utilisable, mais pas une version prête pour signature.')
    ]),
    S('accueil-secrets', 'Retrouver secrets PREP', '/Users/q', 'telegram', 8, [m('user', 'Retrouve les secrets PREP'), m('assistant', 'Étape 3/8 · fichiers .env')]),
    S('runner-maj', 'Mettre à jour le runner', '/Users/q/actions-runner', 'api_server', 240, [m('user', 'Mets à jour le runner'), m('assistant', 'Backend d’inférence indisponible.')], { end_reason: 'error' })
  ];
}

function createFakeGateway(opts) {
  opts = opts || {};
  const key = opts.key === undefined ? 'test-key' : opts.key;
  const features = Object.assign({ chat_completions: true, run_submission: true, run_status: true, run_events_sse: true, run_stop: true, run_approval: true, session_chat_stream: true }, opts.features || {});
  const sessions = seed();
  const remap = opts.remap || {};
  sessions.forEach((x) => { if (remap[x.cwd]) x.cwd = remap[x.cwd]; });
  const runs = new Map();
  const jobs = [
    { job_id: 'j1', name: 'Veille réglementaire', prompt: 'Fais la veille réglementaire', schedule: '30 8 * * *', state: 'active', next_run_at: now() + 3600, last_run_at: now() - 82800, last_status: 'ok' },
    { job_id: 'j2', name: 'Recette nocturne', prompt: 'Lance la recette Koordo', schedule: '0 23 * * *', state: 'active', next_run_at: now() + 7200, last_status: 'ok' }
  ];
  const log = [];

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    });
  }
  function publicSession(s) {
    const o = Object.assign({}, s);
    delete o.messages;
    o.message_count = s.messages.length;
    return o;
  }
  function emit(run, event, data) {
    const frame = 'event: ' + event + '\ndata: ' + JSON.stringify(Object.assign({ event: event, run_id: run.id }, data)) + '\n\n';
    run.buffer.push(frame);
    for (const r of run.listeners) r.write(frame);
    if (/^run\./.test(event)) { run.status = event.slice(4); for (const r of run.listeners) r.end(); run.listeners = []; }
  }

  async function execute(run) {
    const s = sessions.find((x) => x.session_id === run.session_id);
    const input = run.input;
    s.messages.push({ role: 'user', content: input, timestamp: now() });
    s.is_streaming = true;
    emit(run, 'tool.started', { tool: 'read_file', preview: 'README.md' });
    await wait(15);
    emit(run, 'tool.completed', { tool: 'read_file', duration: 0.4, error: false, preview: '# Projet' });
    if (/approuve/i.test(input)) {
      run.status = 'waiting_for_approval';
      run.pending = { request_id: 'p-' + run.id, execution_generation: 1 };
      emit(run, 'approval.request', { request_id: run.pending.request_id, execution_generation: 1, command: 'ssh-add ~/.ssh/id_remote', description: 'Commande sensible' });
      const choice = await new Promise((r) => { run.resolveApproval = r; });
      run.status = 'running';
      if (choice === 'deny') {
        emit(run, 'tool.completed', { tool: 'terminal', duration: 0, error: true, preview: 'BLOCKED: refusé' });
      } else {
        emit(run, 'tool.completed', { tool: 'terminal', duration: 1.2, error: false, preview: 'Identity added' });
      }
    }
    if (/délègue|delegue/i.test(input)) {
      emit(run, 'subagent.start', { name: 'veille-jurisprudence', delegation_id: 'd1' });
      await wait(15);
      emit(run, 'subagent.complete', { name: 'veille-jurisprudence', status: 'completed', summary: '3 décisions pertinentes', duration: 4.2, delegation_id: 'd1' });
    }
    const words = ['Bien', ' reçu', '.', ' Tout', ' fonctionne', '.'];
    let out = '';
    for (const w of words) {
      if (run.stopRequested) { s.is_streaming = false; emit(run, 'run.cancelled', { completed: false, interrupted: true, turn_exit_reason: 'interrupted_by_user' }); return; }
      out += w;
      emit(run, 'message.delta', { delta: w });
      await wait(opts.tick || 10);
    }
    s.messages.push({ role: 'assistant', content: out, timestamp: now() });
    s.last_message_at = now();
    s.is_streaming = false;
    emit(run, 'run.completed', { completed: true, output: out, usage: { input_tokens: 50, output_tokens: 6 } });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    log.push(req.method + ' ' + p);
    if (p === '/health') return send(res, 200, { status: 'ok' });
    if (key && req.headers.authorization !== 'Bearer ' + key) return send(res, 401, { error: { code: 'unauthorized', message: 'unauthorized' } });

    if (p === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: 'hermes-agent' }] });
    if (p === '/v1/capabilities') return send(res, 200, { object: 'hermes.api_server.capabilities', features: features, endpoints: {} });
    if (p === '/health/detailed') return send(res, 200, { status: 'ok', version: '0.15.2', readiness: { checks: {} } });
    if (p === '/api/model/options') return send(res, 200, { providers: [{ id: 'nous', name: 'Nous Portal', models: [{ id: 'hermes-4-405b', label: 'Hermes 4 405B' }, { id: 'hermes-4-70b' }] }, { id: 'openrouter', models: ['anthropic/claude-sonnet-5.5'] }], current: { provider: 'nous', model: 'hermes-4-405b' } });
    if (p === '/v1/skills') return send(res, 200, [{ name: 'github-pr-workflow', description: 'Ouvrir et suivre une PR', category: 'Dev' }, { name: 'veille-juridique', description: 'Veille de jurisprudence', category: 'Recherche' }]);
    if (p === '/v1/toolsets') return send(res, 200, [{ name: 'core', label: 'Noyau', description: 'Fichiers et terminal', enabled: true, configured: true, tools: ['read_file', 'write_file', 'terminal'] }, { name: 'web', label: 'Web', description: 'Recherche web', enabled: true, configured: false, tools: ['web_search'] }]);

    if (p === '/api/sessions' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 50);
      return send(res, 200, { sessions: sessions.slice(0, limit).map(publicSession), total: sessions.length });
    }
    if (p === '/api/sessions' && req.method === 'POST') {
      const b = await readBody(req);
      const s = { session_id: 'api-' + crypto.randomUUID().slice(0, 8), title: b.title || null, source: 'api_server', cwd: b.cwd || '', model: 'hermes-agent', started_at: now(), last_message_at: now(), messages: [] };
      sessions.unshift(s);
      return send(res, 201, publicSession(s));
    }
    let mm = p.match(/^\/api\/sessions\/([^/]+)(\/messages|\/fork|\/chat\/stream)?$/);
    if (mm) {
      const s = sessions.find((x) => x.session_id === decodeURIComponent(mm[1]));
      if (!s) return send(res, 404, { error: { code: 'not_found', message: 'session inconnue' } });
      if (mm[2] === '/messages') return send(res, 200, { session_id: s.session_id, messages: s.messages });
      if (mm[2] === '/fork') {
        const b = await readBody(req);
        const f = Object.assign({}, s, { session_id: s.session_id + '-fork', title: b.title || s.title + ' #2', source: 'api_server', messages: s.messages.slice(), parent_session_id: s.session_id });
        sessions.unshift(f);
        return send(res, 201, publicSession(f));
      }
      if (mm[2] === '/chat/stream') {
        if (features.session_chat_stream === false) return send(res, 404, {});
        const b = await readBody(req);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': keepalive\n\n');
        s.messages.push({ role: 'user', content: b.input });
        res.write('event: assistant.delta\ndata: {"delta":"Par flux de session."}\n\n');
        s.messages.push({ role: 'assistant', content: 'Par flux de session.' });
        return res.end('event: run.completed\ndata: {"completed":true}\n\n');
      }
      if (req.method === 'PATCH') { const b = await readBody(req); if (b.title) s.title = b.title; return send(res, 200, publicSession(s)); }
      if (req.method === 'DELETE') { sessions.splice(sessions.indexOf(s), 1); return send(res, 200, { deleted: true }); }
      return send(res, 200, publicSession(s));
    }

    if (p === '/v1/runs' && req.method === 'POST') {
      if (features.run_submission === false) return send(res, 404, {});
      const b = await readBody(req);
      const s = sessions.find((x) => x.session_id === b.session_id);
      if (!s) return send(res, 404, { error: { code: 'not_found', message: 'session inconnue' } });
      if (s.source !== 'api_server') return send(res, 409, { error: { code: 'permission_denied', message: 'session owned by another surface' } });
      const run = { id: 'run_' + crypto.randomUUID().slice(0, 8), session_id: b.session_id, input: b.input, status: 'running', buffer: [], listeners: [] };
      runs.set(run.id, run);
      setTimeout(() => execute(run), 5);
      return send(res, 202, { run_id: run.id, status: 'started' });
    }
    mm = p.match(/^\/v1\/runs\/([^/]+)(\/events|\/stop|\/approval|\/steer|\/clarify)?$/);
    if (mm) {
      const run = runs.get(mm[1]);
      if (!run) return send(res, 404, { error: { code: 'not_found' } });
      if (mm[2] === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': keepalive\n\n');
        for (const f of run.buffer) res.write(f);
        if (/^(completed|failed|cancelled)$/.test(run.status)) return res.end();
        run.listeners.push(res);
        return;
      }
      if (mm[2] === '/stop') { run.stopRequested = true; return send(res, 200, { status: 'stopping' }); }
      if (mm[2] === '/approval') {
        const b = await readBody(req);
        if (!run.pending || b.request_id !== run.pending.request_id || b.execution_generation !== run.pending.execution_generation) return send(res, 409, { error: { code: 'stale' } });
        run.pending = null;
        run.resolveApproval(b.choice);
        return send(res, 200, { status: 'resolved' });
      }
      if (mm[2] === '/steer') { const b = await readBody(req); emit(run, 'run.steered', { text: b.text }); return send(res, 200, { status: 'queued' }); }
      return send(res, 200, { object: 'hermes.run', run_id: run.id, status: run.status, session_id: run.session_id });
    }

    if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, { jobs: jobs });
    if (p === '/api/jobs' && req.method === 'POST') { const b = await readBody(req); const j = Object.assign({ job_id: 'j' + (jobs.length + 1), state: 'active' }, b); jobs.push(j); return send(res, 201, j); }
    mm = p.match(/^\/api\/jobs\/([^/]+)(\/pause|\/resume|\/run)?$/);
    if (mm) {
      const j = jobs.find((x) => x.job_id === mm[1]);
      if (!j) return send(res, 404, { error: { code: 'not_found' } });
      if (mm[2] === '/pause') j.state = 'paused';
      else if (mm[2] === '/resume') j.state = 'active';
      else if (mm[2] === '/run') j.last_run_at = now();
      else if (req.method === 'DELETE') { jobs.splice(jobs.indexOf(j), 1); return send(res, 200, { deleted: true }); }
      else if (req.method === 'PATCH') Object.assign(j, await readBody(req));
      return send(res, 200, j);
    }
    send(res, 404, { error: { code: 'not_found', message: p } });
  });

  return {
    server, sessions, runs, jobs, log,
    listen(port) { return new Promise((r) => server.listen(port || 0, '127.0.0.1', () => r(server.address().port))); },
    close() { for (const run of runs.values()) for (const l of run.listeners) l.end(); return new Promise((r) => server.close(r)); }
  };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { createFakeGateway };

if (require.main === module) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1]) || 8642;
  const key = args.includes('--key') ? args[args.indexOf('--key') + 1] : '';
  const gw = createFakeGateway({ key: key, tick: 120 });
  gw.listen(port).then((p) => console.log('Faux gateway Hermes sur http://127.0.0.1:' + p + (key ? ' (clé ' + key + ')' : ' (sans clé)')));
}
