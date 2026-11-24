'use strict';
/* Test de fumée de l'app Electron réelle, contre le faux gateway.
 *   xvfb-run -a node tests/e2e/smoke.js [dossier-captures]
 * Lance l'app avec un userData jetable, attend la vue d'ensemble, ouvre une
 * session, envoie un message, vérifie la réponse et capture chaque écran. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const { createFakeGateway } = require('../fake-gateway');

(async () => {
  const outDir = process.argv[2] || path.join(os.tmpdir(), 'klai-smoke');
  fs.mkdirSync(outDir, { recursive: true });
  // Dépôt Git temporaire pour le panneau « Revoir » (remplace ~/Developer/koordo).
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-koordo-'));
  const { execFileSync } = require('child_process');
  const g = (...a) => execFileSync('git', ['-C', repo].concat(a), { stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'demo@example.com'); g('config', 'user.name', 'Demo');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Koordo\n'); g('add', '.'); g('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Koordo\n\nRecette preprod.\n');
  fs.writeFileSync(path.join(repo, 'rapport-recette.md'), '# Rapport\n12 tests, 2 échecs.\n');
  const gw = createFakeGateway({ key: 'smoke-key', tick: 30, hideCwd: true, remap: { '/Users/q/Developer/koordo': repo } });
  // Faux ~/.hermes : projets nommés (projects.db) et dossiers des sessions (state.db), comme Hermes Desktop.
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-hermes-home-'));
  const { DatabaseSync } = require('node:sqlite');
  const pdb = new DatabaseSync(path.join(hermesHome, 'projects.db'));
  pdb.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, slug TEXT, name TEXT, primary_path TEXT, created_at INTEGER, archived INTEGER DEFAULT 0);
    CREATE TABLE project_folders (project_id TEXT, path TEXT, PRIMARY KEY (project_id, path));`);
  pdb.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, 1, 0)').run('p1', 'koordo', 'Koordo', repo);
  pdb.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, 1, 0)').run('p2', 'genres', 'KostoLabs GenRes', '/Users/q/Developer/genres');
  pdb.close();
  const sdb = new DatabaseSync(path.join(hermesHome, 'state.db'));
  sdb.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, cwd TEXT, git_branch TEXT, git_repo_root TEXT)');
  for (const s of gw.sessions) sdb.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run(s.session_id, s.source, s.source, s.cwd || '', s.cwd === repo ? 'main' : '', s.cwd === repo ? repo : '');
  sdb.close();
  const port = await gw.listen(0);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-ud-'));
  // Master ctx_handover réel (Python) avec deux sessions venues d'autres appareils.
  let master = null, syncCfg = {};
  if ((process.env.SMOKE_STEPS || '').includes('sync')) {
    const { spawn, execFileSync } = require('child_process');
    const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-master-'));
    const plugins = path.join(__dirname, '..', '..', 'plugins');
    const env = Object.assign({}, process.env, { PYTHONPATH: plugins, CTX_HANDOVER_CONFIG: path.join(mdir, 'cfg.json') });
    fs.writeFileSync(path.join(mdir, 'cfg.json'), JSON.stringify({ role: 'master', device: 'master', token: 'tok', store: mdir }));
    const mport = 18000 + Math.floor(Math.random() * 1000);
    master = spawn('python3', ['-m', 'ctx_handover', 'serve', '--port', String(mport)], { env, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    execFileSync('python3', ['-c', [
      'from ctx_handover import core; import json',
      't = core.HttpTransport("http://127.0.0.1:' + mport + '", "tok", "macbook-air")',
      'rec = lambda sid, u, a, title: json.dumps({"session_id": sid, "title": title, "messages": [{"role": "user", "content": u}, {"role": "assistant", "content": a}]})',
      't.push(core.make_bundle("macbook-air", "air-1", rec("air-1", "Prépare la démo Koordo", "Plan en 4 étapes : données, parcours, script, répétition.", "Démo Koordo")))',
      't2 = core.HttpTransport("http://127.0.0.1:' + mport + '", "tok", "mac-mini")',
      't2.push(core.make_bundle("mac-mini", "mini-7", rec("mini-7", "Veille jurisprudence", "3 décisions pertinentes trouvées.", "Veille jurisprudence")))'
    ].join('\n')], { env });
    syncCfg = { sync: { enabled: true, transport: 'http', masterUrl: 'http://127.0.0.1:' + mport, device: 'studio' } };
  }
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    hermesBaseUrl: 'http://127.0.0.1:' + port, userName: 'Quentin', ...syncCfg,
    secrets: { hermesApiKey: 'raw:' + Buffer.from('smoke-key').toString('base64'), syncToken: 'raw:' + Buffer.from('tok').toString('base64') }
  }));
  const root = process.env.SMOKE_APP || path.join(__dirname, '..', '..');
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox'],
    env: Object.assign({}, process.env, { KLAI_USER_DATA: userData, HERMES_HOME: hermesHome, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' })
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.setViewportSize({ width: 1440, height: 900 });
  const steps = (process.env.SMOKE_STEPS || 'overview').split(',');
  try {
    await win.waitForSelector('text=Koordo', { timeout: 15000 });
    await win.waitForSelector('text=KostoLabs GenRes', { timeout: 5000 });
    await win.screenshot({ path: path.join(outDir, '01-vue-ensemble.png') });
    if (await win.locator('main >> text=Veille réglementaire').count()) throw new Error('une exécution de routine apparaît dans les projets');
    console.log('ok vue d’ensemble');
    if (steps.includes('project')) {
      await win.click('text=Première analyse juridique');
      await win.waitForSelector('text=Conclusion pratique', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '02-projet.png') });
      console.log('ok projet');
    }
    if (steps.includes('chat')) {
      await win.click('text=Nouvelle session');
      await win.fill('textarea', 'délègue puis approuve');
      await win.keyboard.press('Enter');
      await win.waitForSelector('text=ssh-add', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '03-approbation.png') });
      await win.click('button:has-text("Approuver")');
      await win.waitForSelector('text=Tout fonctionne', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '04-reponse.png') });
      console.log('ok conversation + approbation');
    }
    if (steps.includes('review')) {
      await win.evaluate(() => window.__klaiNavigate('overview'));
      await win.click('text=Recette Preprod App');
      await win.waitForSelector('text=rapport-recette.md', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '05-revue.png') });
      console.log('ok revue git');
    }
    if (steps.includes('jobs')) {
      await win.evaluate(() => window.__klaiNavigate('jobs'));
      await win.click('text=Voir les 1 exécution');
      await win.waitForSelector('text=2 textes publiés', { state: 'attached', timeout: 1000 }).catch(() => {});
      await win.screenshot({ path: path.join(outDir, '09-taches.png') });
      console.log('ok routines et exécutions');
    }
    if (steps.includes('term')) {
      await win.evaluate(() => window.__klaiNavigate('terminal'));
      await win.fill('input[placeholder="git status"]', 'echo cockpit-$((20+22))');
      await win.keyboard.press('Enter');
      await win.waitForSelector('text=cockpit-42', { timeout: 10000 });
      await win.waitForSelector('text=terminé', { timeout: 10000 });
      console.log('ok terminal');
    }
    if (steps.includes('sync')) {
      await win.evaluate(() => window.__klaiNavigate('sync'));
      await win.waitForSelector('text=Démo Koordo', { timeout: 10000 });
      await win.waitForSelector('text=mac-mini', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '06-synchro.png') });
      await win.click('button:has-text("Démo Koordo")');
      await win.waitForSelector('text=Plan en 4 étapes', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '07-transcription.png') });
      await win.click('button:has-text("Reprendre ici")');
      await win.waitForSelector('text=Contexte repris', { timeout: 10000 });
      await win.screenshot({ path: path.join(outDir, '08-reprise.png') });
      console.log('ok synchro + reprise');
    }
    for (const r of (process.env.SMOKE_ROUTES || '').split(',').filter(Boolean)) {
      await win.evaluate((route) => window.__klaiNavigate && window.__klaiNavigate(route), r);
      await win.waitForTimeout(800);
      await win.screenshot({ path: path.join(outDir, 'route-' + r + '.png') });
      console.log('ok route ' + r);
    }
    if (process.env.SMOKE_DARK) {
      await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await win.waitForTimeout(300);
      await win.screenshot({ path: path.join(outDir, '99-sombre.png') });
    }
  } catch (err) {
    await win.screenshot({ path: path.join(outDir, 'echec.png') }).catch(() => {});
    console.error('ÉCHEC', err.message);
    process.exitCode = 1;
  }
  if (errors.length) { console.error('Erreurs console :\n' + errors.join('\n')); process.exitCode = 1; }
  await app.close();
  await gw.close();
  if (master) master.kill();
  console.log('captures dans', outDir);
})();
