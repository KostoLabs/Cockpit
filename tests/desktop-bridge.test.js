'use strict';
/* Pont vers les sessions Hermes Desktop : attach, ticket à usage unique, session.resume,
 * prompt.submit, traduction des événements, approbation, interruption, tours externes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSharedGateway, tmpDir } = require('./fake-shared-gateway');
const { createDesktopBridge } = require('../src/main/desktop-bridge');

async function setup() {
  const gw = createFakeSharedGateway({ tick: 15 });
  await gw.listen();
  const bin = gw.makeHermesBin(tmpDir());
  const passive = [];
  const bridge = createDesktopBridge({
    getSettings: () => ({ hermesBin: bin }),
    onEvent: (ev) => passive.push(ev),
    // le faux binaire écrit son ticket dans un fichier : on le synchronise avant la connexion
    execFileImpl: (file, args, opts, cb) => require('child_process').execFile(file, args, opts, (e, so, se) => { gw.syncTickets(); cb(e, so, se); })
  });
  return { gw, bridge, passive };
}

test('tour dans une session Desktop : texte, outils, fin', async () => {
  const { gw, bridge } = await setup();
  const evs = [];
  const r = await bridge.runTurn({ sessionId: 'desk-1', input: 'Résume mes notes', model: 'hermes-4-405b', provider: 'nous', onEvent: (e) => evs.push(e) });
  assert.equal(r.ok, true);
  assert.deepEqual(gw.log.slice(0, 4), ['runtime.describe', 'client.capabilities', 'client.capabilities', 'session.resume']);
  const sub = gw.lastSubmit();
  assert.equal(sub.session_id, 'desk-1');
  assert.ok(sub.input_id, 'input_id fourni');
  assert.deepEqual(sub.model_override, { model: 'hermes-4-405b', provider: 'nous' });
  assert.equal(evs.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Depuis Desktop : c’est fait.');
  assert.ok(evs.some((e) => e.type === 'tool' && e.phase === 'completed' && e.tool === 'read_file' && e.duration === 0.3));
  assert.equal(evs[evs.length - 1].type, 'done');
  bridge.close();
  await gw.close();
});

test('approbation : approval.request puis approval.respond avec la génération', async () => {
  const { gw, bridge } = await setup();
  const evs = [];
  await bridge.runTurn({ sessionId: 'desk-2', input: 'approuve le push', onEvent: (e) => {
    evs.push(e);
    if (e.type === 'approval') bridge.approve('desk-2', { requestId: e.requestId, generation: e.generation, choice: 'once' });
  } });
  const a = evs.find((e) => e.type === 'approval');
  assert.equal(a.command, 'git push');
  assert.equal(a.generation, 3);
  assert.ok(evs.some((e) => e.type === 'settled' && e.requestId === 'pr-1'));
  assert.ok(evs.some((e) => e.type === 'tool' && e.tool === 'terminal' && !e.error));
  assert.ok(gw.log.includes('approval.respond'));
  bridge.close();
  await gw.close();
});

test('interruption : session.interrupt → cancelled', async () => {
  const { gw, bridge } = await setup();
  const evs = [];
  await bridge.runTurn({ sessionId: 'desk-3', input: 'long', onEvent: (e) => {
    evs.push(e);
    if (e.type === 'delta' && evs.filter((x) => x.type === 'delta').length === 1) bridge.interrupt('desk-3');
  } });
  assert.equal(evs[evs.length - 1].type, 'cancelled');
  bridge.close();
  await gw.close();
});

test('tour lancé depuis Desktop : suivi en spectateur, nouvelle connexion avec un nouveau ticket', async () => {
  const { gw, bridge, passive } = await setup();
  await bridge.runTurn({ sessionId: 'desk-4', input: 'x', onEvent: () => {} });
  gw.externalTurn('desk-4');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(passive[0].type, 'start');
  assert.equal(passive.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Depuis Desktop : c’est fait.');
  assert.equal(passive[passive.length - 1].type, 'end');
  assert.ok(passive.every((e) => e.session === 'desk-4' && e.via === 'desktop'));
  // reconnexion : le ticket précédent est consommé, attach en fournit un neuf
  for (const s of gw.sockets) s.terminate();
  await new Promise((r) => setTimeout(r, 50));
  const r = await bridge.runTurn({ sessionId: 'desk-4', input: 'encore', onEvent: () => {} });
  assert.equal(r.ok, true);
  bridge.close();
  await gw.close();
});

test('commande hermes introuvable : statut clair', async () => {
  const bridge = createDesktopBridge({ getSettings: () => ({ hermesBin: '/nulle/part/hermes' }),
    execFileImpl: (f, a, o, cb) => cb(new Error('absent'), '', '') });
  const st = await bridge.status();
  assert.equal(st.ok, false);
  assert.match(st.error, /introuvable/);
});
