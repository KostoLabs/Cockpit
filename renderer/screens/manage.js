/* Écrans de gestion : Tâches planifiées (API Jobs), Capacités (skills, toolsets),
 * Messagerie (sessions des plateformes reliées au gateway). */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;

  function Page(props) {
    return h('main', { className: 'kc-main' },
      h('div', { className: 'kc-head' },
        h('div', { className: 'kc-head-text' },
          h(KLAI.Overline, { label: props.overline, as: 'div' }),
          h('h1', { className: 'kc-h1' }, props.title),
          props.meta ? h('div', { className: 'kc-meta' }, props.meta) : null),
        props.actions || null),
      h('div', { className: 'kc-rule' }),
      props.children);
  }
  KC.Page = Page;

  function Offline() {
    var api = KC.Store.use().api;
    return h('div', { className: 'kc-blank' }, h('p', null, 'Gateway Hermes injoignable.'),
      h('div', null, h(KLAI.Button, { size: 'sm', icon: 'refresh', onClick: function () { api.refresh(true); } }, 'Reconnecter')));
  }

  /* ---------------- Tâches planifiées ---------------- */
  function jobState(j) {
    if (j.paused) return { status: 'idle', label: 'En pause' };
    if (/fail|error/i.test(j.lastStatus)) return { status: 'error', label: 'Échec' };
    if (/running/i.test(j.state)) return { status: 'running', label: 'En cours' };
    return { status: 'done', label: 'Active' };
  }

  function JobForm(props) {
    var j = props.job || {};
    var f = React.useState({ name: j.name || '', prompt: j.prompt || '', schedule: j.schedule || '' }), form = f[0], setForm = f[1];
    function set(k, v) { var n = Object.assign({}, form); n[k] = v; setForm(n); }
    return h('form', { className: 'kc-form', style: { padding: 'var(--space-6) 0', borderBottom: '1px solid var(--line)' },
      onSubmit: function (e) { e.preventDefault(); if (form.prompt.trim() && form.schedule.trim()) props.onSave(form); } },
      h(KC.Field, { label: 'Nom' }, h('input', { className: 'kc-input', value: form.name, onChange: function (e) { set('name', e.target.value); }, autoFocus: true })),
      h(KC.Field, { label: 'Consigne', hint: 'Ce que Hermes doit faire à chaque exécution.' },
        h('textarea', { className: 'kc-textarea', value: form.prompt, onChange: function (e) { set('prompt', e.target.value); } })),
      h(KC.Field, { label: 'Planification', hint: 'Même syntaxe que « hermes cron » : expression cron (30 8 * * 1-5) ou intervalle (every 2h).' },
        h('input', { className: 'kc-input is-mono', value: form.schedule, onChange: function (e) { set('schedule', e.target.value); }, placeholder: '30 8 * * 1-5' })),
      h('div', { className: 'kc-row-actions' },
        h(KLAI.Button, { variant: 'primary', size: 'sm', type: 'submit', icon: 'check' }, props.job ? 'Enregistrer' : 'Créer la tâche'),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: props.onCancel }, 'Annuler')));
  }

  function Jobs() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var e = React.useState(null), editing = e[0], setEditing = e[1];
    var B = KC.bridge;
    var jobs = state.jobs;
    if (state.backend && !state.backend.ok) return h(Page, { overline: 'Tâches planifiées', title: 'Routines de l’agent' }, h(Offline));

    function act(j, action, label) {
      B.hermes.jobAction(j.id, action).then(function (r) {
        api.toast(r.ok ? label : 'Échec : ' + r.error, r.ok ? 'info' : 'error');
        api.refresh(false);
      });
    }
    function save(form) {
      var body = { name: form.name, prompt: form.prompt, schedule: form.schedule };
      var p = editing && editing.id ? B.hermes.updateJob(editing.id, body) : B.hermes.createJob(body);
      p.then(function (r) {
        if (!r.ok) return api.toast('Échec : ' + r.error, 'error');
        setEditing(null); api.toast(editing && editing.id ? 'Tâche modifiée.' : 'Tâche créée.'); api.refresh(false);
      });
    }

    return h(Page, { overline: 'Tâches planifiées — ' + jobs.length, title: 'Routines de l’agent',
      meta: 'Exécutées par le planificateur du gateway Hermes, même quand le cockpit est fermé.',
      actions: h(KLAI.Button, { variant: 'primary', icon: 'plus', onClick: function () { setEditing({}); } }, 'Nouvelle tâche') },
      editing ? h(JobForm, { job: editing.id ? editing : null, onSave: save, onCancel: function () { setEditing(null); } }) : null,
      h('div', { className: 'kc-table' },
        h('div', { className: 'kc-tr is-head', style: { gridTemplateColumns: 'minmax(0, 2fr) 140px 150px 150px 110px 132px' } },
          h('span', null, 'Tâche'), h('span', null, 'Planification'), h('span', null, 'Prochaine'), h('span', null, 'Dernière'), h('span', null, 'État'), h('span', null, '')),
        jobs.length === 0 ? h('div', { className: 'kc-empty' }, 'Aucune tâche planifiée.') : null,
        jobs.map(function (j) {
          var st = jobState(j);
          return h('div', { key: j.id, className: 'kc-tr', style: { gridTemplateColumns: 'minmax(0, 2fr) 140px 150px 150px 110px 132px' } },
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              h('span', { className: 'kc-ellipsis', style: { fontWeight: 400 } }, j.name),
              h('span', { className: 'kc-meta kc-ellipsis', title: j.prompt }, j.prompt)),
            h('span', { className: 'kc-mono', style: { fontSize: '12px' } }, String(j.schedule)),
            h('span', { className: 'kc-meta' }, j.nextRun ? KC.fmtStamp(j.nextRun) : '—'),
            h('span', { className: 'kc-meta' }, j.lastRun ? KC.fmtAgo(j.lastRun) + (j.lastStatus ? ' · ' + j.lastStatus : '') : '—'),
            h(KLAI.StatusChip, { status: st.status, label: st.label }),
            h('span', { style: { display: 'flex', gap: '2px' } },
              h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { act(j, 'run', 'Exécution lancée.'); } }, 'Exécuter'),
              h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'more', iconOnly: true, label: 'Plus d’actions', onClick: function (ev) {
                ov.menu(ev, [
                  j.paused ? { label: 'Reprendre', run: function () { act(j, 'resume', 'Tâche reprise.'); } } : { label: 'Mettre en pause', run: function () { act(j, 'pause', 'Tâche en pause.'); } },
                  { label: 'Modifier…', run: function () { setEditing(j); } },
                  '-',
                  { label: 'Supprimer…', danger: true, run: function () {
                    ov.confirm({ title: 'Supprimer la tâche', text: '« ' + j.name + ' » sera supprimée du planificateur.', danger: true }).then(function (ok) {
                      if (ok) B.hermes.deleteJob(j.id).then(function (r) { api.toast(r.ok ? 'Tâche supprimée.' : 'Échec : ' + r.error, r.ok ? 'info' : 'error'); api.refresh(false); });
                    });
                  } }
                ]);
              } })));
        })));
  }

  /* ---------------- Capacités ---------------- */
  function Capabilities() {
    var ctx = KC.Store.use(), state = ctx.state;
    var d = React.useState(null), data = d[0], setData = d[1];
    var q = React.useState(''), query = q[0], setQuery = q[1];
    var t = React.useState('skills'), tab = t[0], setTab = t[1];
    React.useEffect(function () {
      if (!KC.bridge || !state.backend || !state.backend.ok) return;
      Promise.all([KC.bridge.hermes.skills(), KC.bridge.hermes.toolsets()]).then(function (r) { setData({ skills: r[0], toolsets: r[1] }); });
    }, [state.backend && state.backend.ok]);
    if (state.backend && !state.backend.ok) return h(Page, { overline: 'Capacités', title: 'Ce que Hermes sait faire' }, h(Offline));
    var qn = query.trim().toLowerCase();
    var skills = data && data.skills.ok ? data.skills.skills.filter(function (s) { return !qn || (s.name + ' ' + s.description + ' ' + s.category).toLowerCase().indexOf(qn) !== -1; }) : [];
    var toolsets = data && data.toolsets.ok ? data.toolsets.toolsets.filter(function (s) { return !qn || (s.name + ' ' + s.label + ' ' + s.description + ' ' + s.tools.join(' ')).toLowerCase().indexOf(qn) !== -1; }) : [];
    var byCat = {};
    skills.forEach(function (s) { (byCat[s.category] = byCat[s.category] || []).push(s); });

    return h(Page, { overline: 'Capacités', title: 'Ce que Hermes sait faire',
      meta: 'Compétences et jeux d’outils annoncés par le gateway (lecture seule ; installation via « hermes skills » ou Hermes Desktop).',
      actions: h('div', { style: { display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end' } },
        h('div', { style: { width: '240px' } }, h('label', { className: 'kl-search' }, h(KLAI.Icon, { name: 'search', size: 16 }),
          h('input', { type: 'search', placeholder: 'Filtrer', 'aria-label': 'Filtrer les capacités', value: query, onChange: function (e) { setQuery(e.target.value); } }))),
        h(KLAI.Segmented, { value: tab, onChange: setTab, label: 'Type', options: [{ value: 'skills', label: 'Compétences ' + skills.length }, { value: 'toolsets', label: 'Outils ' + toolsets.length }] })) },
      !data ? h('div', { className: 'kc-empty' }, 'Chargement…') : null,
      data && tab === 'skills' ? (data.skills.ok ? Object.keys(byCat).sort().map(function (cat) {
        return h('section', { key: cat, style: { padding: 'var(--space-6) 0 0' } },
          h(KLAI.Overline, { label: cat, count: byCat[cat].length }),
          h('div', { className: 'kc-table', style: { marginTop: 'var(--space-3)' } }, byCat[cat].map(function (s) {
            return h('div', { key: s.name, className: 'kc-tr', style: { gridTemplateColumns: '240px minmax(0, 1fr)' } },
              h('span', { className: 'kc-mono', style: { fontWeight: 400 } }, s.name), h('span', { className: 'kc-meta' }, s.description));
          })));
      }) : h('div', { className: 'kc-empty' }, 'Compétences indisponibles : ' + data.skills.error)) : null,
      data && tab === 'toolsets' ? (data.toolsets.ok ? h('div', { className: 'kc-table' }, toolsets.map(function (t) {
        return h('div', { key: t.name, className: 'kc-tr', style: { gridTemplateColumns: '200px minmax(0, 1fr) 140px' } },
          h('span', { style: { display: 'flex', flexDirection: 'column' } }, h('span', { style: { fontWeight: 400 } }, t.label), h('span', { className: 'kc-mono kc-subtle', style: { fontSize: '11px' } }, t.name)),
          h('span', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            t.description ? h('span', { className: 'kc-meta' }, t.description) : null,
            h('span', { className: 'kc-mono kc-muted', style: { fontSize: '11.5px' } }, t.tools.join(' · '))),
          h(KLAI.StatusChip, { status: t.enabled && t.configured ? 'done' : t.enabled ? 'attention' : 'idle', label: t.enabled ? (t.configured ? 'Actif' : 'À configurer') : 'Désactivé' }));
      })) : h('div', { className: 'kc-empty' }, 'Outils indisponibles : ' + data.toolsets.error)) : null);
  }

  /* ---------------- Messagerie ---------------- */
  function Messaging() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var list = state.sessions.filter(function (s) { return KC.MESSAGING.test(s.source || ''); });
    var byPlatform = {};
    list.forEach(function (s) { (byPlatform[KC.sourceLabel(s.source)] = byPlatform[KC.sourceLabel(s.source)] || []).push(s); });
    var platforms = Object.keys(byPlatform).sort();
    return h(Page, { overline: 'Messagerie — ' + list.length, title: 'Conversations des plateformes',
      meta: 'Sessions ouvertes par Telegram, Discord, Slack, WhatsApp, Signal… sur le gateway. Lecture seule ici : « Reprendre ici » dérive la conversation dans le cockpit.' },
      platforms.length === 0 ? h('div', { className: 'kc-blank' },
        h('p', null, 'Aucune conversation de messagerie. Les canaux se configurent avec « hermes gateway setup » ou dans Hermes Desktop (Messagerie).')) : null,
      platforms.map(function (p) {
        return h('section', { key: p, style: { padding: 'var(--space-6) 0 0' } },
          h(KLAI.Overline, { label: p, count: byPlatform[p].length }),
          h('div', { className: 'kc-table', style: { marginTop: 'var(--space-3)' } }, byPlatform[p].map(function (s) {
            var st = KC.sessionState(s, state.live[s.id]);
            return h('button', { key: s.id, type: 'button', className: 'kc-plain kc-tr', style: { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 120px 104px' },
              onClick: function () { api.open(s.id); }, onContextMenu: function (e) { ov.menu(e, KC.sessionMenu(ov, api, s)); } },
              h('span', { className: 'kc-ellipsis', style: { fontWeight: 400 } }, s.title),
              h('span', { className: 'kc-meta kc-ellipsis' }, s.preview || KC.shortPath(s.workspace)),
              h('span', { className: 'kc-meta' }, KC.fmtAgo(s.updated)),
              h(KLAI.StatusChip, { status: st.status, label: st.label }));
          })));
      }));
  }

  KC.Screens.Jobs = Jobs;
  KC.Screens.Capabilities = Capabilities;
  KC.Screens.Messaging = Messaging;
})(window);
