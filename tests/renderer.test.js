'use strict';
/* Tests du renderer sous Node : les scripts sont chargés dans un contexte vm
 * avec un React minimal (aucun DOM nécessaire pour la logique testée). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function loadRenderer() {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({ Provider: 'Provider' }),
    useMemo: (fn) => fn(), useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useRef: (v) => ({ current: v }), useEffect: () => {}, useContext: () => null, useReducer: (r, s) => [s, () => {}], Fragment: 'Fragment'
  };
  const store = {};
  const window = { React, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  window.window = window;
  const ctx = vm.createContext(Object.assign(window, { URLSearchParams, Date, Math, JSON, Promise, setTimeout, clearTimeout, console }));
  for (const f of ['lib/util.js', 'lib/markdown.js', 'lib/store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.KC;
}

const KC = loadRenderer();
const plain = (v) => JSON.parse(JSON.stringify(v));

test('markdown : titres, listes numérotées, code, tableau, citation', () => {
  const b = KC.parseMarkdown('## Conclusion\n\nTexte **gras**.\n\n1. Un\n2. Deux\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> cité\n\n- x\n- y');
  assert.deepEqual(plain(b.map((x) => x.t)), ['h', 'p', 'ol', 'code', 'table', 'quote', 'ul']);
  assert.equal(b[2].items.length, 2);
  assert.equal(b[3].lang, 'js');
  assert.equal(b[3].text, 'const a = 1;');
  assert.deepEqual(plain(b[4].rows), [['1', '2']]);
});

test('markdown : bloc de code non fermé et lignes vides', () => {
  const b = KC.parseMarkdown('```\nligne\n\nsuite');
  assert.equal(b[0].t, 'code');
  assert.equal(b[0].text, 'ligne\n\nsuite');
});

test('reducer : tour complet avec outils, approbation, sous-agent', () => {
  const r = KC.Store.reducer;
  let s = { sessions: [{ id: 's1', title: 'T' }], live: {}, messages: {}, active: 's1', route: 'project', tabs: ['s1'], toasts: [] };
  const ev = (e) => { s = r(s, { type: 'event', ev: Object.assign({ session: 's1' }, e) }); };
  ev({ type: 'start' });
  ev({ type: 'run', runId: 'r1' });
  ev({ type: 'tool', phase: 'started', tool: 'terminal', preview: 'ls' });
  ev({ type: 'approval', requestId: 'p1', generation: 1, command: 'rm x', choices: ['once', 'deny'] });
  assert.equal(s.live.s1.approvals.length, 1);
  assert.equal(KC.sessionState(s.sessions[0], s.live.s1).status, 'attention');
  s = r(s, { type: 'dropApproval', id: 's1', requestId: 'p1' });
  assert.equal(s.live.s1.approvals.length, 0);
  ev({ type: 'tool', phase: 'completed', tool: 'terminal', duration: 1.5 });
  ev({ type: 'subagent', phase: 'start', name: 'veille' });
  ev({ type: 'delta', text: 'Bon' });
  ev({ type: 'delta', text: 'jour' });
  assert.equal(KC.sessionState(s.sessions[0], s.live.s1).status, 'running');
  ev({ type: 'subagent', phase: 'complete', name: 'veille', status: 'completed', summary: 'ok' });
  ev({ type: 'done' });
  ev({ type: 'end' });
  const msg = s.messages.s1[0];
  assert.equal(msg.text, 'Bonjour');
  assert.equal(msg.liveTools[0].status, 'done');
  assert.equal(msg.subagents[0].summary, 'ok');
  assert.equal(s.live.s1.busy, false);
  assert.equal(s.live.s1.unread, false, 'session affichée : pas de non-lu');
});

test('reducer : 409 lecture seule marque la session', () => {
  let s = { sessions: [{ id: 's1', title: 'T' }], live: {}, messages: {}, active: null, route: 'overview', tabs: [], toasts: [] };
  s = KC.Store.reducer(s, { type: 'event', ev: { session: 's1', type: 'error', code: 'read_only', text: 'x' } });
  assert.equal(s.sessions[0].readOnly, true);
  assert.equal(s.live.s1.unread, true);
});

test('regroupement par dossier de travail, Accueil pour le dossier personnel', () => {
  const now = Date.now();
  const g = KC.groupSessions([
    { id: 'a', title: 'A', workspace: '/Users/q/dev/koordo', updated: now - 1000 },
    { id: 'b', title: 'B', workspace: '/Users/q', updated: now - 5000, streaming: true },
    { id: 'c', title: 'C', workspace: '/Users/q/dev/koordo', updated: now }
  ], [], {});
  assert.deepEqual(plain(g.map((x) => x.name)), ['Accueil', 'koordo']);
  assert.equal(g[1].sessions[0].id, 'c');
  assert.equal(g[0].live, 1);
  assert.equal(KC.shortPath('/Users/q/dev/koordo'), '~/dev/koordo');
});

test('enrichissement local : projets nommés, routines écartées des projets', () => {
  const now = Date.now();
  const api = [
    { id: 'a', title: 'Recette', source: 'local', updated: now },
    { id: 'c', title: 'Sentry — analyse approfondie', source: 'local', updated: now },
    { id: 'e', title: 'Hors projet', source: 'local', updated: now - 1000 },
    { id: 'z', title: 'Sans base', source: 'local', updated: now - 5000 }
  ];
  const localMeta = { sessions: {
    a: { workspace: '/Users/q/Developer/koordo', cwd: '/Users/q/Developer/koordo/app', projectId: 'p1', branch: 'main', source: 'local' },
    c: { workspace: '/Users/q', projectId: null, source: 'cron', createdSource: 'cron' },
    e: { workspace: '/Users/q/autre', projectId: null, source: 'local' } } };
  const enriched = KC.enrichSessions(api, localMeta);
  assert.equal(enriched[1].cron, true);
  const groups = KC.groupSessions(enriched, [{ id: 'p1', name: 'Koordo', path: '/Users/q/Developer/koordo' }], {});
  assert.deepEqual(plain(groups.map((g) => g.name)), ['Koordo', 'autre', 'Sans dossier'], 'routine absente, « Sans dossier » en dernier');
  assert.equal(groups[0].isProject, true);
});
