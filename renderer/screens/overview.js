/* Écran D′ — Vue d'ensemble : salutation, filtres, index numéroté des projets,
 * colonne « À traiter » (approbations, erreurs, réponses à relire), sous-agents, agenda. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;

  function Overview(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var groups = props.groups;
    var keep = {
      all: function () { return true; },
      live: function (g) { return g.live > 0; },
      todo: function (g) { return g.attention + g.errors > 0 || g.sessions.some(function (s) { return state.live[s.id] && state.live[s.id].unread; }); },
      idle: function (g) { return g.live === 0 && g.attention + g.errors === 0; }
    };
    var counts = { all: groups.length, live: groups.filter(keep.live).length, todo: groups.filter(keep.todo).length, idle: groups.filter(keep.idle).length };
    var filter = state.filter;
    var shown = groups.filter(keep[filter] || keep.all);
    var name = state.settings && state.settings.userName;
    var bk = state.backend;

    var head = h('div', { className: 'kc-head' },
      h('div', { className: 'kc-head-text' },
        h(KLAI.Overline, { label: 'Vue d’ensemble · ' + KC.today(), as: 'div' }),
        h(KLAI.Greeting, { name: name || undefined, size: 34 })),
      h(KLAI.Segmented, { label: 'Filtrer les projets', value: filter, onChange: function (v) { api.dispatch({ type: 'filter', value: v }); },
        options: [
          { value: 'all', label: 'Actifs ' + counts.all }, { value: 'live', label: 'En cours ' + counts.live },
          { value: 'todo', label: 'À traiter ' + counts.todo }, { value: 'idle', label: 'En veille ' + counts.idle }
        ] }));

    var body;
    if (bk && !bk.ok) {
      body = h('div', { className: 'kc-blank kc-rule' },
        h('h2', { className: 'kc-h2' }, 'Gateway Hermes injoignable'),
        h('p', null, bk.status === 401 ? 'Le gateway refuse la clé API. Vérifiez API_SERVER_KEY dans ~/.hermes/.env et dans les réglages.' :
          'Le cockpit n’a pas pu joindre ' + ((state.settings && state.settings.hermesBaseUrl) || 'le gateway') + ' (' + (bk.error || 'aucune réponse') + ').'),
        h('p', { className: 'kc-mono', style: { fontSize: '12px' } }, 'API_SERVER_ENABLED=true · API_SERVER_KEY=… · hermes gateway'),
        h('div', { className: 'kc-row-actions' },
          h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'refresh', onClick: function () { api.refresh(true); } }, 'Reconnecter'),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { api.navigate('settings'); } }, 'Réglages')));
    } else if (!state.loading && groups.length === 0) {
      body = h('div', { className: 'kc-blank kc-rule' },
        h('h2', { className: 'kc-h2' }, 'Aucune session pour l’instant'),
        h('p', null, 'Les sessions de toutes les surfaces Hermes (CLI, TUI, Desktop, messagerie) apparaîtront ici, regroupées par dossier de travail.'),
        h('div', { className: 'kc-row-actions' }, h(KLAI.Button, { variant: 'primary', size: 'sm', icon: 'plus', onClick: function () { api.newSession(); } }, 'Nouvelle session')));
    } else {
      body = h('div', { className: 'kc-index' },
        shown.length === 0 ? h('div', { className: 'kc-empty' }, 'Aucun projet dans ce filtre.') : null,
        shown.map(function (g, i) {
          var alert = g.errors ? { tone: 'danger', label: g.errors + ' erreur' + (g.errors > 1 ? 's' : '') }
            : g.attention ? { tone: 'attention', label: g.attention + ' élément' + (g.attention > 1 ? 's' : '') + ' à traiter' } : null;
          return h('section', { key: g.key, className: 'kc-index-item', style: i === 0 ? { borderTop: '1px solid var(--rule)' } : { borderTop: '1px solid var(--line)' } },
            h('div', { className: 'kc-index-num' }, g.num),
            h('div', { className: 'kc-index-id' },
              h('h2', { className: 'kc-h2' }, h('a', { href: '#', style: { color: 'var(--ink)', textDecoration: 'none' },
                onClick: function (e) { e.preventDefault(); api.open(g.sessions[0].id); } }, g.name)),
              h('div', { className: 'kc-index-path kc-ellipsis', title: g.path }, KC.shortPath(g.path) || '—'),
              h('div', { className: 'kc-meta', style: { marginTop: 'var(--space-2)' } },
                g.sessions.length + ' session' + (g.sessions.length > 1 ? 's' : '') + (g.last ? ' · ' + KC.fmtAgo(g.last) : '')),
              alert ? h('div', { style: { fontSize: '12px', color: 'var(--' + alert.tone + ')' } }, alert.label) : null,
              h('div', { className: 'kc-index-actions' },
                h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', onClick: function () { api.newSession(g); } }, 'Session'),
                h(KLAI.Button, { variant: 'ghost', size: 'sm', iconRight: 'steer', onClick: function () { api.open(g.sessions[0].id); } }, 'Ouvrir'))),
            h('div', { className: 'kc-index-sessions' },
              g.sessions.slice(0, 3).map(function (s) {
                var st = KC.sessionState(s, state.live[s.id]);
                return h('button', { key: s.id, type: 'button', className: 'kc-plain kc-sess-row',
                  onClick: function () { api.open(s.id); }, onContextMenu: function (e) { ov.menu(e, KC.sessionMenu(ov, api, s)); } },
                  h('span', { className: 'kc-sess-label kc-ellipsis' }, s.title),
                  h('span', { className: 'kc-sess-step kc-ellipsis' }, st.step),
                  h(KLAI.StatusChip, { status: st.status, label: st.label }));
              }),
              g.sessions.length > 3 ? h('button', { type: 'button', className: 'kc-link', style: { padding: '10px 0', textAlign: 'left' },
                onClick: function () { api.open(g.sessions[0].id); } }, '+ ' + (g.sessions.length - 3) + ' autres sessions') : null));
        }));
    }

    return h('main', { className: 'kc-main' }, head, body);
  }

  /* ---------------- Colonne « À traiter » ---------------- */
  function TodoAside(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var items = props.todo;
    var subs = props.subagents;
    var today = state.jobs.filter(function (j) {
      if (!j.nextRun || j.paused) return false;
      return new Date(j.nextRun).toDateString() === new Date().toDateString();
    }).sort(function (a, b) { return a.nextRun - b.nextRun; });

    return h('aside', { 'aria-label': 'À traiter', className: 'kc-aside' },
      h('section', { style: { display: 'flex', flexDirection: 'column' } },
        h(KLAI.Overline, { label: 'À traiter', count: items.length, style: { marginBottom: '12px' } }),
        items.length === 0 ? h('div', { className: 'kc-todo kc-meta' }, 'Rien en attente.') : null,
        items.map(function (t) {
          var s = t.session;
          if (t.kind === 'approval') {
            return h('div', { key: 'a' + t.approval.requestId, className: 'kc-todo', style: { borderTopColor: 'var(--rule)' } },
              h('div', { className: 'kc-todo-head' }, h(KLAI.StatusChip, { status: 'attention', label: 'Approbation' }), h('span', { className: 'kc-meta kc-ellipsis' }, t.group)),
              h('div', { className: 'kc-todo-title kc-ellipsis' }, s.title),
              t.approval.description ? h('div', { className: 'kc-meta' }, t.approval.description) : null,
              t.approval.command ? h('div', { className: 'kc-cmd' }, '$ ' + t.approval.command) : null,
              h('div', { className: 'kc-row-actions' },
                h(KLAI.Button, { variant: 'primary', size: 'sm', onClick: function () { api.approve(s.id, t.approval, 'once'); } }, 'Approuver'),
                h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { api.approve(s.id, t.approval, 'deny'); } }, 'Refuser'),
                h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { api.open(s.id); } }, 'Voir')));
          }
          if (t.kind === 'clarify') {
            return h('div', { key: 'c' + s.id, className: 'kc-todo' },
              h('div', { className: 'kc-todo-head' }, h(KLAI.StatusChip, { status: 'attention', label: 'Question' }), h('span', { className: 'kc-meta kc-ellipsis' }, t.group)),
              h('div', { className: 'kc-todo-title kc-ellipsis' }, s.title),
              h('div', { className: 'kc-meta' }, t.clarify.question),
              h('div', { style: { marginLeft: '-6px' } }, h(KLAI.Button, { variant: 'ghost', size: 'sm', iconRight: 'steer', onClick: function () { api.open(s.id); } }, 'Répondre')));
          }
          return h('div', { key: t.kind + s.id, className: 'kc-todo' },
            h('div', { className: 'kc-todo-head' },
              h(KLAI.StatusChip, { status: t.kind === 'error' ? 'error' : 'attention', label: t.kind === 'error' ? 'Erreur' : 'À relire' }),
              h('span', { className: 'kc-meta kc-ellipsis' }, t.group)),
            h('div', { className: 'kc-todo-title kc-ellipsis' }, s.title),
            h('div', { className: 'kc-meta' }, t.kind === 'error' ? (t.text || 'Le dernier tour a échoué.') : 'Session terminée, réponse non lue.'),
            h('div', { style: { marginLeft: '-6px' } }, h(KLAI.Button, { variant: 'ghost', size: 'sm', iconRight: 'steer', onClick: function () { api.open(s.id); } }, 'Ouvrir')));
        })),

      h('section', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' } },
        h(KLAI.Overline, { label: 'Sous-agents', count: subs.filter(function (x) { return x.status === 'running'; }).length }),
        subs.length === 0 ? h('div', { className: 'kc-meta' }, 'Aucun sous-agent actif.') : null,
        subs.slice(0, 6).map(function (w, i) {
          var running = w.status === 'running';
          return h('div', { key: i, className: 'kc-worker' },
            h('div', { className: 'kc-worker-line' },
              h('span', { className: 'kc-mono kc-ellipsis', style: { flex: 1 } }, w.name),
              h('span', { className: 'kc-muted kc-ellipsis', style: { maxWidth: '96px' } }, w.group),
              h('span', { className: 'kc-mono kc-muted' }, running ? KC.fmtDuration((Date.now() - w.at) / 1000) : KC.subStatus(w.status))),
            running ? h('div', { className: 'kc-progress-indet', role: 'progressbar', 'aria-label': w.name + ', en cours' })
              : h(KLAI.ProgressLine, { value: 100, label: w.name + ', terminé' }));
        })),

      h('section', { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', marginBottom: 'var(--space-3)' } },
          h(KLAI.Overline, { label: 'Aujourd’hui', style: { flex: 1 } }),
          h('button', { type: 'button', className: 'kc-link', style: { fontSize: '12px' }, onClick: function () { api.navigate('jobs'); } }, 'Tout voir')),
        today.length === 0 ? h('div', { className: 'kc-agenda kc-meta' }, 'Aucune tâche planifiée aujourd’hui.') : null,
        today.map(function (j) {
          return h('div', { key: j.id, className: 'kc-agenda' },
            h('span', { className: 'kc-mono kc-muted' }, KC.fmtTime(j.nextRun)),
            h('span', { className: 'kc-ellipsis', style: { flex: 1, fontWeight: 400 } }, j.name),
            j.profile ? h('span', { className: 'kc-muted' }, j.profile) : null);
        })));
  }

  KC.Screens = KC.Screens || {};
  KC.Screens.Overview = Overview;
  KC.Screens.TodoAside = TodoAside;
})(window);
