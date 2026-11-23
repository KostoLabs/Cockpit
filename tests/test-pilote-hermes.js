/* Test du pilote Hermes (pilote.js) contre un mock au format Réel du gateway :
 * GET /api/sessions -> { object:'list', data:[…] }, messages -> { data:[…] },
 * POST /api/sessions/{id}/chat/stream -> SSE nommé (run.started, assistant.delta,
 * tool.started, approval.request, run.completed, done), POST /v1/runs/{id}/approval,
 * repli legacy /v1/chat/completions (chat.completion.chunk + hermes.tool.progress),
 * 409 permission_denied sur session d'une autre surface, endpoint legacy dashboard
 * /api/session?session_id=…&messages=1, /api/jobs, /api/projects (404 local). */
const http = require('http');
const { createHermesClient, mapSessionRow, mapMessageRow } = require('../pilote');

const API_KEY = 'test-key';
let approved = false;
let lastChatBody = null;
let lastModelLockBody = null;

const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  const send = (code, obj, headers) => {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
    res.end(JSON.stringify(obj));
  };
  if (req.url === '/v1/models') {
    if (auth !== 'Bearer ' + API_KEY) return send(401, { error: 'unauthorized' });
    return send(200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model' }] });
  }
  if (req.url === '/api/model/options') {
    return send(200, { current_provider: 'nous', current_model: 'hermes-agent', providers: [
      { slug: 'nous', name: 'Nous Portal', is_current: true, models: [{ id: 'hermes-agent', label: 'Hermes Agent' }, { id: 'minimax-m3', label: 'MiniMax M3' }] },
      { slug: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }, 'gpt-5.4'] }
    ] });
  }
  const mlock = req.url.match(/^\/api\/sessions\/([^/]+)\/model$/);
  if (mlock && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      lastModelLockBody = JSON.parse(body || '{}');
      send(200, { object: 'hermes.session.model_lock', session_id: decodeURIComponent(mlock[1]), runtime: { model: lastModelLockBody.model, provider: lastModelLockBody.provider || '' } });
    });
  }
  if (req.url === '/v1/capabilities') return send(200, { features: { session_chat_streaming: true }, endpoints: { session_chat_stream: ['POST', '/api/sessions/{session_id}/chat/stream'] } });
  if (req.url.startsWith('/api/sessions?')) {
    return send(200, { object: 'list', data: [
      { id: 's-cli', source: 'cli', title: 'Session TUI', message_count: 12, last_active: 1731470000, pinned: true },
      { id: 's-api', source: 'api_server', title: 'Recette preprod', message_count: 3, last_active: 1731470600 },
      // forme "dashboard" avec champs alternatifs
      { session_id: 's-dash', display_title: 'Ancienne surface', workspace: '/Users/q/dev/koordo', project_id: 'proj-2',
        model: 'hermes-agent', message_count: 5, last_message_at: 1731460000, attention: true, read_only: true,
        is_cli_session: true, is_streaming: true, active_stream_id: 'st-9', window_usage_percent: 41 }
    ], has_more: false });
  }
  if (req.url === '/api/projects') return send(404, { error: 'not found' }); // gateway local : pas de projets
  if (req.url === '/api/jobs?include_disabled=1') {
    return send(200, { jobs: [{ job_id: 'j1', name: 'Veille réglementaire', prompt: 'veille', schedule: '0 8 * * *', next_run_at: 1731470000, enabled: true }] });
  }
  if (req.url === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      const b = JSON.parse(body || '{}');
      send(201, { object: 'hermes.session', session: { id: 'api_new_1', source: b.source || 'api_server', title: b.title || '', message_count: 0, started_at: 1731471000 } });
    });
  }
  let m = req.url.match(/^\/api\/sessions\/([^/]+)\/messages/);
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    if (id === 's-legacy') return send(404, { error: { code: 'session_not_found' } }); // force le repli legacy
    if (id !== 's-api') return send(404, { error: { code: 'session_not_found' } });
    return send(200, { object: 'list', session_id: id, data: [
      { role: 'user', content: 'Lance la recette', timestamp: 1731470001 },
      { role: 'assistant', content: '12 tests, 2 échecs en correction.', timestamp: 1731470002 },
      { role: 'tool', content: 'résultat brut', timestamp: 1731470002 },          // ignoré
      { role: 'assistant', content: '', display_kind: 'hidden', timestamp: 1731470003 } // ignoré
    ], pagination: { limit: 500, offset: 0, order: 'oldest', returned: 4 } });
  }
  m = req.url.match(/^\/api\/session\?session_id=([^&]+)&messages=1/);
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    if (id !== 's-legacy') return send(404, {});
    return send(200, { session: { session_id: id, display_title: 'Session legacy', workspace: '/w', messages: [
      { role: 'user', content: 'hello' }, { role: 'model', content: 'salut' }
    ] } });
  }
  m = req.url.match(/^\/api\/sessions\/([^/]+)\/fork$/);
  if (m && req.method === 'POST') {
    return send(201, { session: { id: 'fork_1', source: 'api_server', title: 'copie', message_count: 3 } });
  }
  m = req.url.match(/^\/api\/sessions\/([^/]+)\/chat\/stream$/);
  if (m && req.method === 'POST') {
    const id = decodeURIComponent(m[1]);
    if (id === 's-cli') return send(409, { error: { code: 'permission_denied', message: 'session owned by another surface' } });
    // NB : un listener 'data' sur la requête bloque le flush SSE du mock Node pour les
    // flux longs (s-slow) ; on ne capture le body que pour s-api.
    if (id === 's-api') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { try { lastChatBody = JSON.parse(body || '{}'); } catch { lastChatBody = {}; } });
    }
    if (id === 's-slow') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: run.started\ndata: {"run_id":"run_slow"}\n\n');
      let i = 0;
      const tick = setInterval(() => { i++; res.write('event: assistant.delta\ndata: ' + JSON.stringify({ delta: 'tok' + i }) + '\n\n'); }, 20);
      req.on('close', () => clearInterval(tick));
      return;
    }
    // s-api : flux nommé avec outil + approbation, suite après résolution
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const w = (ev, obj) => res.write('event: ' + ev + '\ndata: ' + JSON.stringify(obj) + '\n\n');
    res.write(': keepalive\n\n');
    w('run.started', { run_id: 'run_1' });
    w('assistant.delta', { message_id: 'm1', delta: 'Bonjour' });
    w('tool.started', { message_id: 'm1', tool_name: 'terminal', preview: 'ls -la' });
    w('approval.request', { run_id: 'run_1', request_id: 'req_1', command: 'rm -rf /tmp/x', choices: ['once', 'deny'] });
    const wait = setInterval(() => {
      if (!approved) return;
      clearInterval(wait);
      w('assistant.delta', { message_id: 'm1', delta: ' approuvé' });
      w('tool.completed', { message_id: 'm1', tool_name: 'terminal', preview: 'ok', is_error: false });
      w('assistant.completed', { session_id: 's-api', message_id: 'm1', content: 'Bonjour approuvé' });
      w('run.completed', { session_id: 's-api', message_id: 'm1' });
      w('done', {});
      res.end();
    }, 20);
    return;
  }
  if (req.url === '/v1/runs/run_1/approval' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!['once', 'session', 'always', 'deny'].includes(b.choice)) return send(400, { error: 'invalid_approval_choice' });
      approved = true;
      send(200, { status: 'resolved', choice: b.choice });
    });
  }
  if (req.url === '/v1/runs/run_slow/stop' && req.method === 'POST') return send(200, { status: 'stopping' });
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keepalive\n\n');
    res.write('event: hermes.tool.progress\ndata: {"tool":"terminal","preview":"ls"}\n\n');
    const words = ['Salut', ' ', 'legacy'];
    let i = 0;
    const tick = setInterval(() => {
      if (i < words.length) {
        res.write('data: ' + JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: words[i] }, finish_reason: null }] }) + '\n\n');
        i++;
      } else {
        clearInterval(tick);
        res.end('data: ' + JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
      }
    }, 20);
    return;
  }
  send(404, {});
});

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const SETTINGS = { hermesBaseUrl: base, hermesApiKey: API_KEY, model: 'hermes-agent' };
  const events = [];
  const client = createHermesClient({ getSettings: () => SETTINGS, onEvent: (e) => events.push(e) });
  let failures = 0;
  function check(name, cond) {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
    if (!cond) failures++;
  }

  // --- mappings unitaires ---
  const row = mapSessionRow({ id: 'x', source: 'cli', title: 'T', last_active: 5, message_count: 2 });
  check('mapSessionRow cli readOnly', row.readOnly === true && row.id === 'x' && row.updated === 5);
  const row2 = mapSessionRow({ id: 'y', source: 'api_server' });
  check('mapSessionRow api_server writable', row2.readOnly === false);
  const msg = mapMessageRow({ role: 'model', content: 'hi' });
  check('mapMessageRow model->assistant', msg.who === 'assistant' && msg.text === 'hi');
  check('mapMessageRow tool ignoré', mapMessageRow({ role: 'tool', content: 'x' }) === null);
  check('mapMessageRow content array', mapMessageRow({ role: 'user', content: [{ type: 'text', text: 'a' }, { text: 'b' }] }).text === 'ab');

  // --- synchro ---
  const st = await client.status();
  check('status ok + models', st.ok && st.models.join(',') === 'hermes-agent');
  const caps = await client.capabilities();
  check('capabilities ok', caps.ok && caps.caps.features.session_chat_streaming === true);
  const ss = await client.sessions();
  check('sessions {data:[…]}', ss.ok && ss.sessions.length === 3);
  check('session cli readOnly via source', ss.sessions[0].id === 's-cli' && ss.sessions[0].readOnly === true && ss.sessions[0].pinned === true);
  check('session api_server écrivable', ss.sessions[1].readOnly === false && ss.sessions[1].updated === 1731470600);
  check('session dashboard (champs alt)', ss.sessions[2].id === 's-dash' && ss.sessions[2].title === 'Ancienne surface' && ss.sessions[2].readOnly === true && ss.sessions[2].attention === true && ss.sessions[2].streaming === true && ss.sessions[2].contextPct === 41 && ss.sessions[2].projectId === 'proj-2');
  const ms = await client.sessionMessages('s-api');
  check('messages natifs {data:[…]}, tool/hidden filtrés', ms.ok && ms.messages.length === 2 && ms.messages[0].who === 'user' && ms.messages[1].text.indexOf('échecs') !== -1);
  const ml = await client.sessionMessages('s-legacy');
  check('repli legacy /api/session?session_id=', ml.ok && ml.messages.length === 2 && ml.messages[1].who === 'assistant');
  const pj = await client.projects();
  check('projects 404 local -> liste vide non bloquante', pj.ok && pj.projects.length === 0 && pj.unsupported === true);
  const jb = await client.jobs();
  check('jobs', jb.ok && jb.jobs.length === 1 && jb.jobs[0].name.indexOf('Veille') === 0 && jb.jobs[0].schedule === '0 8 * * *');
  const cs = await client.createSession('Nouvelle session');
  check('createSession 201', cs.ok && cs.session.id === 'api_new_1' && cs.session.readOnly === false);
  const fk = await client.forkSession('s-api', 'copie');
  check('fork', fk.ok && fk.session.id === 'fork_1');
  const mo = await client.modelOptions();
  check('modelOptions providers', mo.ok && mo.providers.length === 2 && mo.providers[0].slug === 'nous' && mo.providers[0].isCurrent === true && mo.currentModel === 'hermes-agent');
  check('modelOptions modèles (objet + string)', mo.providers[0].models.length === 2 && mo.providers[0].models[1].label === 'MiniMax M3' && mo.providers[1].models[1].id === 'gpt-5.4' && mo.providers[1].models[1].label === 'gpt-5.4');
  const ml2 = await client.setSessionModel('s-api', 'minimax-m3', 'nous');
  check('setSessionModel POST /api/sessions/{id}/model', ml2.ok === true && lastModelLockBody.model === 'minimax-m3' && lastModelLockBody.provider === 'nous');

  // --- envoi natif chat/stream avec approbation ---
  events.length = 0;
  approved = false;
  SETTINGS.provider = 'nous';
  SETTINGS.model = 'minimax-m3';
  const pSend = client.send('s-api', 'Bonjour');
  // attendre l'événement approval.request
  const t0 = Date.now();
  while (!events.some(e => e.type === 'approval') && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
  const ap = events.find(e => e.type === 'approval');
  check('approval.request reçu', !!ap && ap.runId === 'run_1' && ap.requestId === 'req_1' && ap.command === 'rm -rf /tmp/x');
  const ar = await client.approve('run_1', 'req_1', 'once');
  check('approve POST /v1/runs/{id}/approval', ar.ok === true);
  const rSend = await pSend;
  const text = events.filter(e => e.type === 'delta').map(e => e.text).join('');
  const types = events.map(e => e.type).join(',');
  check('chat/stream : texte complet', rSend.ok === true && text === 'Bonjour approuvé');
  check('chat/stream : séquence start,delta,tool,approval,…,done', types === 'start,delta,tool,approval,delta,tool,done' && !events.some(e => e.type === 'error'));
  check('chat/stream body contient model + provider', lastChatBody && lastChatBody.model === 'minimax-m3' && lastChatBody.provider === 'nous' && lastChatBody.message === 'Bonjour');
  SETTINGS.provider = '';
  SETTINGS.model = 'hermes-agent';

  // --- 409 -> lecture seule ---
  events.length = 0;
  const rRo = await client.send('s-cli', 'test');
  check('409 permission_denied -> readOnly', rRo.ok === false && rRo.readOnly === true && events.some(e => e.type === 'readonly'));

  // --- repli legacy chat/completions ---
  events.length = 0;
  const rLg = await client.send('s-api', 'yo', { legacy: true });
  const lgText = events.filter(e => e.type === 'delta').map(e => e.text).join('');
  check('legacy chat/completions', rLg.ok === true && lgText === 'Salut legacy' && events.some(e => e.type === 'tool' && e.name === 'terminal') && events.some(e => e.type === 'done'));

  // --- stop ---
  events.length = 0;
  const pSlow = client.send('s-slow', 'boucle');
  await new Promise(r => setTimeout(r, 150));
  await client.stop('s-slow');
  const rSlow = await pSlow;
  check('stop -> cancelled', rSlow.cancelled === true && events.some(e => e.type === 'cancelled') && events.filter(e => e.type === 'delta').length > 0);

  server.close();
  console.log(failures === 0 ? '=== TOUT OK ===' : '=== ' + failures + ' ÉCHEC(S) ===');
  process.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => { console.log('TIMEOUT — le pilote HANG'); process.exit(2); }, 20000);
