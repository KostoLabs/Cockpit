'use strict';
/* Réglages persistés dans <userData>/settings.json.
 * Les secrets (clé API Hermes, jeton du master de synchro) sont chiffrés avec
 * safeStorage (trousseau macOS) quand il est disponible ; ils ne remontent
 * jamais au renderer : celui-ci ne voit que hasApiKey / hasSyncToken. */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesProfile: '',
  model: '',
  theme: 'light',
  userName: '',
  pollSeconds: 15,
  window: null,
  openTabs: [],
  sync: { enabled: false, transport: 'http', masterUrl: '', sshTarget: '', device: '' }
};
const SECRET_KEYS = ['hermesApiKey', 'syncToken'];

function createSettingsStore(opts) {
  const file = opts.file;
  const safeStorage = opts.safeStorage || null;
  let cache = null;

  function canEncrypt() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
  }

  function readRaw() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { cache = {}; }
    // migration v0.4 : clé en clair → chiffrée
    if (typeof cache.hermesApiKey === 'string' && cache.hermesApiKey && canEncrypt()) {
      cache.secrets = Object.assign({}, cache.secrets, { hermesApiKey: encrypt(cache.hermesApiKey) });
      delete cache.hermesApiKey;
      writeRaw(cache);
    }
    return cache;
  }

  function writeRaw(obj) {
    cache = obj;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function encrypt(v) {
    if (!v) return '';
    if (canEncrypt()) return 'enc:' + safeStorage.encryptString(v).toString('base64');
    return 'raw:' + Buffer.from(v, 'utf-8').toString('base64');
  }
  function decrypt(v) {
    if (!v) return '';
    try {
      if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
      if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString('utf-8');
    } catch { return ''; }
    return '';
  }

  function all() {
    const raw = readRaw();
    const out = Object.assign({}, DEFAULTS, raw);
    out.sync = Object.assign({}, DEFAULTS.sync, raw.sync || {});
    delete out.secrets;
    delete out.hermesApiKey;
    return out;
  }

  /* Vue publique (renderer) : pas de secrets. */
  function publicView() {
    const s = all();
    const secrets = readRaw().secrets || {};
    s.hasApiKey = !!secrets.hermesApiKey;
    s.hasSyncToken = !!secrets.syncToken;
    s.secretsEncrypted = canEncrypt();
    return s;
  }

  function secret(name) {
    return decrypt((readRaw().secrets || {})[name]);
  }

  function set(next) {
    const raw = Object.assign({}, readRaw());
    const secrets = Object.assign({}, raw.secrets || {});
    for (const k of Object.keys(next || {})) {
      if (SECRET_KEYS.includes(k)) {
        if (next[k] === null || next[k] === '') delete secrets[k];
        else if (typeof next[k] === 'string') secrets[k] = encrypt(next[k]);
        continue;
      }
      if (!(k in DEFAULTS)) continue; // champs inconnus ignorés
      if (k === 'sync') raw.sync = Object.assign({}, DEFAULTS.sync, raw.sync || {}, next.sync || {});
      else raw[k] = next[k];
    }
    raw.secrets = secrets;
    writeRaw(raw);
    return publicView();
  }

  return { all, publicView, secret, set, canEncrypt };
}

module.exports = { createSettingsStore, DEFAULTS };
