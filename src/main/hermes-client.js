'use strict';
/* Client du gateway Hermes (API server, hermes-agent).
 *
 * Endpoints suivis (doc : hermes-agent.nousresearch.com/docs/user-guide/features/api-server) :
 *   GET  /health, /health/detailed, /v1/capabilities, /v1/models, /api/model/options
 *   GET  /api/sessions                      liste paginée (limit, offset, source)
 *   POST /api/sessions                      crée une session vide
 *   GET|PATCH|DELETE /api/sessions/{id}
 *   GET  /api/sessions/{id}/messages        historique (inline_images=false)
 *   POST /api/sessions/{id}/fork
 *   POST /api/sessions/{id}/chat/stream     tour en SSE (repli)
 *   POST /v1/runs, GET /v1/runs/{id}, GET /v1/runs/{id}/events (SSE)
 *   POST /v1/runs/{id}/stop | approval | clarify | steer
 *   GET|POST /api/jobs, GET|PATCH|DELETE /api/jobs/{id}, POST /api/jobs/{id}/pause|resume|run
 *   GET  /v1/skills, /v1/toolsets
 *   POST /v1/chat/completions               dernier repli (X-Hermes-Session-Id)
 *
 * Toute la vie réseau reste dans le process main. Le module ne dépend pas
 * d'Electron : `getConfig` et `fetchImpl` sont injectés, ce qui le rend
 * testable avec un serveur HTTP local (tests/hermes-client.test.js). */

const crypto = require('crypto');
const { readSse } = require('./sse');

const API_SOURCES = /^(api|api_server|api-server|cockpit)$/i;

function toMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? v : Math.round(v * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function asList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (data && Array.isArray(data[k])) return data[k];
  return [];
}

function textOf(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (p) {
      if (typeof p === 'string') return p;
      if (!p) return '';
      if (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text') return p.text || '';
      if (p.type === 'image_url' || p.type === 'input_image' || p.type === 'image') return '[image]';
      return p.text || '';
    }).join('');
  }
  if (typeof content === 'object') return content.text || JSON.stringify(content);
  return String(content);
}

function mapSession(s) {
  const source = String(s.source || s.platform || '');
  const readOnly = s.read_only === true || s.is_cli_session === true || (!!source && !API_SOURCES.test(source));
  return {
    id: String(s.session_id || s.id || ''),
    title: s.display_title || s.title || s.preview || 'Session sans titre',
    preview: s.preview || '',
    source: source,
    workspace: s.workspace || s.cwd || s.working_directory || '',
    projectId: s.project_id || null,
    model: s.model || '',
    messageCount: s.message_count != null ? s.message_count : (s.messages_count || 0),
    started: toMs(s.started_at || s.created_at),
    updated: toMs(s.last_message_at || s.last_active_at || s.last_active || s.updated_at || s.ended_at || s.started_at || s.created_at),
    ended: toMs(s.ended_at),
    endReason: s.end_reason || '',
    pinned: !!s.pinned,
    archived: !!s.archived,
    streaming: !!(s.is_streaming || s.active_stream_id || s.status === 'running'),
    attention: !!(s.attention || s.pending_approvals || s.status === 'waiting_for_approval'),
    parentId: s.parent_session_id || null,
    readOnly: readOnly,
    cli: !!s.is_cli_session || /^(cli|tui)$/i.test(source),
    contextPct: Number(s.window_usage_percent || s.context_percent || 0),
    tokensIn: Number(s.input_tokens || 0),
    tokensOut: Number(s.output_tokens || 0)
  };
}

function mapMessage(m) {
  const role = m.role || m.role_type || (m.type === 'user' ? 'user' : 'assistant');
  const at = toMs(m.timestamp || m.created_at || m.at);
  if (role === 'user' || role === 'human') return { who: 'user', text: textOf(m.content != null ? m.content : m.text), at: at };
  if (role === 'tool' || role === 'function') {
    const out = textOf(m.content != null ? m.content : m.result);
    return { who: 'tool', name: m.tool_name || m.name || 'outil', text: out.length > 2000 ? out.slice(0, 2000) + '…' : out, at: at };
  }
  if (role === 'system') return null;
  const calls = (m.tool_calls || []).map(function (c) {
    const fn = c.function || c;
    return { name: fn.name || 'outil', args: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}) };
  });
  return {
    who: 'assistant',
    text: textOf(m.content != null ? m.content : (m.text || m.body || '')),
    reasoning: m.reasoning || m.reasoning_content || '',
    toolCalls: calls,
    model: m.model || '',
    at: at
  };
}

function mapJob(j) {
  const state = j.state || j.status || (j.paused ? 'paused' : (j.enabled === false ? 'disabled' : 'active'));
  return {
    id: String(j.job_id || j.id || ''),
    name: j.name || j.title || (j.prompt ? String(j.prompt).slice(0, 60) : 'Tâche'),
    prompt: j.prompt || '',
    schedule: j.schedule || j.cron || j.every || '',
    state: String(state),
    paused: state === 'paused' || j.paused === true,
    nextRun: toMs(j.next_run_at || j.next_run),
    lastRun: toMs(j.last_run_at || j.last_run),
    lastStatus: j.last_status || j.last_result || '',
    skills: j.skills || [],
    deliver: j.deliver || j.delivery || '',
    profile: j.profile || ''
  };
}

/* Normalise un événement SSE Hermes (runs ou chat/stream) vers le format du renderer. */
function mapRunEvent(name, j) {
  const ev = name && name !== 'message' ? name : (j.event || j.type || '');
  switch (ev) {
    case 'message.delta':
    case 'assistant.delta':
      return { type: 'delta', text: j.delta != null ? textOf(j.delta) : textOf(j.text != null ? j.text : j.content) };
    case 'reasoning.delta':
    case 'message.reasoning':
    case 'assistant.reasoning':
      return { type: 'reasoning', text: textOf(j.delta != null ? j.delta : j.text) };
    case 'message.interim':
    case 'assistant.commentary':
      return j.already_streamed ? null : { type: 'interim', text: textOf(j.text) };
    case 'tool.started':
      return { type: 'tool', phase: 'started', tool: j.tool || j.name || 'outil', preview: j.preview || '', id: j.tool_call_id || j.id || '' };
    case 'tool.completed':
    case 'tool.failed':
      return { type: 'tool', phase: 'completed', tool: j.tool || j.name || 'outil', duration: Number(j.duration || 0), error: ev === 'tool.failed' || !!j.error, preview: j.preview || '', id: j.tool_call_id || j.id || '' };
    case 'subagent.start':
    case 'subagent.complete':
      return { type: 'subagent', phase: ev === 'subagent.start' ? 'start' : 'complete', name: j.name || j.goal || j.task || 'sous-agent',
        status: j.status || '', summary: j.summary || '', duration: Number(j.duration || 0), childSessionId: j.child_session_id || '', delegationId: j.delegation_id || '' };
    case 'approval.request':
      return { type: 'approval', requestId: j.request_id || j.prompt_id || j.id || '', generation: j.execution_generation,
        command: j.command || j.preview || '', description: j.description || j.reason || j.title || '', choices: j.choices || ['once', 'session', 'always', 'deny'] };
    case 'clarify.request':
      return { type: 'clarify', requestId: j.request_id || j.prompt_id || j.id || '', generation: j.execution_generation, question: j.question || j.prompt || '', choices: j.choices || [] };
    case 'run.steered':
      return { type: 'notice', text: 'Consigne transmise à la prochaine étape de l’agent.' };
    case 'assistant.completed':
      return null; // le terminal run.* suit
    case 'run.completed':
      return { type: 'done', output: textOf(j.output), usage: j.usage || null, pendingSteer: j.pending_steer || '' };
    case 'run.failed':
      return { type: 'error', text: j.error || j.turn_exit_reason || 'Le tour a échoué.', output: textOf(j.output), pendingSteer: j.pending_steer || '' };
    case 'run.cancelled':
    case 'run.interrupted':
      return { type: 'cancelled', text: j.error || j.turn_exit_reason || '', pendingSteer: j.pending_steer || '' };
    default:
      return null;
  }
}

function createHermesClient(opts) {
  const getConfig = opts.getConfig;
  const fetchImpl = opts.fetchImpl || fetch;
  let capsCache = null;

  function base() {
    const c = getConfig();
    let url = String(c.baseUrl || 'http://127.0.0.1:8642').replace(/\/+$/, '');
    if (c.profile) url += '/p/' + encodeURIComponent(c.profile);
    return url;
  }

  function headers(extra) {
    const c = getConfig();
    const h = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, extra || {});
    if (c.apiKey) h.Authorization = 'Bearer ' + c.apiKey;
    return h;
  }

  async function request(method, pathname, body, init) {
    const res = await fetchImpl(base() + pathname, Object.assign({
      method: method,
      headers: headers(init && init.headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    }, init && init.signal ? { signal: init.signal } : {}));
    return res;
  }

  async function json(method, pathname, body) {
    try {
      const res = await request(method, pathname, body);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const msg = data && data.error ? (data.error.message || data.error.code || data.error) : ('HTTP ' + res.status);
        return { ok: false, status: res.status, error: String(msg), code: data && data.error && data.error.code };
      }
      return { ok: true, status: res.status, data: data };
    } catch (err) {
      return { ok: false, status: 0, error: String(err && err.message || err) };
    }
  }

  async function capabilities(force) {
    if (capsCache && !force) return capsCache;
    const r = await json('GET', '/v1/capabilities');
    capsCache = r.ok && r.data ? r.data : { features: {} };
    return capsCache;
  }

  async function status() {
    const models = await json('GET', '/v1/models');
    if (!models.ok) return { ok: false, error: models.error, status: models.status };
    const caps = await capabilities(true);
    const health = await json('GET', '/health/detailed');
    return {
      ok: true,
      models: asList(models.data, ['data']).map(function (m) { return m.id; }),
      capabilities: caps,
      health: health.ok ? health.data : null
    };
  }

  async function sessions(params) {
    const p = Object.assign({ limit: 200 }, params || {});
    const qs = Object.keys(p).filter(function (k) { return p[k] != null && p[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
    const r = await json('GET', '/api/sessions' + (qs ? '?' + qs : ''));
    if (!r.ok) return r;
    return { ok: true, sessions: asList(r.data, ['sessions', 'data', 'items']).filter(Boolean).map(mapSession).filter(function (s) { return s.id; }) };
  }

  async function projects() {
    const r = await json('GET', '/api/projects');
    if (!r.ok) return Object.assign(r, { projects: [] });
    return { ok: true, projects: asList(r.data, ['projects', 'data']).filter(Boolean).map(function (p) {
      return { id: String(p.project_id || p.id || ''), name: p.name || 'Projet', path: p.path || p.root || '', color: p.color || null };
    }) };
  }

  async function messages(sessionId) {
    const id = encodeURIComponent(sessionId);
    let r = await json('GET', '/api/sessions/' + id + '/messages?inline_images=false');
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      // gateways antérieurs : /api/session?session_id=…&messages=1
      r = await json('GET', '/api/session?session_id=' + id + '&messages=1');
    }
    if (!r.ok) return r;
    const d = r.data || {};
    const detail = d.session || d;
    const raw = asList(d, ['messages', 'data', 'items']).length ? asList(d, ['messages', 'data', 'items']) : asList(detail, ['messages']);
    return { ok: true, messages: raw.filter(Boolean).map(mapMessage).filter(Boolean),
      session: detail && detail.session_id ? mapSession(detail) : null };
  }

  async function session(sessionId) {
    const r = await json('GET', '/api/sessions/' + encodeURIComponent(sessionId));
    if (!r.ok) return r;
    return { ok: true, session: mapSession((r.data && r.data.session) || r.data || {}) };
  }

  async function createSession(body) {
    const r = await json('POST', '/api/sessions', body || {});
    if (!r.ok) return r;
    const d = (r.data && r.data.session) || r.data || {};
    return { ok: true, session: mapSession(Object.assign({ source: 'api_server' }, d)) };
  }

  const renameSession = (id, title) => json('PATCH', '/api/sessions/' + encodeURIComponent(id), { title: title });
  const deleteSession = (id) => json('DELETE', '/api/sessions/' + encodeURIComponent(id));
  async function forkSession(id, title) {
    const r = await json('POST', '/api/sessions/' + encodeURIComponent(id) + '/fork', title ? { title: title } : {});
    if (!r.ok) return r;
    const d = (r.data && r.data.session) || r.data || {};
    return { ok: true, session: mapSession(Object.assign({ source: 'api_server' }, d)) };
  }

  /* -------- Tour de conversation : runs > chat/stream > chat/completions -------- */

  async function runTurn(args) {
    const caps = await capabilities();
    const f = (caps && caps.features) || {};
    const useRuns = f.run_submission !== false && f.run_events_sse !== false && args.transport !== 'completions';
    if (useRuns) {
      const r = await runViaRuns(args);
      if (r && r.fallback !== true) return r;
    }
    if (f.session_chat_stream || (caps.endpoints && caps.endpoints.session_chat_stream)) {
      const r = await runViaSessionStream(args);
      if (r && r.fallback !== true) return r;
    }
    return runViaCompletions(args);
  }

  async function runViaRuns(args) {
    const onEvent = args.onEvent;
    const body = { input: args.input, session_id: args.sessionId };
    if (args.model) body.model = args.model;
    if (args.provider) body.provider = args.provider;
    let res;
    try {
      res = await request('POST', '/v1/runs', body, { headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: args.signal });
    } catch (err) {
      return failure(onEvent, err);
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) return { fallback: true };
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* corps non JSON */ }
    if (!res.ok) return httpFailure(onEvent, res.status, data, text);
    const runId = data && (data.run_id || data.id);
    if (!runId) return { fallback: true };
    onEvent({ type: 'run', runId: runId });

    let terminal = false;
    let gotText = false;
    try {
      const evRes = await request('GET', '/v1/runs/' + encodeURIComponent(runId) + '/events', undefined,
        { headers: { Accept: 'text/event-stream' }, signal: args.signal });
      if (!evRes.ok) throw new Error('HTTP ' + evRes.status + ' sur le flux du run');
      await readSse(evRes, function (msg) {
        let j = {};
        try { j = JSON.parse(msg.data); } catch { return; }
        const ev = mapRunEvent(msg.event, j);
        if (!ev) return;
        if (ev.type === 'delta' && ev.text) gotText = true;
        if (ev.type === 'done' || ev.type === 'error' || ev.type === 'cancelled') {
          terminal = true;
          if (ev.output && !gotText) onEvent({ type: 'delta', text: ev.output });
        }
        onEvent(ev);
      }, args.signal);
    } catch (err) {
      if (isAbort(err)) { onEvent({ type: 'cancelled' }); return { ok: false, cancelled: true, runId: runId }; }
      // flux coupé : on interroge l'état du run plutôt que de conclure à l'échec
    }
    if (!terminal) {
      const st = await json('GET', '/v1/runs/' + encodeURIComponent(runId));
      const s = st.ok && st.data ? st.data.status : '';
      if (s === 'completed') {
        if (!gotText && st.data.output) onEvent({ type: 'delta', text: textOf(st.data.output) });
        onEvent({ type: 'done', usage: st.data.usage || null });
      } else if (s === 'cancelled' || s === 'interrupted') onEvent({ type: 'cancelled' });
      else if (s === 'failed') onEvent({ type: 'error', text: st.data.error || 'Le tour a échoué.' });
      else onEvent({ type: 'detached', runId: runId, status: s || 'unknown' });
    }
    return { ok: true, runId: runId };
  }

  async function runViaSessionStream(args) {
    const onEvent = args.onEvent;
    const body = { input: args.input };
    if (args.model) body.model = args.model;
    if (args.provider) body.provider = args.provider;
    let res;
    try {
      res = await request('POST', '/api/sessions/' + encodeURIComponent(args.sessionId) + '/chat/stream', body,
        { headers: { Accept: 'text/event-stream' }, signal: args.signal });
    } catch (err) { return failure(onEvent, err); }
    if (res.status === 404 || res.status === 405) return { fallback: true };
    if (!res.ok) { const t = await res.text(); let d = null; try { d = JSON.parse(t); } catch { /* */ } return httpFailure(onEvent, res.status, d, t); }
    let terminal = false;
    try {
      await readSse(res, function (msg) {
        let j = {};
        try { j = JSON.parse(msg.data); } catch { return; }
        const ev = mapRunEvent(msg.event, j);
        if (!ev) return;
        if (ev.type === 'done' || ev.type === 'error' || ev.type === 'cancelled') terminal = true;
        onEvent(ev);
      }, args.signal);
    } catch (err) {
      if (isAbort(err)) { onEvent({ type: 'cancelled' }); return { ok: false, cancelled: true }; }
      return failure(onEvent, err);
    }
    if (!terminal) onEvent({ type: 'done' });
    return { ok: true };
  }

  async function runViaCompletions(args) {
    const onEvent = args.onEvent;
    const c = getConfig();
    let res;
    try {
      // Sans « provider », un « model » nu est ignoré par /v1/chat/completions (doc API server).
      const completion = { model: args.model || c.model || 'hermes-agent', messages: [{ role: 'user', content: args.input }], stream: true };
      if (args.provider || c.provider) completion.provider = args.provider || c.provider;
      res = await request('POST', '/v1/chat/completions', completion, { headers: { 'X-Hermes-Session-Id': args.sessionId, 'Idempotency-Key': crypto.randomUUID(), Accept: 'text/event-stream' }, signal: args.signal });
    } catch (err) { return failure(onEvent, err); }
    if (!res.ok) { const t = await res.text(); let d = null; try { d = JSON.parse(t); } catch { /* */ } return httpFailure(onEvent, res.status, d, t); }
    let done = false;
    try {
      await readSse(res, function (msg) {
        if (msg.data === '[DONE]') { if (!done) { done = true; onEvent({ type: 'done' }); } return; }
        let j = {};
        try { j = JSON.parse(msg.data); } catch { return; }
        if (msg.event === 'hermes.tool.progress') {
          onEvent({ type: 'tool', phase: 'started', tool: j.tool || 'outil', preview: j.preview || '' });
          return;
        }
        const choice = j.choices && j.choices[0];
        const d = choice && choice.delta;
        if (d && d.reasoning_content) onEvent({ type: 'reasoning', text: d.reasoning_content });
        if (d && d.content) onEvent({ type: 'delta', text: d.content });
        if (choice && choice.finish_reason && choice.finish_reason !== 'stop') {
          onEvent({ type: 'notice', text: 'Fin du tour : ' + choice.finish_reason });
        }
      }, args.signal);
    } catch (err) {
      if (isAbort(err)) { onEvent({ type: 'cancelled' }); return { ok: false, cancelled: true }; }
      return failure(onEvent, err);
    }
    if (!done) onEvent({ type: 'done' });
    return { ok: true };
  }

  function isAbort(err) {
    return err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
  }
  function failure(onEvent, err) {
    if (isAbort(err)) { onEvent({ type: 'cancelled' }); return { ok: false, cancelled: true }; }
    const text = String(err && err.message || err);
    onEvent({ type: 'error', text: text });
    return { ok: false, error: text };
  }
  function httpFailure(onEvent, status, data, raw) {
    const code = data && data.error && data.error.code;
    let text = data && data.error ? (data.error.message || code || String(data.error)) : ('HTTP ' + status + ' ' + String(raw || '').slice(0, 300));
    if (status === 409 && (code === 'permission_denied' || /permission/i.test(text))) {
      onEvent({ type: 'error', code: 'read_only', text: 'Session tenue par une autre surface Hermes (CLI, TUI, Desktop, messagerie) : lecture seule depuis le cockpit.' });
      return { ok: false, readOnly: true };
    }
    if (status === 429) text = 'Trop de tours simultanés sur le gateway, réessayez dans un instant.';
    if (status === 401 || status === 403) text = 'Clé API refusée par le gateway (API_SERVER_KEY).';
    onEvent({ type: 'error', code: code || ('http_' + status), text: text });
    return { ok: false, error: text, status: status };
  }

  /* -------- Contrôles de run -------- */
  const run = (id) => json('GET', '/v1/runs/' + encodeURIComponent(id));
  const stop = (id) => json('POST', '/v1/runs/' + encodeURIComponent(id) + '/stop', {});
  const steer = (id, text) => json('POST', '/v1/runs/' + encodeURIComponent(id) + '/steer', { text: text });
  const approve = (id, a) => json('POST', '/v1/runs/' + encodeURIComponent(id) + '/approval',
    { request_id: a.requestId, execution_generation: a.generation, choice: a.choice });
  const clarify = (id, a) => json('POST', '/v1/runs/' + encodeURIComponent(id) + '/clarify',
    { request_id: a.requestId, execution_generation: a.generation, answer: a.answer });

  /* -------- Tâches planifiées -------- */
  async function jobs() {
    const r = await json('GET', '/api/jobs');
    if (!r.ok) return Object.assign(r, { jobs: [] });
    return { ok: true, jobs: asList(r.data, ['jobs', 'data', 'items']).filter(Boolean).map(mapJob) };
  }
  const createJob = (body) => json('POST', '/api/jobs', body);
  const updateJob = (id, body) => json('PATCH', '/api/jobs/' + encodeURIComponent(id), body);
  const deleteJob = (id) => json('DELETE', '/api/jobs/' + encodeURIComponent(id));
  const jobAction = (id, action) => {
    if (!/^(pause|resume|run)$/.test(action)) return Promise.resolve({ ok: false, error: 'action inconnue' });
    return json('POST', '/api/jobs/' + encodeURIComponent(id) + '/' + action, {});
  };

  /* -------- Capacités et modèles -------- */
  async function skills() {
    const r = await json('GET', '/v1/skills');
    if (!r.ok) return Object.assign(r, { skills: [] });
    return { ok: true, skills: asList(r.data, ['skills', 'data']).map(function (s) {
      return { name: s.name || '', description: s.description || '', category: s.category || 'Général' };
    }) };
  }
  async function toolsets() {
    const r = await json('GET', '/v1/toolsets');
    if (!r.ok) return Object.assign(r, { toolsets: [] });
    return { ok: true, toolsets: asList(r.data, ['toolsets', 'data']).map(function (t) {
      return { name: t.name || '', label: t.label || t.name || '', description: t.description || '', enabled: t.enabled !== false, configured: t.configured !== false, tools: t.tools || [] };
    }) };
  }
  async function modelOptions() {
    const r = await json('GET', '/api/model/options');
    if (!r.ok) return Object.assign(r, { models: [] });
    const d = r.data || {};
    const models = [];
    asList(d, ['providers', 'data']).forEach(function (p) {
      const slug = p.slug || p.id || p.provider || p.name || '';
      asList(p, ['models']).forEach(function (m) {
        const id = typeof m === 'string' ? m : (m.id || m.name);
        if (id) models.push({ id: id, provider: slug, providerName: p.name || slug, label: (typeof m === 'object' && (m.label || m.display_name)) || id });
      });
    });
    const cur = d.current || d.selected || {};
    return { ok: true, models: models, current: { provider: d.current_provider || cur.provider || '', model: d.current_model || cur.model || '' } };
  }

  /* Verrou du modèle sur une session (équivalent de « /model » dans la session).
   * Route non documentée dans la doc API server : un 404 / 405 est renvoyé tel quel. */
  const setSessionModel = (id, model, provider) => json('POST', '/api/sessions/' + encodeURIComponent(id) + '/model',
    Object.assign({ model: model }, provider ? { provider: provider } : {}));

  return {
    capabilities, status, sessions, projects, messages, session, createSession, renameSession,
    deleteSession, forkSession, runTurn, run, stop, steer, approve, clarify,
    jobs, createJob, updateJob, deleteJob, jobAction, skills, toolsets, modelOptions, setSessionModel,
    resetCapabilities() { capsCache = null; }
  };
}

module.exports = { createHermesClient, mapSession, mapMessage, mapJob, mapRunEvent, textOf, toMs };
