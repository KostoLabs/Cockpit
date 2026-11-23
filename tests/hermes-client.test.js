'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeGateway } = require('./fake-gateway');
const { createHermesClient, mapSession, mapRunEvent } = require('../src/main/hermes-client');
const { createSseParser } = require('../src/main/sse');

async function setup(features, key) {
  const gw = createFakeGateway({ features: features, key: key === undefined ? 'test-key' : key });
  const port = await gw.listen(0);
  const cfg = { baseUrl: 'http://127.0.0.1:' + port + '/', apiKey: key === undefined ? 'test-key' : key, model: '' };
  const client = createHermesClient({ getConfig: () => cfg });
  return { gw, client, cfg };
}

function collect() {
  const events = [];
  return { events, onEvent: (e) => events.push(e) };
}

test('parseur SSE : keepalive, événements nommés, CRLF, data multiligne', () => {
  const out = [];
  const p = createSseParser((m) => out.push(m));
  p.push(': keepalive\r\n\r\nevent: tool.started\r\ndata: {"tool":"x"}\r\n\r\ndata: a\ndata: b\n');
  p.push('\n');
  p.end();
  assert.deepEqual(out, [{ event: 'tool.started', data: '{"tool":"x"}' }, { event: 'message', data: 'a\nb' }]);
});

test('statut : modèles, capacités, santé', async () => {
  const { gw, client } = await setup();
  const st = await client.status();
  assert.equal(st.ok, true);
  assert.deepEqual(st.models, ['hermes-agent']);
  assert.equal(st.capabilities.features.run_submission, true);
  await gw.close();
});

test('clé refusée : erreur lisible', async () => {
  const { gw, client, cfg } = await setup();
  cfg.apiKey = 'mauvaise';
  const st = await client.status();
  assert.equal(st.ok, false);
  assert.equal(st.status, 401);
  await gw.close();
});

test('sessions : mapping et lecture seule des surfaces étrangères', async () => {
  const { gw, client } = await setup();
  const r = await client.sessions();
  assert.equal(r.ok, true);
  const cli = r.sessions.find((s) => s.id === 'koordo-orga');
  const api = r.sessions.find((s) => s.id === 'koordo-recette');
  assert.equal(cli.readOnly, true);
  assert.equal(cli.cli, true);
  assert.equal(api.readOnly, false);
  assert.equal(api.streaming, true);
  assert.equal(api.workspace, '/Users/q/Developer/koordo');
  assert.ok(api.updated > 1e12, 'horodatage converti en ms');
  await gw.close();
});

test('historique : /api/sessions/{id}/messages, appels d’outils', async () => {
  const { gw, client } = await setup();
  const r = await client.messages('koordo-recette');
  assert.equal(r.ok, true);
  assert.equal(r.messages[0].who, 'user');
  assert.equal(r.messages[1].toolCalls[0].name, 'terminal');
  assert.ok(gw.log.includes('GET /api/sessions/koordo-recette/messages'));
  await gw.close();
});

test('tour via /v1/runs : outils, deltas, fin', async () => {
  const { gw, client } = await setup();
  const created = await client.createSession({ title: 'Test' });
  assert.equal(created.ok, true);
  assert.equal(created.session.readOnly, false);
  const c = collect();
  const r = await client.runTurn({ sessionId: created.session.id, input: 'Bonjour', onEvent: c.onEvent });
  assert.equal(r.ok, true);
  const types = c.events.map((e) => e.type);
  assert.equal(types[0], 'run');
  assert.ok(types.includes('tool'));
  assert.equal(c.events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Bien reçu. Tout fonctionne.');
  assert.equal(types[types.length - 1], 'done');
  await gw.close();
});

test('approbation : approval.request puis POST /v1/runs/{id}/approval', async () => {
  const { gw, client } = await setup();
  const s = (await client.createSession({})).session;
  const c = collect();
  const p = client.runTurn({ sessionId: s.id, input: 'approuve la clé', onEvent: (e) => {
    c.onEvent(e);
    if (e.type === 'approval') {
      const runId = c.events.find((x) => x.type === 'run').runId;
      client.approve(runId, { requestId: e.requestId, generation: e.generation, choice: 'once' });
    }
  } });
  await p;
  const appr = c.events.find((e) => e.type === 'approval');
  assert.equal(appr.command, 'ssh-add ~/.ssh/id_remote');
  assert.equal(c.events[c.events.length - 1].type, 'done');
  assert.ok(c.events.some((e) => e.type === 'tool' && e.tool === 'terminal' && !e.error));
  await gw.close();
});

test('sous-agents : subagent.start / complete', async () => {
  const { gw, client } = await setup();
  const s = (await client.createSession({})).session;
  const c = collect();
  await client.runTurn({ sessionId: s.id, input: 'délègue la veille', onEvent: c.onEvent });
  const sub = c.events.filter((e) => e.type === 'subagent');
  assert.deepEqual(sub.map((e) => e.phase), ['start', 'complete']);
  assert.equal(sub[1].summary, '3 décisions pertinentes');
  await gw.close();
});

test('arrêt coopératif : POST /v1/runs/{id}/stop → cancelled', async () => {
  const gw = createFakeGateway({ key: '', tick: 40 });
  const port = await gw.listen(0);
  const client = createHermesClient({ getConfig: () => ({ baseUrl: 'http://127.0.0.1:' + port }) });
  const s = (await client.createSession({})).session;
  const c = collect();
  await client.runTurn({ sessionId: s.id, input: 'long', onEvent: (e) => {
    c.onEvent(e);
    if (e.type === 'delta' && c.events.filter((x) => x.type === 'delta').length === 1) client.stop(c.events[0].runId);
  } });
  assert.equal(c.events[c.events.length - 1].type, 'cancelled');
  await gw.close();
});

test('session d’une autre surface : 409 permission_denied → lecture seule', async () => {
  const { gw, client } = await setup();
  const c = collect();
  const r = await client.runTurn({ sessionId: 'koordo-orga', input: 'Salut', onEvent: c.onEvent });
  assert.equal(r.readOnly, true);
  assert.equal(c.events[0].code, 'read_only');
  await gw.close();
});

test('repli : sans runs → /api/sessions/{id}/chat/stream', async () => {
  const { gw, client } = await setup({ run_submission: false });
  const c = collect();
  await client.runTurn({ sessionId: 'koordo-recette', input: 'Salut', onEvent: c.onEvent });
  assert.equal(c.events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Par flux de session.');
  assert.equal(c.events[c.events.length - 1].type, 'done');
  await gw.close();
});

test('tâches planifiées : liste, pause, reprise', async () => {
  const { gw, client } = await setup();
  const r = await client.jobs();
  assert.equal(r.jobs.length, 2);
  assert.equal(r.jobs[0].name, 'Veille réglementaire');
  await client.jobAction('j1', 'pause');
  assert.equal((await client.jobs()).jobs[0].paused, true);
  const bad = await client.jobAction('j1', 'rm -rf');
  assert.equal(bad.ok, false);
  await gw.close();
});

test('capacités et modèles', async () => {
  const { gw, client } = await setup();
  assert.equal((await client.skills()).skills[0].name, 'github-pr-workflow');
  assert.deepEqual((await client.toolsets()).toolsets[0].tools, ['read_file', 'write_file', 'terminal']);
  const mo = await client.modelOptions();
  assert.ok(mo.models.some((m) => m.id === 'anthropic/claude-sonnet-5.5'));
  await gw.close();
});

test('mappings tolérants', () => {
  assert.equal(mapSession({ id: 'x', source: 'discord' }).readOnly, true);
  assert.equal(mapSession({ id: 'x' }).readOnly, false);
  assert.deepEqual(mapRunEvent('message', { event: 'message.delta', delta: 'a' }), { type: 'delta', text: 'a' });
  assert.equal(mapRunEvent('message.interim', { text: 'x', already_streamed: true }), null);
  assert.equal(mapRunEvent('run.failed', { turn_exit_reason: 'max_iterations_reached(60/60)' }).text, 'max_iterations_reached(60/60)');
});
