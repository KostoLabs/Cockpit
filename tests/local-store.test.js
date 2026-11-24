'use strict';
/* Lecture seule de projects.db et state.db (schéma d'Hermes) via node:sqlite. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const local = require('../src/main/local-store');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-hermes-'));
  const p = new DatabaseSync(path.join(home, 'projects.db'));
  p.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT,
      board_slug TEXT, primary_path TEXT, created_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE project_folders (project_id TEXT NOT NULL, path TEXT NOT NULL, label TEXT, is_primary INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL, PRIMARY KEY (project_id, path));
    INSERT INTO projects VALUES ('p1', 'koordo', 'Koordo', NULL, NULL, NULL, NULL, '/Users/q/Developer/koordo', 1, 0);
    INSERT INTO projects VALUES ('p2', 'daily', 'Daily', NULL, NULL, NULL, NULL, '/Users/q/Daily', 1, 0);
    INSERT INTO projects VALUES ('p3', 'old', 'Ancien', NULL, NULL, NULL, NULL, '/Users/q/old', 1, 1);
    INSERT INTO project_folders VALUES ('p1', '/Users/q/Developer/koordo-ios', NULL, 0, 1);`);
  p.close();
  const s = new DatabaseSync(path.join(home, 'state.db'));
  s.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, cwd TEXT, git_branch TEXT, git_repo_root TEXT, title TEXT);
    INSERT INTO sessions VALUES ('a', 'local', 'desktop', '/Users/q/Developer/koordo/app/src', 'main', '/Users/q/Developer/koordo', 'Recette');
    INSERT INTO sessions VALUES ('b', 'local', 'desktop', '/Users/q/Developer/koordo-ios', NULL, NULL, 'iOS');
    INSERT INTO sessions VALUES ('c', 'cron', 'cron', '/Users/q', NULL, NULL, 'Sentry — analyse approfondie');
    INSERT INTO sessions VALUES ('d', 'local', 'desktop', '/Users/q/Daily/notes', NULL, NULL, 'Synchroniser');
    INSERT INTO sessions VALUES ('e', 'local', 'desktop', '/Users/q/autre', NULL, NULL, 'Hors projet');`);
  s.close();
  return home;
}

test('projets nommés, dossiers et rattachement des sessions', () => {
  const r = local.snapshot({ hermesHome: fixture() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.projects.map((p) => p.name).sort(), ['Daily', 'Koordo'], 'projet archivé exclu');
  assert.equal(r.sessions.a.projectId, 'p1', 'racine Git dans le dossier du projet');
  assert.equal(r.sessions.a.branch, 'main');
  assert.equal(r.sessions.b.projectId, 'p1', 'dossier secondaire du projet');
  assert.equal(r.sessions.d.projectId, 'p2', 'sous-dossier du projet');
  assert.equal(r.sessions.e.projectId, null);
  assert.equal(r.sessions.e.workspace, '/Users/q/autre');
  assert.equal(r.sessions.c.source, 'cron');
});

test('base absente ou gateway distant : repli propre', () => {
  assert.equal(local.snapshot({ hermesHome: '/nulle/part' }).ok, false);
  assert.equal(local.isLocalUrl('http://127.0.0.1:8642'), true);
  assert.equal(local.isLocalUrl('http://localhost:8642/v1'), true);
  assert.equal(local.isLocalUrl('https://mac-mini.tailnet.ts.net:8642'), false);
});
