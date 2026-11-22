'use strict';
/* Pilote Hermes — client HTTP/SSE du gateway, SANS dépendance Electron.
 * Utilisé par main.js (process main) et par tests/test-pilote-hermes.js, donc
 * le test valide exactement le code livré.
 *
 * Le gateway Hermes (hermes gateway, port 8642 par défaut) expose :
 *   GET  /v1/models, GET /v1/capabilities, GET /health
 *   GET  /api/sessions?limit=200          -> { object:'list', data:[SessionRow], has_more }
 *   POST /api/sessions                    -> 201 { session: SessionRow }   (source: 'api_server')
 *   GET  /api/sessions/{id}               -> { session: SessionRow }
 *   GET  /api/sessions/{id}/messages?limit=500&order=oldest -> { data:[MessageRow] }
 *   POST /api/sessions/{id}/chat/stream   -> SSE : run.started, assistant.delta,
 *        tool.progress|tool.started|tool.completed|tool.failed, assistant.commentary,
 *        approval.request, assistant.completed, run.completed|run.failed|run.cancelled, error, done
 *   POST /v1/chat/completions             -> SSE chat.completion.chunk (+ event: hermes.tool.progress)
 *        avec X-Hermes-Session-Id (session créée par l'API uniquement ; 409 permission_denied sinon)
 *   POST /v1/runs/{run_id}/approval       -> { choice: 'once'|'session'|'always'|'deny', request_id? }
 *   POST /v1/runs/{run_id}/stop
 *   GET  /api/jobs                        -> { jobs: [CronJob] }
 * Les anciennes surfaces "dashboard" (/api/session?session_id=…&messages=1, /api/projects,
 * champs display_title/workspace/project_id/read_only/attention) sont aussi acceptées :
 * tous les parsers sont tolérants.
 */

const crypto = require('crypto');

/* Sources que l'API server accepte en écriture (voir _normalize_session_source). */
const API_WRITABLE_SOURCES = { '': true, api_server: true, hermes_browser: true, browser: true };

function mapSessionRow(s) {
  if (!s) return null;
  const source = s.source || '';
  return {
    id: s.session_id || s.id || '',
    title: s.display_title || s.title || 'Session sans titre',
    source: source,
    workspace: s.workspace || s.cwd || '',
    projectId: s.project_id || null,
    model: s.model || '',
    messageCount: s.message_count || 0,
    updated: s.last_message_at || s.updated_at || s.last_active || s.started_at || 0,
    pinned: !!s.pinned,
    archived: !!s.archived,
    streaming: !!(s.is_streaming || s.active_stream_id),
    attention: !!s.attention,
    readOnly: !!s.read_only || !!s.is_cli_session || (!!source && !API_WRITABLE_SOURCES[source]),
    cli: !!s.is_cli_session,
    contextPct: s.window_usage_percent || 0,
    preview: s.preview || ''
  };
}

function mapMessageRow(m) {
  if (!m) return null;
  if (m.display_kind === 'hidden') return null;
  let who = m.role || m.role_type || (m.type === 'user' ? 'user' : '');
  if (who === 'tool') return null; // les résultats d'outils ne sont pas des tours de chat
  let text = m.content != null ? m.content : (m.text != null ? m.text : (m.body != null ? m.body : (typeof m.message === 'string' ? m.message : '')));
  if (Array.isArray(text)) {
    text = text.map(function (p) {
      if (typeof p === 'string') return p;
      return (p && (p.text || p.content)) || '';
    }).join('');
  }
  if (who === 'model') who = 'assistant';
  if (who !== 'user' && who !== 'assistant') who = 'assistant';
  return {
    who: who,
    text: String(text == null ? '' : text),
    at: m.created_at || m.timestamp || 0,
    toolName: m.tool_name || null,
    reasoning: m.reasoning || m.reasoning_content || ''
  };
}

function rowsOf(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function createHermesClient(opts) {
  const getSettings = opts.getSettings;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : function () {};
  const fetchImpl = opts.fetchImpl || fetch;
  const running = new Map(); // sessionId -> { ctrl, runId }

  function base() {
    const s = getSettings() || {};
    return String(s.hermesBaseUrl || 'http://127.0.0.1:8642').replace(/\/+$/, '');
  }

  function request(pathname, init) {
    const s = getSettings() || {};
    const headers = Object.assign({}, (init && init.headers) || {});
    if (init && init.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (s.hermesApiKey) headers.Authorization = 'Bearer ' + s.hermesApiKey;
    return fetchImpl(base() + pathname, Object.assign({}, init, { headers }));
  }

  async function readError(res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* body déjà consommé */ }
    return 'HTTP ' + res.status + (detail ? ' ' + detail : '');
  }

  async function status() {
    try {
      const res = await request('/v1/models', { method: 'GET' });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const models = rowsOf(data, ['data', 'models']).map(function (m) { return (m && (m.id || m)) || ''; }).filter(Boolean);
      return { ok: true, models: models };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function capabilities() {
    try {
      const res = await request('/v1/capabilities', { method: 'GET' });
      if (!res.ok) return { ok: false, error: await readError(res) };
      return { ok: true, caps: await res.json() };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* GET /api/sessions?limit=200 — forme réelle { data:[…] }, tolère { sessions:[…] } et tableau nu. */
  async function sessions() {
    try {
      const res = await request('/api/sessions?limit=200&include_children=1', { method: 'GET' });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const rows = rowsOf(data, ['data', 'sessions']);
      return { ok: true, sessions: rows.map(mapSessionRow).filter(Boolean), hasMore: !!(data && data.has_more) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* GET /api/projects n'existe que côté cloud (Photon) : 404 local -> liste vide, pas une erreur dure. */
  async function projects() {
    try {
      const res = await request('/api/projects', { method: 'GET' });
      if (res.status === 404 || res.status === 405) return { ok: true, projects: [], unsupported: true };
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const rows = rowsOf(data, ['projects', 'data']);
      return { ok: true, projects: rows.filter(Boolean).map(function (p) {
        return { id: p.project_id || p.id || '', name: p.name || 'Projet', color: p.color || null };
      }) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* Historique : endpoint natif /api/sessions/{id}/messages, repli dashboard /api/session?session_id=…. */
  async function sessionMessages(sessionId) {
    const id = encodeURIComponent(sessionId);
    try {
      const res = await request('/api/sessions/' + id + '/messages?limit=500&order=oldest', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        const rows = rowsOf(data, ['data', 'messages']);
        return { ok: true, messages: rows.map(mapMessageRow).filter(Boolean) };
      }
      if (res.status !== 404) return { ok: false, error: await readError(res) };
      // Repli ancienne surface dashboard.
      const res2 = await request('/api/session?session_id=' + id + '&messages=1', { method: 'GET' });
      if (!res2.ok) return { ok: false, error: await readError(res2) };
      const data2 = await res2.json();
      const detail = (data2 && data2.session) || data2 || {};
      const rows = rowsOf(detail.messages != null ? detail : data2, ['messages', 'data']);
      return {
        ok: true,
        messages: rows.map(mapMessageRow).filter(Boolean),
        session: mapSessionRow(detail.session || detail)
      };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function sessionDetail(sessionId) {
    try {
      const res = await request('/api/sessions/' + encodeURIComponent(sessionId), { method: 'GET' });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const s = mapSessionRow((data && data.session) || data);
      return s ? { ok: true, session: s } : { ok: false, error: 'session vide' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* GET /api/jobs -> { jobs:[…] } (cron). */
  async function jobs() {
    try {
      const res = await request('/api/jobs?include_disabled=1', { method: 'GET' });
      if (res.status === 404 || res.status === 405) return { ok: true, jobs: [], unsupported: true };
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const rows = rowsOf(data, ['jobs', 'data']);
      return { ok: true, jobs: rows.filter(Boolean).map(function (j) {
        return {
          id: j.job_id || j.id || '',
          name: j.name || j.prompt || 'Tâche planifiée',
          prompt: j.prompt || '',
          schedule: j.schedule || j.cron || '',
          nextRun: j.next_run_at || j.next_run || 0,
          enabled: j.enabled !== false && !j.paused
        };
      }) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* POST /api/sessions — crée une session vide appartenant à l'API (écrivable depuis le cockpit). */
  async function createSession(title) {
    try {
      const res = await request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: title || 'Nouvelle session', source: 'api_server' })
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const s = mapSessionRow((data && data.session) || data);
      return s && s.id ? { ok: true, session: s } : { ok: false, error: 'réponse sans session' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* POST /api/sessions/{id}/fork — branche la session (nouveau fil). */
  async function forkSession(sessionId, title) {
    try {
      const res = await request('/api/sessions/' + encodeURIComponent(sessionId) + '/fork', {
        method: 'POST',
        body: JSON.stringify({ title: title || '' })
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const s = mapSessionRow((data && data.session) || data);
      return s && s.id ? { ok: true, session: s } : { ok: false, error: 'réponse sans session' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function createProject(name) {
    try {
      const res = await request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name || 'Nouveau projet' })
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const p = (data && data.project) || data;
      return { ok: true, project: { id: p.project_id || p.id || '', name: p.name || name, color: p.color || null } };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* Lit un flux SSE et émet les événements normalisés. Gère les deux formats :
   * - chat/stream : lignes `event: <nom>` + `data: <json>`
   * - chat/completions : `data: {…chat.completion.chunk…}` et `data: [DONE]`
   * Retourne quand le flux est terminé (done) ou en erreur. */
  async function readSse(res, sessionId, emit) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let curEvent = '';
    let finished = false;
    function handleData(payloadStr) {
      if (payloadStr === '[DONE]') { if (!finished) { finished = true; emit({ session: sessionId, type: 'done' }); } return; }
      let chunk;
      try { chunk = JSON.parse(payloadStr); } catch { return; /* keep-alive, commentaire */ }
      const ev = curEvent;
      curEvent = '';
      if (ev === 'assistant.delta') {
        if (chunk.delta) emit({ session: sessionId, type: 'delta', text: String(chunk.delta) });
        return;
      }
      if (ev === 'assistant.commentary') {
        if (!chunk.already_streamed && chunk.text) emit({ session: sessionId, type: 'delta', text: String(chunk.text) });
        return;
      }
      if (ev === 'tool.progress') { // reasoning
        if (chunk.delta) emit({ session: sessionId, type: 'reasoning', text: String(chunk.delta) });
        return;
      }
      if (ev === 'tool.started' || ev === 'tool.completed' || ev === 'tool.failed') {
        emit({ session: sessionId, type: 'tool', name: chunk.tool_name || '', preview: chunk.preview || '', error: ev === 'tool.failed' || !!chunk.is_error });
        return;
      }
      if (ev === 'approval.request') {
        const r = running.get(sessionId);
        if (r && chunk.run_id) r.runId = chunk.run_id;
        emit({
          session: sessionId, type: 'approval',
          runId: chunk.run_id || (r && r.runId) || '',
          requestId: chunk.request_id || chunk.id || '',
          command: chunk.command || '',
          description: chunk.description || '',
          choices: Array.isArray(chunk.choices) ? chunk.choices : ['once', 'deny']
        });
        return;
      }
      if (ev === 'run.started') {
        const r = running.get(sessionId);
        if (r && chunk.run_id) r.runId = chunk.run_id;
        return;
      }
      if (ev === 'run.completed') { finished = true; emit({ session: sessionId, type: 'done' }); return; }
      if (ev === 'run.failed') { finished = true; emit({ session: sessionId, type: 'error', text: (chunk.error && chunk.error.message) || chunk.error || 'run échoué' }); return; }
      if (ev === 'run.cancelled') { finished = true; emit({ session: sessionId, type: 'cancelled' }); return; }
      if (ev === 'error') { finished = true; emit({ session: sessionId, type: 'error', text: String(chunk.message || 'erreur') }); return; }
      if (ev === 'done') { finished = true; emit({ session: sessionId, type: 'done' }); return; }
      // Sans nom d'événement : chunk OpenAI chat.completion.chunk (chat/completions legacy)
      if (chunk && Array.isArray(chunk.choices) && chunk.choices[0]) {
        const choice = chunk.choices[0];
        const delta = choice.delta || {};
        if (delta.content) emit({ session: sessionId, type: 'delta', text: String(delta.content) });
        if (delta.reasoning_content) emit({ session: sessionId, type: 'reasoning', text: String(delta.reasoning_content) });
        const finish = choice.finish_reason;
        if (finish === 'stop' || finish == null) return;
        finished = true;
        if (finish === 'cancelled') { emit({ session: sessionId, type: 'cancelled' }); return; }
        if (finish === 'error') { emit({ session: sessionId, type: 'error', text: (chunk.error && chunk.error.message) || 'erreur' }); return; }
        emit({ session: sessionId, type: 'notice', text: 'finish_reason : ' + finish });
        emit({ session: sessionId, type: 'done' });
        return;
      }
      // event: hermes.tool.progress (chat/completions) -> événement outil
      if (ev && ev.indexOf('hermes.') === 0 && (chunk.tool || chunk.tool_name)) {
        emit({ session: sessionId, type: 'tool', name: chunk.tool_name || chunk.tool || '', preview: chunk.preview || '', error: false });
      }
    }
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // ligne incomplète
      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '');
        if (!trimmed) continue;
        if (trimmed.startsWith(':')) continue; // keep-alive SSE
        if (trimmed.startsWith('event:')) { curEvent = trimmed.slice(6).trim(); continue; }
        if (trimmed.startsWith('data:')) handleData(trimmed.slice(5).trim());
        if (finished) break;
      }
      if (finished) { try { await reader.cancel(); } catch { /* flux déjà fini */ } break; }
    }
    if (!finished) emit({ session: sessionId, type: 'done' });
  }

  /* Envoie un tour. Transport natif : POST /api/sessions/{id}/chat/stream (événements riches,
   * approbations). Repli : /v1/chat/completions + X-Hermes-Session-Id (vieux gateway, 404/405).
   * opts.legacy force le repli (tests). */
  async function send(sessionId, content, opts) {
    const s = getSettings() || {};
    const key = crypto.randomUUID();
    const ctrl = new AbortController();
    const entry = { ctrl: ctrl, runId: '' };
    running.set(sessionId, entry);
    onEvent({ session: sessionId, type: 'start' });
    try {
      let res;
      const model = s.model || 'hermes-agent';
      const useLegacy = opts && opts.legacy;
      if (!useLegacy) {
        res = await request('/api/sessions/' + encodeURIComponent(sessionId) + '/chat/stream', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Idempotency-Key': key, Accept: 'text/event-stream' },
          body: JSON.stringify({ message: content, model: model })
        });
        if (res.status === 404 || res.status === 405) {
          res = await request('/v1/chat/completions', {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Idempotency-Key': key, Accept: 'text/event-stream', 'X-Hermes-Session-Id': sessionId },
            body: JSON.stringify({ model: model, messages: [{ role: 'user', content: content }], stream: true })
          });
        }
      } else {
        res = await request('/v1/chat/completions', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Idempotency-Key': key, Accept: 'text/event-stream', 'X-Hermes-Session-Id': sessionId },
          body: JSON.stringify({ model: model, messages: [{ role: 'user', content: content }], stream: true })
        });
      }
      if (!res.ok) {
        let code = '';
        try { const j = await res.json(); code = (j && j.error && (j.error.code || j.error.message)) || j.error || ''; } catch { /* body texte */ }
        if (res.status === 409 || /permission_denied|not.*api/i.test(String(code))) {
          onEvent({ session: sessionId, type: 'readonly', text: 'Session possédée par une autre surface : lecture seule.' });
          return { ok: false, readOnly: true, error: 'HTTP 409 ' + code };
        }
        throw new Error(await readError(res));
      }
      await readSse(res, sessionId, onEvent);
      return { ok: true };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
      if (aborted) {
        onEvent({ session: sessionId, type: 'cancelled' });
        return { ok: false, cancelled: true };
      }
      onEvent({ session: sessionId, type: 'error', text: String((err && err.message) || err) });
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      running.delete(sessionId);
    }
  }

  /* Arrêt : AbortController local + POST /v1/runs/{run_id}/stop si le run est connu. */
  async function stop(sessionId) {
    const entry = running.get(sessionId);
    if (entry) {
      if (entry.runId) {
        try { await request('/v1/runs/' + encodeURIComponent(entry.runId) + '/stop', { method: 'POST', body: '{}' }); } catch { /* arrêt local suffit */ }
      }
      entry.ctrl.abort();
    }
    return { ok: true };
  }

  /* Résout une approbation : POST /v1/runs/{run_id}/approval { choice, request_id? }. */
  async function approve(runId, requestId, choice) {
    try {
      const body = { choice: choice || 'once' };
      if (requestId) body.request_id = requestId; else body.all = true;
      const res = await request('/v1/runs/' + encodeURIComponent(runId) + '/approval', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) return { ok: false, error: await readError(res) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  return {
    status: status,
    capabilities: capabilities,
    sessions: sessions,
    projects: projects,
    sessionMessages: sessionMessages,
    sessionDetail: sessionDetail,
    jobs: jobs,
    createSession: createSession,
    createProject: createProject,
    forkSession: forkSession,
    send: send,
    stop: stop,
    approve: approve
  };
}

module.exports = { createHermesClient: createHermesClient, mapSessionRow: mapSessionRow, mapMessageRow: mapMessageRow };
