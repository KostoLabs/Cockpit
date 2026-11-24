/* Synchro (plugin ctx_handover) : appareils, sessions des autres appareils,
 * reprise d'une session ici, état du plugin local, réglages du master. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;
  var B = KC.bridge;

  function agoSec(sec) { return sec ? KC.fmtAgo(sec * 1000) : '—'; }

  function TranscriptModal(props) {
    React.useEffect(function () {
      var k = function (e) { if (e.key === 'Escape') props.onClose(); };
      global.addEventListener('keydown', k);
      return function () { global.removeEventListener('keydown', k); };
    }, []);
    var t = props.data;
    return h('div', { className: 'kc-overlay', style: { paddingTop: '6vh' }, onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('div', { className: 'kc-pop', role: 'dialog', 'aria-label': 'Transcription', style: { width: '820px', maxWidth: 'calc(100vw - 32px)', maxHeight: '84vh', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px' } },
          h(KLAI.Overline, { label: t ? t.origin : 'Session', as: 'div' }),
          h('span', { className: 'kc-ellipsis', style: { flex: 1, fontWeight: 400 } }, t ? t.title : ''),
          t && props.onResume ? h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'steer', onClick: function () { props.onResume(t); } }, 'Reprendre ici') : null,
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'close', iconOnly: true, label: 'Fermer', onClick: props.onClose })),
        h('div', { style: { overflowY: 'auto', fontSize: '14px', lineHeight: '22px' } },
          !t ? h('div', { className: 'kc-meta' }, 'Chargement…') : t.error ? h('div', { className: 'kc-error-line' }, t.error) : h(KC.Markdown, { text: t.transcript || '(vide)' }))));
  }

  function Sync() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var st = React.useState(null), status = st[0], setStatus = st[1];
    var fd = React.useState(null), feed = fd[0], setFeed = fd[1];
    var md = React.useState(null), modal = md[0], setModal = md[1];
    var settings = state.settings || {};
    var sync = settings.sync || {};

    function load() {
      if (!B) return;
      B.ext.syncStatus().then(setStatus);
      B.ext.syncFeed().then(setFeed);
    }
    React.useEffect(function () { load(); var t = setInterval(load, 20000); return function () { clearInterval(t); }; }, [sync.enabled, sync.masterUrl, sync.sshTarget]);

    var master = status && status.master;
    var devices = master && master.ok && master.data && master.data.devices ? master.data.devices : {};
    var me = (status && status.local && status.local.config && status.local.config.device) || sync.device || '';
    var sessions = feed && feed.sessions ? feed.sessions.filter(function (s) { return s.origin !== me; }) : [];

    function read(s) {
      setModal({ loading: true, s: s });
      B.ext.syncSession(s.origin, s.session_id).then(function (r) {
        setModal({ s: s, data: r.ok ? r : { error: r.error, origin: s.origin, title: s.title } });
      });
    }
    function resume(t) {
      setModal(null);
      if (!state.backend || !state.backend.ok) return api.toast('Gateway Hermes injoignable : impossible d’ouvrir une session.', 'error');
      B.ext.syncSession(t.origin, t.sessionId, 16000).then(function (r) {
        if (!r.ok) return api.toast(r.error, 'error');
        api.newSession().then(function (s) {
          if (!s) return;
          api.rename(s.id, '↩ ' + (r.title || r.sessionId));
          api.send(s.id, 'Contexte repris depuis l’appareil « ' + r.origin + ' » (session ' + r.sessionId + '). Prends-en connaissance, résume en trois lignes où en était le travail, puis attends ma prochaine consigne.\n\n' + r.transcript);
        });
      });
    }

    var local = status && status.local;
    return h(KC.Page, { overline: 'Synchro — ctx_handover', title: 'Sessions entre appareils',
      meta: 'Chaque appareil pousse ses sessions vers le master, qui les redistribue aux autres. Reprenez ici le travail commencé ailleurs.',
      actions: h('div', { style: { display: 'flex', gap: '8px' } },
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'refresh', onClick: load }, 'Actualiser'),
        h(KLAI.Button, { size: 'sm', icon: 'settings', onClick: function () { api.navigate('settings'); } }, 'Réglages')) },

      !sync.enabled ? h('div', { className: 'kc-blank' },
        h('h2', { className: 'kc-h2' }, 'Synchro désactivée'),
        h('p', null, 'Renseignez le master (URL et jeton, ou cible SSH) dans les réglages, puis installez le plugin ctx_handover sur chaque appareil. Les sessions reçues localement restent consultables ci-dessous.'),
        h('p', { className: 'kc-mono', style: { fontSize: '12px' } }, 'master : python3 -m ctx_handover init --role master && python3 -m ctx_handover serve --host 0.0.0.0')) : null,

      h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(260px, 1fr)', gap: 'var(--space-12)', paddingTop: 'var(--space-6)' } },
        h('section', null,
          h(KLAI.Overline, { label: 'Sessions des autres appareils', count: sessions.length }),
          feed && feed.error ? h('div', { className: 'kc-meta', style: { color: 'var(--attention)', marginTop: '8px' } }, 'Master injoignable (' + feed.error + ') : affichage du miroir local.') : null,
          h('div', { className: 'kc-table', style: { marginTop: 'var(--space-3)' } },
            !feed ? h('div', { className: 'kc-empty' }, 'Chargement…') : null,
            feed && sessions.length === 0 ? h('div', { className: 'kc-empty' }, 'Aucune session reçue pour l’instant.') : null,
            sessions.slice(0, 120).map(function (s) {
              return h('div', { key: s.origin + '/' + s.session_id, className: 'kc-tr', style: { gridTemplateColumns: '110px minmax(0, 1fr) 100px auto' } },
                h('span', { className: 'kc-mono kc-muted kc-ellipsis', style: { fontSize: '11.5px' } }, s.origin),
                h('button', { type: 'button', className: 'kc-plain kc-ellipsis', style: { fontWeight: 400 }, onClick: function () { read(s); } }, s.title || s.session_id),
                h('span', { className: 'kc-meta' }, agoSec(s.updated_at)),
                h('span', { style: { display: 'flex', gap: '2px' } },
                  h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { read(s); } }, 'Lire'),
                  h(KLAI.Button, { variant: 'ghost', size: 'sm', iconRight: 'steer', onClick: function () { resume({ origin: s.origin, sessionId: s.session_id }); } }, 'Reprendre')));
            }))),

        h('aside', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' } },
          h('section', null,
            h(KLAI.Overline, { label: 'Appareils', count: Object.keys(devices).length }),
            master && !master.ok ? h('div', { className: 'kc-meta', style: { marginTop: '8px', color: 'var(--attention)' } }, master.error) : null,
            h('div', { style: { marginTop: 'var(--space-3)' } }, Object.keys(devices).sort().map(function (name) {
              var d = devices[name];
              var online = d.last_seen && Date.now() / 1000 - d.last_seen < 120;
              return h('div', { key: name, className: 'kc-agenda', style: { alignItems: 'baseline' } },
                h('span', { className: 'kc-dot ' + (online ? 'kc-dot-live' : 'kc-dot-done'), style: { alignSelf: 'center' } }),
                h('span', { className: 'kc-ellipsis', style: { flex: 1, fontWeight: 400 } }, name + (name === me ? ' · cet appareil' : '')),
                h('span', { className: 'kc-meta' }, d.last_push ? 'poussé ' + agoSec(d.last_push) : 'vu ' + agoSec(d.last_seen)));
            })),
            master && master.ok && master.data ? h('div', { className: 'kc-meta kc-mono', style: { fontSize: '11.5px', marginTop: '8px' } },
              'journal ' + master.data.seq + ' · ' + master.data.sessions + ' sessions · protocole ' + master.data.protocol) : null),

          h('section', null,
            h(KLAI.Overline, { label: 'Plugin sur cet appareil' }),
            !local ? h('div', { className: 'kc-meta' }, '…') : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-3)', fontSize: '13px' } },
              h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, h(KLAI.StatusChip, { status: local.installed ? 'done' : 'attention', label: local.installed ? 'Installé' : 'Non installé' }),
                h(KLAI.StatusChip, { status: local.configured ? 'done' : 'attention', label: local.configured ? 'Configuré' : 'Non configuré' })),
              local.config ? h('span', { className: 'kc-meta' }, 'appareil ' + local.config.device + ' · ' + local.config.role + ' · ' + local.config.transport) : null,
              local.state ? h('span', { className: 'kc-meta' }, local.state.pushed + ' sessions poussées · ' + local.mirror.length + ' reçues · dernière poussée ' + agoSec(local.state.lastPush)) : null,
              local.state && local.state.lastError ? h('span', { className: 'kc-meta', style: { color: 'var(--danger)' } }, local.state.lastError) : null,
              h('div', { className: 'kc-row-actions' },
                h(KLAI.Button, { size: 'sm', onClick: function () {
                  B.ext.syncSave({ install: true, configure: true }).then(function (r) {
                    api.toast(r.ok ? 'Plugin installé et configuré. Activez-le : « hermes plugins enable ctx_handover », puis redémarrez le gateway.' : r.error, r.ok ? 'info' : 'error');
                    load();
                  });
                } }, local.installed ? 'Mettre à jour et reconfigurer' : 'Installer sur cet appareil')),
              h('span', { className: 'kc-hint-text' }, 'Copie le plugin dans ~/.hermes/plugins et écrit ~/.hermes/ctx_handover.json à partir des réglages du cockpit.'))))),
      modal ? h(TranscriptModal, { data: modal.data, onClose: function () { setModal(null); }, onResume: resume }) : null);
  }

  /* Section des réglages : master de synchro. */
  function SyncSettings() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var s = state.settings || {};
    var d = React.useState(Object.assign({}, s.sync || {})), draft = d[0], setDraft = d[1];
    var t = React.useState(''), tok = t[0], setTok = t[1];
    var r = React.useState(null), test = r[0], setTest = r[1];
    function set(k, v) { var n = Object.assign({}, draft); n[k] = v; setDraft(n); }
    function save() {
      var next = { sync: draft };
      if (tok) next.syncToken = tok;
      return api.saveSettings(next).then(function () { setTok(''); api.toast('Synchro enregistrée.'); });
    }
    return h('section', { className: 'kc-section' },
      h(KLAI.Overline, { label: '04 — Synchro des sessions (ctx_handover)', as: 'h2' }),
      h('label', { className: 'kc-toggle' }, h('input', { type: 'checkbox', checked: !!draft.enabled, onChange: function (e) { set('enabled', e.target.checked); } }), 'Activer la synchro avec un master'),
      h('div', { className: 'kc-field' }, h('span', null, 'Transport'),
        h(KLAI.Segmented, { value: draft.transport || 'http', onChange: function (v) { set('transport', v); }, label: 'Transport', options: [{ value: 'http', label: 'Serveur HTTP' }, { value: 'ssh', label: 'SSH' }] })),
      (draft.transport || 'http') === 'http'
        ? h(React.Fragment, null,
            h(KC.Field, { label: 'URL du master', hint: '« python3 -m ctx_handover serve » sur le master ; préférez Tailscale, un tunnel SSH ou --tls-cert.' },
              h('input', { className: 'kc-input is-mono', value: draft.masterUrl || '', placeholder: 'http://master.tailnet:8765', spellCheck: false, onChange: function (e) { set('masterUrl', e.target.value); } })),
            h(KC.Field, { label: 'Jeton', hint: (s.hasSyncToken ? 'Jeton enregistré (chiffré). ' : '') + 'Affiché par « ctx_handover init --role master ».' },
              h('input', { className: 'kc-input is-mono', type: 'password', value: tok, autoComplete: 'off', placeholder: s.hasSyncToken ? '••••••••••••' : '', onChange: function (e) { setTok(e.target.value); } })))
        : h(React.Fragment, null,
            h(KC.Field, { label: 'Cible SSH', hint: 'Clé SSH sans mot de passe (BatchMode) ; le master n’expose aucun port.' },
              h('input', { className: 'kc-input is-mono', value: draft.sshTarget || '', placeholder: 'quentin@master', spellCheck: false, onChange: function (e) { set('sshTarget', e.target.value); } })),
            h(KC.Field, { label: 'Commande distante' },
              h('input', { className: 'kc-input is-mono', value: draft.sshCommand || '', spellCheck: false, onChange: function (e) { set('sshCommand', e.target.value); } }))),
      h(KC.Field, { label: 'Nom de cet appareil', hint: 'Vide : nom de la machine.' },
        h('input', { className: 'kc-input is-mono', value: draft.device || '', spellCheck: false, onChange: function (e) { set('device', e.target.value); } })),
      h('div', { className: 'kc-row-actions' },
        h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'check', onClick: save }, 'Enregistrer'),
        h(KLAI.Button, { variant: 'secondary', size: 'sm', icon: 'refresh', onClick: function () {
          setTest({ pending: true });
          save().then(function () { return B.ext.syncTest(); }).then(setTest);
        } }, 'Tester le master')),
      test && test.pending ? h('div', { className: 'kc-meta' }, 'Test en cours…') : null,
      test && !test.pending ? h('div', { className: 'kc-meta', style: { color: test.ok ? 'var(--ink)' : 'var(--danger)' } },
        test.ok ? 'Master joignable · ' + test.data.sessions + ' sessions · ' + Object.keys(test.data.devices || {}).length + ' appareils' : test.error) : null);
  }

  KC.Screens.Sync = Sync;
  KC.SyncSettings = SyncSettings;
})(window);
