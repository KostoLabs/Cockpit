/* Test final : serveur SSE connu-fonctionnel (pattern variant.js) + client qui
 * réplique EXACTEMENT le pilote Hermes du cockpit (headers, signal, parser). */
const http = require('http');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer test-key') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': keepalive\n\n');
      res.write('event: hermes.tool.progress\ndata: {"tool":"terminal","preview":"ls -la"}\n\n');
      const words = ['Bonjour', ' depuis', ' Hermes', '.', ' Tout', ' fonctionne', '.'];
      let i = 0;
      const tick = setInterval(() => {
        if (i < words.length) {
          res.write('data: ' + JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: words[i] }, finish_reason: null }] }) + '\n\n');
          i++;
        } else {
          clearInterval(tick);
          res.end('data: ' + JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
        }
      }, 20);
    });
    return;
  }
  if (req.url.split('?')[0] === '/api/sessions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ sessions: [
      { session_id: 's-cli', title: 'TUI session', display_title: 'Retrouver secrets PREP', workspace: '/Users/q/homedir', project_id: 'proj-1',
        model: 'hermes-agent', message_count: 12, last_message_at: 1731470000, pinned: true,
        is_streaming: false, active_stream_id: null, attention: true, read_only: true, is_cli_session: true, window_usage_percent: 41 },
      { session_id: 's-api', display_title: 'Recette preprod', workspace: '/Users/q/dev/koordo', project_id: 'proj-2',
        model: 'hermes-agent', message_count: 3, updated_at: 1731470600,
        is_streaming: true, active_stream_id: 'st-9', read_only: false, window_usage_percent: 7 },
      { session_id: 's-loose', title: 'Sans projet', workspace: '/Users/q/dev/genres', message_count: 1, updated_at: 1731460000 }
    ] }));
  }
  if (req.url.split('?')[0] === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ projects: [
      { project_id: 'proj-1', name: 'homedir', color: '#7C5CFF' },
      { project_id: 'proj-2', name: 'koordo', color: null }
    ] }));
  }
  if (req.url.split('?')[0] === '/api/session' && req.method === 'GET') {
    const sid = decodeURIComponent((req.url.split('session_id=')[1] || '').split('&')[0]);
    if (sid !== 's-api') { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ session: { session_id: sid, display_title: 'Recette preprod',
      workspace: '/Users/q/dev/koordo', model: 'hermes-agent', is_streaming: true, read_only: false,
      messages: [
        { role: 'user', content: 'Lance la recette' },
        { role: 'assistant', content: '12 tests, 2 échecs en correction.' }
      ] } }));
  }
  res.writeHead(404); res.end('{}');
});

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const SETTINGS = { hermesBaseUrl: base, hermesApiKey: 'test-key', model: 'hermes-agent' };
  const events = [];

  function hermesFetch(pathname, init) {
    const s = SETTINGS;
    const url = s.hermesBaseUrl.replace(/\/+$/, '') + pathname;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    if (s.hermesApiKey) headers.Authorization = 'Bearer ' + s.hermesApiKey;
    return fetch(url, Object.assign({}, init, { headers }));
  }

  async function hermesSend(sessionId, content) {
    const s = SETTINGS;
    const key = crypto.randomUUID();
    const ctrl = new AbortController();
    events.push({ type: 'start' });
    const res = await hermesFetch('/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'X-Hermes-Session-Id': sessionId, 'Idempotency-Key': key },
      body: JSON.stringify({ model: s.model || 'hermes-agent', messages: [{ role: 'user', content }], stream: true })
    });
    if (!res.ok) { const b = await res.text(); throw new Error('HTTP ' + res.status + ' ' + b.slice(0, 200)); }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.slice(5).trim();
        if (payloadStr === '[DONE]') { events.push({ type: 'done' }); return; }
        try {
          const chunk = JSON.parse(payloadStr);
          const choice = chunk.choices && chunk.choices[0];
          const delta = choice && choice.delta && choice.delta.content;
          if (delta) events.push({ type: 'delta', text: delta });
          const finish = choice && choice.finish_reason;
          if (finish && finish !== 'stop') events.push({ type: 'notice', text: 'finish_reason : ' + finish });
        } catch { /* commentaire SSE, keepalive */ }
      }
    }
    events.push({ type: 'done' });
  }


  /* === Synchro : mappings répliqués de main.js (lectures tolérantes) === */
  async function hermesSessions() {
    try {
      const res = await hermesFetch('/api/sessions', { method: 'GET' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data && data.sessions) || [];
      const sessions = rows.filter(Boolean).map(function (s) {
        return {
          id: s.session_id || s.id || '',
          title: s.display_title || s.title || 'Session sans titre',
          workspace: s.workspace || '',
          projectId: s.project_id || null,
          model: s.model || '',
          messageCount: s.message_count || 0,
          updated: s.last_message_at || s.updated_at || 0,
          pinned: !!s.pinned,
          streaming: !!(s.is_streaming || s.active_stream_id),
          attention: !!s.attention,
          readOnly: !!s.read_only,
          cli: !!s.is_cli_session,
          contextPct: s.window_usage_percent || 0
        };
      });
      return { ok: true, sessions: sessions };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  async function hermesProjects() {
    try {
      const res = await hermesFetch('/api/projects', { method: 'GET' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data && data.projects) || [];
      return { ok: true, projects: rows.filter(Boolean).map(function (p) {
        return { id: p.project_id || p.id || '', name: p.name || 'Projet', color: p.color || null };
      }) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  async function hermesSessionMessages(sessionId) {
    try {
      const res = await hermesFetch('/api/session?session_id=' + encodeURIComponent(sessionId) + '&messages=1', { method: 'GET' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      const detail = (data && data.session) || data || {};
      const raw = detail.messages || data.messages || [];
      const messages = raw.filter(Boolean).map(function (m) {
        var who = m.role || m.role_type || (m.type === 'user' ? 'user' : 'assistant');
        var text = m.content || m.text || m.body || (typeof m.message === 'string' ? m.message : '') || '';
        if (who === 'model') who = 'assistant';
        if (who !== 'user' && who !== 'assistant') who = 'assistant';
        return { who: who, text: String(text), at: m.created_at || m.timestamp || 0 };
      });
      return { ok: true, messages: messages };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  console.log('synchro sessions…');
  const rs = await hermesSessions();
  const rp = await hermesProjects();
  const rm = await hermesSessionMessages('s-api');
  const rn = await hermesSessionMessages('s-inconnue');
  console.log('sessions =', JSON.stringify(rs.sessions));
  console.log('projects =', JSON.stringify(rp.projects));
  console.log('messages =', JSON.stringify(rm.messages));
  console.log('404 toléré =', JSON.stringify(rn));
  const okSync = rs.ok && rs.sessions.length === 3
    && rs.sessions[0].id === 's-cli' && rs.sessions[0].readOnly === true && rs.sessions[0].attention === true
    && rs.sessions[1].title === 'Recette preprod' && rs.sessions[1].streaming === true && rs.sessions[1].updated === 1731470600
    && rs.sessions[2].title === 'Sans projet' && rs.sessions[2].projectId === null
    && rp.ok && rp.projects.length === 2 && rp.projects[0].name === 'homedir'
    && rm.ok && rm.messages.length === 2 && rm.messages[0].who === 'user' && rm.messages[1].text.indexOf('échecs') !== -1
    && rn.ok === false;
  console.log(okSync ? '=== SYNCHRO OK ===' : '=== SYNCHRO ÉCHOUÉE ===');
  if (!okSync) { server.close(); process.exit(3); }

  console.log('envoi…');
  await hermesSend('cockpit-test', 'Bonjour');
  const texte = events.filter(e => e.type === 'delta').map(e => e.text).join('');
  const types = events.map(e => e.type).join(',');
  console.log('texte =', JSON.stringify(texte));
  console.log('types =', types);
  const ok = okSync && texte === 'Bonjour depuis Hermes. Tout fonctionne.'
    && types === 'start,delta,delta,delta,delta,delta,delta,delta,done'
    && !events.some(e => e.type === 'notice' || e.type === 'error');
  console.log(ok ? '=== PILOTE OK ===' : '=== PILOTE ÉCHOUÉ ===');
  server.close();
  process.exit(ok ? 0 : 1);
});
setTimeout(() => { console.log('TIMEOUT — le pilote HANG'); process.exit(2); }, 15000);
