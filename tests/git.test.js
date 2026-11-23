'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('../src/main/git');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-git-'));
  const run = (...a) => execFileSync('git', ['-C', dir].concat(a), { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\n');
  run('add', '.');
  run('commit', '-q', '-m', 'init');
  return { dir, run };
}

test('statut porcelain : branche et fichiers', () => {
  const s = git.parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.txt\nA  b.txt\n?? c.txt\n');
  assert.equal(s.branch, 'main');
  assert.equal(s.ahead, 2);
  assert.equal(s.behind, 1);
  assert.deepEqual(s.files.map((f) => [f.path, f.staged, f.untracked]), [['a.txt', false, false], ['b.txt', true, false], ['c.txt', false, true]]);
});

test('revue : non validé, dernier tour, indexation, commit', async () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\ndeux\n');
  const st = await git.status(dir);
  assert.equal(st.ok, true);
  assert.equal(st.branch, 'main');
  assert.equal(st.files[0].path, 'a.txt');

  await git.snapshot('s1', dir);                     // début de tour : a.txt déjà modifié
  fs.writeFileSync(path.join(dir, 'b.txt'), 'neuf\n'); // le tour crée b.txt
  const turn = await git.diff(dir, 'turn', '', 's1');
  assert.deepEqual(turn.files.map((f) => f.path), ['b.txt'], 'seul le travail du tour apparaît');
  const unc = await git.diff(dir, 'uncommitted', '', 's1');
  assert.deepEqual(unc.files.map((f) => f.path).sort(), ['a.txt', 'b.txt']);
  const d = await git.diff(dir, 'uncommitted', 'a.txt');
  assert.match(d.text, /\+deux/);

  assert.equal((await git.stage(dir, ['a.txt'], true)).ok, true);
  assert.equal((await git.stage(dir, ['../hors'], true)).ok, false, 'chemin hors dépôt refusé');
  const c = await git.commit(dir, 'modifie a', false);
  assert.equal(c.ok, true);
  const after = await git.status(dir);
  assert.deepEqual(after.files.map((f) => f.path), ['b.txt']);
});

test('dossier absent : message clair', async () => {
  const st = await git.status('/chemin/inexistant/xyz');
  assert.equal(st.ok, false);
  assert.match(st.error, /inaccessible/);
});
