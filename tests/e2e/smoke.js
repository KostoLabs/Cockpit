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
  const gw = createFakeGateway({ key: 'smoke-key', tick: 30 });
  const port = await gw.listen(0);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'klai-ud-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    hermesBaseUrl: 'http://127.0.0.1:' + port, userName: 'Quentin',
    secrets: { hermesApiKey: 'raw:' + Buffer.from('smoke-key').toString('base64') }
  }));
  const root = path.join(__dirname, '..', '..');
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox'],
    env: Object.assign({}, process.env, { KLAI_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' })
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.setViewportSize({ width: 1440, height: 900 });
  const steps = (process.env.SMOKE_STEPS || 'overview').split(',');
  try {
    await win.waitForSelector('text=Koordo', { timeout: 15000 });
    await win.screenshot({ path: path.join(outDir, '01-vue-ensemble.png') });
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
  console.log('captures dans', outDir);
})();
