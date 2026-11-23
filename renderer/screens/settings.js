/* Réglages : gateway Hermes, préférences, à propos. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;

  function Field(props) {
    return h('label', { className: 'kc-field' },
      h('span', null, props.label),
      props.children,
      props.hint ? h('span', { className: 'kc-hint-text' }, props.hint) : null);
  }
  KC.Field = Field;

  function Settings() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var s = state.settings;
    var d = React.useState(null), draft = d[0], setDraft = d[1];
    var k = React.useState(''), key = k[0], setKey = k[1];
    var t = React.useState(null), test = t[0], setTest = t[1];
    var m = React.useState([]), models = m[0], setModels = m[1];

    React.useEffect(function () { if (s && !draft) setDraft(Object.assign({}, s)); }, [s]);
    React.useEffect(function () {
      if (!KC.bridge || !state.backend || !state.backend.ok) return;
      KC.bridge.hermes.modelOptions().then(function (r) { setModels(r.ok ? r.models : (state.backend.models || []).map(function (id) { return { id: id, label: id }; })); });
    }, [state.backend && state.backend.ok]);

    if (!draft) return h('main', { className: 'kc-main' }, h('div', { className: 'kc-meta' }, 'Chargement des réglages…'));
    function set(field, value) { var n = Object.assign({}, draft); n[field] = value; setDraft(n); }

    function saveGateway() {
      var next = { hermesBaseUrl: String(draft.hermesBaseUrl || '').trim(), hermesProfile: String(draft.hermesProfile || '').trim() };
      if (key) next.hermesApiKey = key;
      return api.saveSettings(next).then(function () { setKey(''); api.toast('Connexion enregistrée.'); api.refresh(true); });
    }
    function runTest() {
      setTest({ pending: true });
      saveGateway().then(function () { return KC.bridge.hermes.status(); }).then(function (r) { setTest(r); });
    }
    function savePrefs() {
      api.saveSettings({ userName: String(draft.userName || '').trim(), model: draft.model || '', pollSeconds: Math.max(5, Math.min(300, Number(draft.pollSeconds) || 15)) })
        .then(function () { api.toast('Préférences enregistrées.'); });
    }

    var features = test && test.ok && test.capabilities && test.capabilities.features ? Object.keys(test.capabilities.features).filter(function (f) { return test.capabilities.features[f] === true; }) : [];

    return h('main', { className: 'kc-main' },
      h('div', { className: 'kc-head' }, h('div', { className: 'kc-head-text' },
        h(KLAI.Overline, { label: 'Réglages', as: 'div' }),
        h('h1', { className: 'kc-h1' }, 'Cockpit et gateway'))),
      h('div', { className: 'kc-form' },
        h('section', { className: 'kc-section' },
          h(KLAI.Overline, { label: '01 — Gateway Hermes', as: 'h2' }),
          h(Field, { label: 'URL du gateway', hint: 'Port annoncé par « hermes gateway » (8642 par défaut). Un gateway distant passe de préférence par Tailscale ou un tunnel SSH.' },
            h('input', { className: 'kc-input is-mono', value: draft.hermesBaseUrl || '', spellCheck: false, onChange: function (e) { set('hermesBaseUrl', e.target.value); } })),
          h(Field, { label: 'Profil (facultatif)', hint: 'Avec gateway.multiplex_profiles, les requêtes passent par /p/<profil>/.' },
            h('input', { className: 'kc-input is-mono', value: draft.hermesProfile || '', spellCheck: false, placeholder: 'default', onChange: function (e) { set('hermesProfile', e.target.value); } })),
          h(Field, { label: 'Clé API', hint: (s.hasApiKey ? 'Clé enregistrée' + (s.secretsEncrypted ? ', chiffrée dans le trousseau. ' : '. ') : '') + 'API_SERVER_KEY de ~/.hermes/.env. Laisser vide pour conserver la clé actuelle.' },
            h('input', { className: 'kc-input is-mono', type: 'password', value: key, placeholder: s.hasApiKey ? '••••••••••••' : 'sk-…', autoComplete: 'off', onChange: function (e) { setKey(e.target.value); } })),
          h('div', { className: 'kc-row-actions' },
            h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'check', onClick: saveGateway }, 'Enregistrer'),
            h(KLAI.Button, { variant: 'secondary', size: 'sm', icon: 'refresh', onClick: runTest }, 'Tester la connexion'),
            s.hasApiKey ? h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { api.saveSettings({ hermesApiKey: null }).then(function () { api.toast('Clé supprimée.'); }); } }, 'Oublier la clé') : null),
          test && test.pending ? h('div', { className: 'kc-meta' }, 'Test en cours…') : null,
          test && !test.pending ? (test.ok
            ? h('div', { className: 'kc-meta', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                h('span', { style: { color: 'var(--ink)' } }, 'Connecté · ' + test.models.join(', ')),
                features.length ? h('span', { className: 'kc-mono', style: { fontSize: '11.5px' } }, features.join(' · ')) : null)
            : h('div', { className: 'kc-meta', style: { color: 'var(--danger)' } }, 'Injoignable : ' + test.error)) : null),

        h('section', { className: 'kc-section' },
          h(KLAI.Overline, { label: '02 — Préférences', as: 'h2' }),
          h(Field, { label: 'Prénom', hint: 'Pour la salutation de la vue d’ensemble.' },
            h('input', { className: 'kc-input', value: draft.userName || '', onChange: function (e) { set('userName', e.target.value); } })),
          h(Field, { label: 'Modèle par défaut', hint: 'Envoyé avec chaque tour ; le composer permet de le changer par session.' },
            h('select', { className: 'kc-select', value: draft.model || '', onChange: function (e) { set('model', e.target.value); } },
              h('option', { value: '' }, 'Celui du gateway'),
              models.map(function (mo) { return h('option', { key: mo.id + mo.provider, value: mo.id }, mo.label + (mo.provider ? ' · ' + mo.provider : '')); }),
              draft.model && !models.some(function (mo) { return mo.id === draft.model; }) ? h('option', { value: draft.model }, draft.model) : null)),
          h(Field, { label: 'Rafraîchissement (secondes)' },
            h('input', { className: 'kc-input is-mono', type: 'number', min: 5, max: 300, value: draft.pollSeconds || 15, onChange: function (e) { set('pollSeconds', e.target.value); } })),
          h('div', { className: 'kc-field' }, h('span', null, 'Thème'),
            h(KLAI.Segmented, { label: 'Thème', value: s.theme || 'light', onChange: function (v) { api.saveSettings({ theme: v }); },
              options: [{ value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }, { value: 'system', label: 'Système' }] })),
          h('div', { className: 'kc-row-actions' }, h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'check', onClick: savePrefs }, 'Enregistrer'))),

        KC.SyncSettings ? h(KC.SyncSettings, null) : null,

        h('section', { className: 'kc-section' },
          h(KLAI.Overline, { label: 'À propos', as: 'h2' }),
          h(KLAI.Logo, { variant: 'lockup-mark', size: 19 }),
          state.info ? h('div', { className: 'kc-mono kc-muted', style: { fontSize: '12px', lineHeight: '20px' } },
            'Cockpit ' + state.info.version + ' · Electron ' + state.info.electron + ' · ' + state.info.platform + ' ' + state.info.arch,
            h('br'), 'Secrets ' + (s.secretsEncrypted ? 'chiffrés (trousseau du système)' : 'encodés localement, trousseau indisponible')) : null,
          h('div', { className: 'kc-meta' }, '© KostoLabs Company'))));
  }

  KC.Screens = KC.Screens || {};
  KC.Screens.Settings = Settings;
})(window);
