/* KostoLabs AI — Cockpit Hermes · renderer
 * Deux écrans : Vue d'ensemble et Projet, portés des maquettes de référence.
 * Tant que la couche Hermes n'est pas branchée, les données sont des mocks
 * regroupés dans `data` ; tout est prêt à être remplacé par l'état réel.
 */
(function (global) {
  'use strict';
  var React = global.React;
  var h = React.createElement;
  var KLAI = global.KLAI;

  /* ============================ Données (mocks) ============================ */
  var chipMap = {
    'En cours': ['running', 'En cours'],
    'Approbation': ['attention', 'Approbation'],
    'Terminée': ['done', 'Terminée'],
    'Erreur': ['error', 'Erreur']
  };
  function sess(label, state, step) {
    var c = chipMap[state];
    return { label: label, step: step, status: c[0], chip: c[1] };
  }

  var PROJECTS = [
    { name: 'Koordo', init: 'KO', path: '~/Developer/koordo · main', live: 2, alert: 1, alertTone: 'attention',
      alertLabel: '1 à relire', meta: '6 sessions · 2 worktrees',
      sessions: [
        sess('Recette Preprod App', 'En cours', '12 tests · 2 échecs en correction'),
        sess('Créer EARS pour enregist…', 'En cours', 'Rédaction des exigences 4/9'),
        sess('Proposer une organisation…', 'Terminée', 'Plan en 3 lots prêt à relire')] },
    { name: 'GusAI', init: 'GU', path: '~/Developer/gusai · main', live: 1, alert: 0, alertTone: 'neutral',
      alertLabel: '', meta: '4 sessions',
      sessions: [
        sess("Corriger les tests d'intégration", 'En cours', 'Étape 2/5 · relance de la suite'),
        sess('Mettre à jour les dépendances', 'Terminée', 'Branche prête à fusionner')] },
    { name: 'GenRes', init: 'GR', path: '~/Developer/genres · main', live: 2, alert: 0, alertTone: 'neutral',
      alertLabel: '', meta: '5 sessions · 1 worktree',
      sessions: [
        sess('Pipeline géno-phénotype', 'En cours', 'Étape 4/7 · associations variants–phénotypes'),
        sess('Entraîner le modèle spécialisé', 'En cours', 'Époque 2/5 · évaluation en cours'),
        sess('Revue de littérature', 'Terminée', 'Synthèse prête à relire')] },
    { name: 'Accueil', init: 'AC', path: '~/qhaddouche', live: 1, alert: 1, alertTone: 'attention',
      alertLabel: '1 approbation', meta: '18 sessions',
      sessions: [
        sess('Retrouver secrets PREP…', 'En cours', 'Étape 3/8 · parcourt les fichiers .env'),
        sess('Connecter Apple Remote…', 'Approbation', 'Attend votre accord pour une commande'),
        sess('Première analyse juridique', 'Terminée', '6 priorités avant signature')] },
    { name: 'actions-runner', init: 'AR', path: '~/actions-runner', live: 0, alert: 1, alertTone: 'danger',
      alertLabel: '1 erreur', meta: '2 sessions',
      sessions: [sess('Mettre à jour le runner', 'Erreur', "Backend d'inférence indisponible")] },
    { name: 'Algorand Studio', init: 'AS', path: '~/Algorand Studio', live: 0, alert: 0, alertTone: 'neutral',
      alertLabel: '', meta: '1 session', sessions: [] }
  ];

  var NAV = [
    { icon: 'grid', label: "Vue d'ensemble", route: 'overview' },
    { icon: 'bot', label: 'Bots' },
    { icon: 'capabilities', label: 'Capacités' },
    { icon: 'chat', label: 'Messagerie', count: '2' },
    { icon: 'artifact', label: 'Artefacts' },
    { icon: 'clock', label: 'Tâches planifiées', count: '3' },
    { icon: 'terminal', label: 'Terminal' }
  ];

  var WORKERS = [
    { name: 'veille-jurisprudence', project: 'Accueil', prog: '3/8', width: '38%' },
    { name: 'tests-preprod', project: 'Koordo', prog: '5/12', width: '42%' }
  ];

  var TODO = [
    { chip: ['attention', 'Approbation'], project: 'Accueil', title: 'Connecter Apple Remote…',
      command: 'ssh-add ~/.ssh/id_remote',
      actions: [['primary', 'check', 'Approuver'], ['danger', null, 'Refuser'], ['ghost', null, 'Voir']] },
    { chip: ['error'], project: 'actions-runner', title: 'Mettre à jour le runner',
      note: "Backend d'inférence indisponible. La session reprendra à la reconnexion.",
      actions: [['secondary', 'refresh', 'Reconnecter']] },
    { chip: ['attention', 'À relire'], project: 'Koordo', title: 'Proposer une organisation…',
      note: 'Session terminée, réponse non lue.',
      actions: [['secondary', null, 'Ouvrir']] }
  ];

  /* ============================ Données réelles (gateway Hermes) ============================ */

  function fmtAgo(ts) {
    if (!ts) return '';
    var ms = ts > 1e12 ? ts : ts * 1000;
    var mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return 'à l’instant';
    if (mins < 60) return 'il y a ' + mins + ' min';
    var h = Math.round(mins / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }

  function shortWorkspace(ws) {
    if (!ws) return 'Sans espace';
    var parts = String(ws).replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || String(ws);
  }

  /* Groupe les sessions Hermes par projet (project_id) puis par espace de travail. */
  function groupRealSessions(sessions, projects) {
    var byKey = {}, groups = [], projById = {};
    (projects || []).forEach(function (p) { if (p && p.id) projById[p.id] = p; });
    sessions.forEach(function (s) {
      if (!s.id) return;
      var proj = s.projectId && projById[s.projectId];
      var key = proj ? 'p:' + proj.id : 'w:' + (s.workspace || '');
      if (!byKey[key]) {
        var label = proj ? proj.name : shortWorkspace(s.workspace);
        byKey[key] = {
          name: label,
          init: label.slice(0, 2).toUpperCase(),
          path: s.workspace || 'Session sans espace de travail',
          isProject: !!proj,
          sessions: []
        };
        groups.push(byKey[key]);
      }
      byKey[key].sessions.push(s);
    });
    groups.forEach(function (g) {
      g.live = g.sessions.filter(function (s) { return s.streaming; }).length;
      g.alertCount = g.sessions.filter(function (s) { return s.attention; }).length;
      g.last = g.sessions.reduce(function (m, s) { return Math.max(m, s.updated || 0); }, 0);
      g.sessions.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    });
    groups.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    return groups;
  }

  function sessionChip(s) {
    if (s.attention) return { status: 'attention', chip: 'À traiter' };
    if (s.streaming) return { status: 'running', chip: 'En cours' };
    return { status: 'done', chip: 'Inactive' };
  }

  /* ============================ Pièces communes ============================ */

  function TopBar(props) {
    var searchWrap = React.useRef(null);
    React.useEffect(function () {
      if (!searchWrap.current) return;
      var input = searchWrap.current.querySelector('input');
      if (!input) return;
      if (props.searchInputRef) props.searchInputRef.current = input;
      var onInput = function () { if (props.onSearch) props.onSearch(input.value); };
      input.addEventListener('input', onInput);
      return function () { input.removeEventListener('input', onInput); };
    }, []);
    return h('header', {
      style: { height: '84px', flex: 'none', display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-3)', padding: '0 var(--space-4) 0 28px' }
    },
      h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onNavigate('overview'); },
        'aria-label': 'KostoLabs AI, vue d’ensemble', style: { flex: '0 0 226px', display: 'flex', textDecoration: 'none' } },
        h(KLAI.Logo, { size: 19 })),
      h('div', { style: { flex: '1', minWidth: '220px', display: 'flex', justifyContent: 'center' } },
        h('div', { ref: searchWrap, style: { width: '100%', maxWidth: '460px' } },
          h(KLAI.SearchField, { placeholder: 'Aller à un projet, une session…', shortcut: '⌘K', style: { width: '100%' } }))),
      h(KLAI.Button, { variant: 'primary', icon: 'plus', onClick: props.onNewSession }, 'Nouvelle session'),
      h(KLAI.Button, { variant: 'ghost', icon: 'settings', iconOnly: true, label: 'Réglages', onClick: props.onOpenSettings }));
  }

  function SideNav(props) {
    var current = props.route;
    return h('nav', { 'aria-label': 'Navigation',
      style: { flex: '0 0 244px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', height: '100%', minHeight: 0 } },
      h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px' } },
        NAV.map(function (n) {
          var active = n.route && n.route === current;
          return h('div', {
            key: n.label,
            onClick: n.route ? function (e) { e.preventDefault(); props.onNavigate(n.route); } : undefined,
            style: { cursor: n.route ? 'pointer' : 'default' }
          }, h(KLAI.NavItem, { icon: n.icon, label: n.label, active: active,
            count: active && current === 'overview' ? String(props.todoCount || 0) : (n.count || ''),
            countTone: active ? 'attention' : 'neutral' }));
        })),
      h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minHeight: 0, overflowY: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', padding: '0 var(--space-1) var(--space-1) 10px' } },
          h('span', { style: { flex: '1', fontSize: '12px', fontWeight: 500, color: 'var(--ink-muted)' } },
            props.demo ? 'Projets factices (démo)' : 'Projets actifs · ' + (props.groups ? props.groups.length : 0)),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Ajouter un projet', onClick: props.onNewProject })),
        (props.groups || []).map(function (p) {
          var open = props.activeGroupName === p.name && props.route === 'project';
          var tone = open ? 'ink' : (p.live > 0 ? 'strong' : 'outline');
          return h('a', { key: p.name, href: '#',
            'aria-current': open ? 'page' : undefined,
            onClick: function (e) { e.preventDefault(); if (props.onOpenGroup) props.onOpenGroup(p); },
            style: { display: 'flex', alignItems: 'center', gap: '10px', height: '40px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-sm)', textDecoration: 'none', color: 'var(--ink)',
              background: open ? 'var(--surface-muted)' : 'transparent' } },
            h(KLAI.ProjectAvatar, { initials: p.init, tone: tone }),
            h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 } }, p.name),
            p.live > 0 ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--ink-muted)' } },
              h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ink)' } }), String(p.live)) : null,
            p.alertCount > 0 ? h(KLAI.Badge, { tone: 'attention', label: String(p.alertCount) }) : null);
        }),
        h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onNavigate('overview'); }, style: { fontSize: '12.5px', padding: '6px 10px', color: 'var(--ink-muted)', textDecoration: 'none' } }, 'Tous les projets'),
        h('div', { style: { flex: '1' } }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 10px 0', borderTop: '1px solid var(--line)', fontSize: '11.5px', color: 'var(--ink-muted)' } },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
            h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ink)' } }), (props.liveCount || 0) + ' en cours'),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
            h(KLAI.Badge, { tone: 'attention', label: String(props.todoCount || 0) }), 'à traiter'))));
  }

  function StatusBar(props) {
    var bk = props.backend; // null = pas encore sondé, {ok:true,models:[…]} ou {ok:false,error}
    var up = bk && bk.ok === true;
    var prefix = up
      ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-muted)', fontWeight: 500 } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ink)' } }),
          'Backend Hermes connecté' + (bk.models && bk.models.length ? ' · ' + bk.models.length + ' modèles' : ''))
      : h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--attention)', fontWeight: 500 } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--attention)' } }),
          bk ? 'Backend d’inférence indisponible' : 'Recherche du backend Hermes…');
    return h('footer', { style: { height: '32px', flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '0 var(--space-4) 0 28px', fontSize: '12px', color: 'var(--ink-muted)', overflowX: 'auto', whiteSpace: 'nowrap', borderTop: '1px solid var(--line)' } },
      prefix,
      !up ? h('a', { href: '#', onClick: function (e) { e.preventDefault(); if (props.onRetry) props.onRetry(); }, style: { fontWeight: 500, color: 'var(--ink)' } }, 'Reconnecter') : null,
      h('div', { style: { flex: '1' } }),
      props.route === 'project' ? h('span', null, 'Projet : ' + (props.projectName || '—')) : null,
      props.route === 'project' ? h('span', null, (props.todoCount || 0) + ' à traiter') : h('span', null, (props.liveCount || 0) + ' session(s) en cours'),
      props.sessionId ? h('span', { style: { fontFamily: 'var(--font-mono)' } }, String(props.sessionId).slice(0, 7)) : null);
  }

  /* ============================ Écran : vue d'ensemble ============================ */

  function OverviewScreen(props) {
    var filter = props.filter;
    var groups = props.groups || [];
    var keep = {
      all: function () { return true; },
      live: function (g) { return g.live > 0; },
      todo: function (g) { return g.alertCount > 0; },
      idle: function (g) { return g.live === 0 && g.alertCount === 0; }
    };
    var q = String(props.search || '').trim().toLowerCase();
    var cards = groups.filter(keep[filter] || keep.all).filter(function (g) {
      if (!q) return true;
      if (String(g.name).toLowerCase().indexOf(q) !== -1) return true;
      return (g.sessions || []).some(function (s) { return String(s.title || s.label || '').toLowerCase().indexOf(q) !== -1; });
    });
    var nLive = groups.reduce(function (n, g) { return n + g.live; }, 0);
    var nSessions = groups.reduce(function (n, g) { return n + g.sessions.length; }, 0);
    var nTodo = groups.reduce(function (n, g) { return n + g.alertCount; }, 0);
    var filters = [
      { value: 'all', label: 'Actifs · ' + groups.length },
      { value: 'live', label: 'En cours · ' + nLive },
      { value: 'todo', label: 'À traiter · ' + nTodo },
      { value: 'idle', label: 'En veille · ' + groups.filter(keep.idle).length }
    ];
    var loading = props.loading;
    return h('main', { style: { flex: '999 1 520px', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap', padding: 'var(--space-1) var(--space-1) 0' } },
        h('div', { style: { flex: '1', minWidth: '220px' } },
          h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '26px', lineHeight: '32px', fontWeight: 300, letterSpacing: '-0.01em' } }, 'Vue d’ensemble'),
          h('p', { style: { margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-muted)' } },
            loading ? 'Chargement des sessions Hermes…'
            : props.demo ? 'Sans connexion au gateway : données de démonstration'
            : nSessions + ' sessions · ' + groups.length + ' espaces · ' + nTodo + ' éléments à traiter')),
        h(KLAI.Segmented, { options: filters, value: filter, onChange: props.onFilter, label: 'Filtrer les projets' })),
      cards.length === 0 && !loading ? h('div', { style: { background: 'var(--surface)', border: '1px dashed var(--line-control)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: '13px' } },
        'Aucun projet dans ce filtre.', h('br'), null,
        props.demo ? 'Lancez « hermes gateway » puis Reconnecter pour voir vos sessions réelles.' : 'Ajustez le filtre ou créez une session.') : null,
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' } },
        cards.map(function (g) {
          var open = function () { if (props.onOpenGroup) props.onOpenGroup(g); };
          return h('section', { key: g.name, style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h(KLAI.ProjectAvatar, { initials: g.init, tone: g.live > 0 ? 'strong' : 'outline', size: 32 }),
              h('div', { style: { flex: '1', minWidth: 0 } },
                h('h2', { style: { margin: 0, fontSize: '15px', lineHeight: '22px', fontWeight: 600 } },
                  h('a', { href: '#', onClick: function (e) { e.preventDefault(); open(); }, style: { color: 'var(--ink)', textDecoration: 'none' } }, g.name)),
                h('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.path)),
              g.alertCount > 0 ? h(KLAI.Badge, { tone: 'attention', label: g.alertLabel || String(g.alertCount) }) : null),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1' } },
              g.sessions.slice(0, 4).map(function (s) {
                var chip = s.chipData ? s.chipData : (s.streaming !== undefined ? sessionChip(s) : null);
                var step = s.step !== undefined ? s.step
                  : (String(s.messageCount || 0) + ' messages · ' + fmtAgo(s.updated) + (s.model ? ' · ' + s.model : ''));
                return h('a', { key: s.id || s.label, href: '#',
                  onClick: function (e) { e.preventDefault(); if (s.id && props.onOpenSession) props.onOpenSession(s, g); else open(); },
                  style: { display: 'flex', flexDirection: 'column', gap: '3px', padding: 'var(--space-2) 10px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', textDecoration: 'none', color: 'var(--ink)' } },
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' } },
                    h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, fontSize: '13px' } }, s.label || s.title),
                    chip ? h(KLAI.StatusChip, { status: chip.status, label: chip.chip }) : null),
                  h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, step));
              }),
              g.sessions.length === 0 ? h('div', { style: { flex: '1', minHeight: '90px', border: '1px dashed var(--line-control)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-3)', fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune session active' + (g.last ? ', dernière activité ' + fmtAgo(g.last) : '')) : null),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' } },
              h(KLAI.Button, { size: 'sm', icon: 'plus', onClick: function () { if (props.onNewSessionInGroup) props.onNewSessionInGroup(g); } }, 'Session'),
              h('span', { style: { flex: '1', minWidth: 0, fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                props.demo ? (g.meta || '') : g.sessions.length + (g.sessions.length > 1 ? ' sessions' : ' session') + (g.last ? ' · ' + fmtAgo(g.last) : '')),
              h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: open }, 'Ouvrir')));
        })));
  }

  function TodoPanel(props) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--line)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px', color: 'var(--ink-muted)' } },
        h(KLAI.StatusChip, { status: props.item.chip[0], label: props.item.chip[1] }), props.item.project),
      h('div', { style: { fontWeight: 500 } }, props.item.title),
      props.item.command ? h('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--surface-muted)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) 10px', overflowX: 'auto', whiteSpace: 'nowrap' } }, props.item.command) : null,
      props.item.note ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, props.item.note) : null,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        props.item.actions.map(function (a) {
          return h(KLAI.Button, { key: a[2], variant: a[0], icon: a[1] || undefined, size: 'sm' }, a[2]);
        })));
  }

  function ActivityAside(props) {
    if (props.route === 'project') {
      var tools = props.demo ? [
        { tool: 'read_file', arg: 'contrat_actual_v3.pdf', t: '4.2s' },
        { tool: 'web_search', arg: 'CNIL sous-traitance paie', t: '6.8s' },
        { tool: 'diff_docs', arg: 'annexes 2 ↔ 4', t: '7.1s' }
      ] : (props.tools || []).map(function (t) {
        return { tool: t.name || 'outil', arg: t.preview || '', t: t.error ? 'erreur' : 'ok' };
      });
      var elsewhere = props.demo ? [
        ['Recette Preprod App', 'Koordo', '2 échecs en correction', 'running', 'KO'],
        ['Pipeline géno-phénotype', 'GenRes', 'étape 4/7', 'running', 'GR'],
        ["Corriger les tests d'intégration", 'GusAI', 'étape 2/5', 'running', 'GU'],
        ['Mettre à jour le runner', 'actions-runner', 'backend indisponible', 'error', 'AR']
      ] : (props.liveOthers || []).map(function (x) {
        return { title: x.session.title, sub: x.groupName || '', meta: (x.session.messageCount || 0) + ' messages', status: 'running', init: String(x.groupName || '??').slice(0, 2).toUpperCase(), session: x.session, group: x.group };
      });
      return h('aside', { 'aria-label': 'Activité', style: props.asideStyle },
        h(KLAI.Panel, null,
          h(KLAI.ContextMeter, { label: 'Contexte de la session', value: props.demo ? '76k / 200k' : ((props.contextPct || 0) + ' %'),
            segments: props.demo ? [{ label: 'Fichiers', percent: 18 }, { label: 'Conversation', percent: 12 }, { label: 'Mémoire', percent: 8 }] : [] })),
        h(KLAI.Panel, { title: 'Outils de ce tour', meta: tools.length ? String(tools.length) : '' },
          tools.length === 0
            ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucun outil appelé pour l’instant.')
            : tools.map(function (t) {
            return h('div', { key: t.tool + t.arg, style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12.5px' } },
              h('span', { style: { width: '22px', height: '22px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: t.t === 'erreur' ? 'var(--danger)' : 'var(--ink)' } },
                h(KLAI.Icon, { name: t.t === 'erreur' ? 'close' : 'check', size: 14 })),
              h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                h('span', { style: { fontFamily: 'var(--font-mono)' } }, t.tool), ' ', h('span', { style: { color: 'var(--ink-muted)' } }, t.arg)),
              h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)' } }, t.t));
          })),
        h(KLAI.Panel, { title: 'Ailleurs dans vos projets', actionLabel: "Vue d'ensemble", actionHref: '#' },
          elsewhere.length === 0
            ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune autre session en cours.')
            : elsewhere.map(function (e) {
            var real = !props.demo && e.session;
            return h('a', { key: e.title || e[0], href: '#', onClick: function (ev) { ev.preventDefault(); if (real && props.onOpenSession) props.onOpenSession(e.session, e.group); },
              style: { display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'var(--ink)' } },
              h(KLAI.ProjectAvatar, { initials: e.init || e[4] }),
              h('span', { style: { flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' } },
                h('span', { style: { fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.title || e[0]),
                h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (e.sub || e[1]) + ' · ' + (e.meta || e[2]))),
              h(KLAI.StatusChip, { status: e.status || e[3] }));
          })));
    }
    var approvals = props.approvals || [];
    var todo = props.demo ? [] : (props.todoItems || []);
    var live = props.demo ? [] : (props.liveItems || []);
    var jobs = props.jobs || [];
    return h('aside', { 'aria-label': 'À traiter', style: props.asideStyle },
      h(KLAI.Panel, { title: 'À traiter', meta: String(approvals.length + todo.length) },
        props.demo
          ? TODO.map(function (t) { return h(TodoPanel, { key: t.title, item: t }); })
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
              approvals.map(function (a) {
                return h('div', { key: 'ap' + a.runId + ':' + a.requestId, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--line)' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px', color: 'var(--ink-muted)' } },
                    h(KLAI.StatusChip, { status: 'attention', label: 'Approbation' }), a.sessionTitle || ''),
                  h('div', { style: { fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: '12px', wordBreak: 'break-all' } }, a.command || a.description || 'Commande à valider'),
                  h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                    h(KLAI.Button, { variant: 'primary', icon: 'check', size: 'sm', onClick: function () { props.onApprove(a, 'once'); } }, 'Approuver'),
                    h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { props.onApprove(a, 'deny'); } }, 'Refuser')));
              }),
              todo.map(function (t) {
                return h('div', { key: 'td' + t.session.id, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--line)' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px', color: 'var(--ink-muted)' } },
                    h(KLAI.StatusChip, { status: 'attention', label: 'À traiter' }), t.groupName || ''),
                  h('div', { style: { fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, t.session.title),
                  h('div', { style: { display: 'flex', gap: '6px' } },
                    h(KLAI.Button, { variant: 'secondary', size: 'sm', onClick: function () { props.onOpenSession(t.session, t.group); } }, 'Ouvrir')));
              }),
              approvals.length === 0 && todo.length === 0
                ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Rien à traiter.') : null)),
      h(KLAI.Panel, { title: 'Sessions en cours', meta: String(live.length) },
        props.demo
          ? WORKERS.map(function (w) {
          return h('div', { key: w.name, style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' } },
              h('span', { style: { fontFamily: 'var(--font-mono)', flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.name),
              h('span', { style: { color: 'var(--ink-muted)' } }, w.project + ' · ' + w.prog)),
            h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--surface-strong)', overflow: 'hidden' } },
              h('div', { style: { width: w.width, height: '100%', background: 'var(--ink)' } })));
        })
          : live.length === 0
            ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune session en cours.')
            : live.map(function (x) {
                return h('a', { key: x.session.id, href: '#', onClick: function (e) { e.preventDefault(); props.onOpenSession(x.session, x.group); },
                  style: { display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'var(--ink)', fontSize: '12.5px' } },
                  h(KLAI.StatusChip, { status: 'running' }),
                  h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 } }, x.session.title),
                  h('span', { style: { color: 'var(--ink-muted)', fontSize: '12px' } }, x.groupName || ''));
              })),
      h(KLAI.Panel, { title: 'Planifié', actionLabel: 'Tout voir' },
        props.demo
          ? [ ['08:30', 'Veille réglementaire', 'Accueil'], ['23:00', 'Recette nocturne', 'Koordo'] ].map(function (r) {
              return h('div', { key: r[0], style: { display: 'flex', gap: '10px', fontSize: '13px' } },
                h('span', { style: { fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' } }, r[0]),
                h('span', { style: { flex: '1' } }, r[1]),
                h('span', { style: { color: 'var(--ink-muted)' } }, r[2]));
            })
          : jobs.length === 0
            ? h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune tâche planifiée.')
            : jobs.map(function (j) {
                var when = j.nextRun ? fmtAgo(j.nextRun) : (j.schedule || '');
                return h('div', { key: j.id || j.name, style: { display: 'flex', gap: '10px', fontSize: '13px' } },
                  h('span', { style: { fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', whiteSpace: 'nowrap' } }, when),
                  h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, j.name),
                  j.enabled ? null : h('span', { style: { color: 'var(--ink-muted)' } }, 'en pause'));
              })));
  }
  /* ============================ Écran : projet ============================ */

  function ProjectHeader(props) {
    var s = props.session || {};
    return h('div', { style: { flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) 0', borderBottom: '1px solid var(--line)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' } },
        h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onNavigate('overview'); }, style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Vue d’ensemble'),
        h('span', { style: { color: 'var(--ink-subtle)' } }, '/'),
        h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '22px', lineHeight: '28px', fontWeight: 300 } }, s.title || (props.group ? props.group.name : 'Session')),
        s.workspace ? h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)' } }, s.workspace) : null,
        s.readOnly ? h(KLAI.Badge, { tone: 'attention', label: 'Lecture seule' }) : null,
        h('div', { style: { flex: '1' } }),
        h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)' } },
          (s.messageCount || 0) + ' messages' + (s.model ? ' · ' + s.model : '')),
        h(KLAI.Button, { size: 'sm', icon: 'split', onClick: props.onFork ? function () { props.onFork(); } : undefined }, 'Côte à côte')),
      h('div', { role: 'tablist', 'aria-label': 'Sessions ouvertes', style: { display: 'flex', gap: '2px', overflowX: 'auto' } },
        h('button', { role: 'tab', type: 'button', 'aria-selected': true,
          style: { display: 'flex', alignItems: 'center', gap: '8px', height: '42px', padding: '0 12px', fontFamily: 'var(--font-sans)', fontSize: '13px', flex: 'none', background: 'transparent', border: 0, borderBottom: '2px solid var(--ink)', color: 'var(--ink)', fontWeight: 600 } },
          h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' } }, s.title || 'Session'),
          h(KLAI.StatusChip, { status: s.streaming ? 'running' : 'done', label: s.streaming ? 'En cours' : 'Inactive' })),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Nouvelle session' })));
  }

  function TimelineRail(props) {
    var count = Math.max(1, Number(props.count) || 1);
    var marks = [];
    for (var i = 1; i <= count; i++) marks.push(i === count ? 'Message actuel' : 'Message ' + i);
    return h('div', { role: 'navigation', 'aria-label': 'Chronologie des messages',
      style: { flex: '0 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-6) 0', gap: '14px', borderRight: '1px solid var(--line)' } },
      marks.map(function (m, i) {
        var on = i === marks.length - 1;
        return h('button', { key: m, type: 'button', 'aria-label': m,
          style: { width: '10px', height: '10px', padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', background: on ? 'var(--ink)' : 'var(--line-control)', boxShadow: on ? '0 0 0 4px var(--surface-strong)' : 'none' } });
      }));
  }

  function ChatBody(props) {
    var messages = props.messages || [];
    var loading = !!props.loading;
    var colStyle = { maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', lineHeight: '24px', fontSize: '15px' };
    return h('div', { style: { flex: '1', minWidth: 0, overflowY: 'auto', padding: 'var(--space-6)' } },
      h('div', { style: colStyle },
        loading ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px', color: 'var(--ink-muted)' } },
          h(KLAI.StatusChip, { status: 'running' }), 'Chargement de l’historique Hermes…') : null,
        !loading && messages.length === 0 ? h('div', { style: { background: 'var(--surface)', border: '1px dashed var(--line-control)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: '13px' } },
          'Aucun message dans cette session pour l’instant.', h('br'), null,
          props.readOnly ? 'Ouvrez-la dans sa surface d’origine (CLI, TUI ou bureau) pour écrire.' : 'Envoyez une première tâche dans le composer ci-dessous.') : null,
        messages.map(function (m, i) {
          if (m.who === 'user') {
            return h('div', { key: 'm' + i, style: { alignSelf: 'flex-end', background: 'var(--inverse)', color: 'var(--on-inverse)', borderRadius: '14px 14px 4px 14px', padding: '10px 14px', maxWidth: '80%' } }, m.text);
          }
          return h('div', { key: 'm' + i, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
            h('div', { style: { whiteSpace: 'pre-wrap' } },
              m.text,
              m.error ? h('span', { style: { color: 'var(--danger)' } }, m.error) : null,
              m.streaming ? h('span', { className: 'kl-live-cursor', style: { display: 'inline-block', width: '7px', height: '16px', background: 'var(--ink)', borderRadius: '2px', marginLeft: '3px', verticalAlign: 'text-bottom', animation: 'kl-blink 1s steps(1) infinite' } }) : null),
            m.streaming ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12.5px', color: 'var(--ink-muted)' } },
              h(KLAI.StatusChip, { status: 'running' }), 'Hermes travaille…') : null);
        })));
  }

  function SubAgentBar(props) {
    if (!props.visible) return null;
    return h('div', { style: { maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface-muted)' } },
      h('span', { style: { fontSize: '12px', fontWeight: 500, color: 'var(--ink-muted)' } }, 'Hermes'),
      h(KLAI.StatusChip, { status: 'running' }),
      h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', flex: '1', minWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.label || 'tour en cours…'),
      h(KLAI.Button, { variant: 'danger', size: 'sm', icon: 'stop', iconOnly: true, label: 'Arrêter', onClick: props.onStop }));
  }

  function Composer(props) {
    var text = React.useState('');
    var value = text[0], setValue = text[1];
    var sending = !!props.sending;
    var readOnly = !!props.readOnly;
    function submit() {
      var v = value.trim();
      if (!v || sending || readOnly) return;
      setValue('');
      if (props.onSend) props.onSend(v);
    }
    return h('div', { style: { maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box', border: '1px solid ' + (readOnly ? 'var(--line)' : 'var(--line-control)'), borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', opacity: readOnly ? 0.65 : 1 } },
      h('label', { style: { display: 'block', padding: 'var(--space-3) 14px var(--space-1)' } },
        h('span', { style: { position: 'absolute', left: '-9999px' } }, 'Message'),
        h('textarea', { rows: 2, value: value, disabled: readOnly,
          placeholder: readOnly
            ? 'Session en lecture seule : écriture réservée à sa surface d’origine.'
            : sending ? 'Hermes réfléchit… (le composer reprend à la fin du tour)' : 'Donnez une tâche à Hermes…',
          onChange: function (e) { setValue(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } },
          style: { width: '100%', border: 0, outline: 0, resize: 'none', fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--ink)', background: 'transparent' } })),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px var(--space-2) var(--space-2)', flexWrap: 'wrap' } },
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Joindre un fichier' }),
        h(KLAI.Button, { size: 'sm', iconRight: 'chevron' }, props.model || 'hermes-agent'),
        h(KLAI.Button, { size: 'sm', iconRight: 'chevron' }, 'Ultra → Max'),
        h('div', { style: { flex: '1' } }),
        h(KLAI.Button, { variant: 'ghost', icon: 'mic', iconOnly: true, label: 'Conversation vocale' }),
        readOnly ? h(KLAI.Button, { variant: 'secondary' }, 'Lecture seule')
          : sending
            ? h(KLAI.Button, { variant: 'danger', icon: 'stop', iconOnly: true, label: 'Arrêter', onClick: props.onStop })
            : h(KLAI.Button, { variant: 'primary', icon: 'send', iconOnly: true, label: 'Envoyer', onClick: submit })));
  }

  var SESSION_ID_DEMO = 'cockpit-accueil';

  function ProjectScreen(props) {
    var session = props.session || null;
    var group = props.group || null;
    var hermes = global.klai && global.klai.hermes ? global.klai.hermes : null;
    var backendOk = props.backendOk === true;
    var sessionId = session ? session.id : null;
    var sessionRef = React.useRef(sessionId);
    sessionRef.current = sessionId;

    var m = React.useState(null); // null = chargement, [] une fois prêt
    var messages = m[0], setMessages = m[1];
    var s = React.useState(false);
    var sending = s[0], setSending = s[1];
    var ro = React.useState(false);
    var readOnly = ro[0] || (session ? !!session.readOnly : false), setReadOnly = ro[1];

    var mainStyle = { flex: '999 1 520px', minWidth: 0, height: '100%', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' };

    /* Historique réel de la session (GET /api/sessions/{id}/messages côté main). */
    React.useEffect(function () {
      setMessages(null);
      if (!sessionId || !hermes) { setMessages([]); return; }
      hermes.messages(sessionId).then(function (r) {
        setMessages(r && r.ok ? (r.messages || []) : []);
      }).catch(function () { setMessages([]); });
    }, [sessionId]);

    /* Événements SSE du tour en cours (delta, outils, approbations, fin). */
    React.useEffect(function () {
      if (!global.klai || !global.klai.onHermesEvent) return;
      return global.klai.onHermesEvent(function (ev) {
        if (!sessionRef.current || ev.session !== sessionRef.current) return;
        if (ev.type === 'delta' || ev.type === 'reasoning') {
          setMessages(function (prev) {
            var list = prev || [];
            var next = list.slice();
            var last = next[next.length - 1];
            if (last && last.who === 'assistant' && last.streaming) {
              next[next.length - 1] = Object.assign({}, last, { text: last.text + ev.text });
            } else {
              next.push({ who: 'assistant', text: ev.text, streaming: true });
            }
            return next;
          });
        }
        if (ev.type === 'done') {
          setMessages(function (prev) {
            var list = prev || [];
            var next = list.slice();
            var last = next[next.length - 1];
            if (last && last.streaming) next[next.length - 1] = Object.assign({}, last, { streaming: false });
            return next;
          });
          setSending(false);
          // Recharge l'historique canonique persisté par le gateway.
          if (hermes && sessionRef.current) {
            hermes.messages(sessionRef.current).then(function (r) {
              if (r && r.ok) setMessages(r.messages || []);
            }).catch(function () {});
          }
          if (props.onTurnEnd) props.onTurnEnd();
        }
        if (ev.type === 'notice') {
          setMessages(function (prev) {
            var next = (prev || []).slice();
            next.push({ who: 'assistant', text: '', error: ev.text || 'Remarque Hermes', streaming: false });
            return next;
          });
        }
        if (ev.type === 'readonly') {
          setReadOnly(true);
          setSending(false);
        }
        if (ev.type === 'cancelled') {
          setMessages(function (prev) {
            var next = (prev || []).slice();
            var last = next[next.length - 1];
            if (last && last.streaming) next[next.length - 1] = Object.assign({}, last, { streaming: false, text: last.text + ' [interrompu]' });
            return next;
          });
          setSending(false);
        }
        if (ev.type === 'error') {
          setMessages(function (prev) {
            var next = (prev || []).slice();
            var last = next[next.length - 1];
            if (last && last.streaming) next[next.length - 1] = Object.assign({}, last, { streaming: false, error: ev.text });
            else next.push({ who: 'assistant', text: '', error: ev.text, streaming: false });
            return next;
          });
          setSending(false);
        }
      });
    }, []);

    function handleSend(text) {
      setMessages(function (prev) { return (prev || []).concat([{ who: 'user', text: text }]); });
      setSending(true);
      if (hermes && backendOk && !readOnly && sessionRef.current) {
        hermes.send(sessionRef.current, text).catch(function () { setSending(false); });
      } else {
        // Mode démonstration (pas de backend joignable) : réponse factice.
        setMessages(function (prev) { return (prev || []).concat([{ who: 'assistant', text: '', streaming: true }]); });
        setTimeout(function () {
          setMessages(function (prev) {
            var next = (prev || []).slice();
            var last = next[next.length - 1];
            if (last && last.streaming) {
              next[next.length - 1] = Object.assign({}, last, {
                text: 'Mode démonstration : aucun gateway Hermes joignable. Lancez `hermes gateway` (API_SERVER_ENABLED=true dans ~/.hermes/.env) puis Reconnecter, ou créez une session depuis le cockpit.',
                streaming: false });
            }
            return next;
          });
          setSending(false);
        }, 700);
      }
    }

    function handleStop() {
      if (hermes && sessionRef.current) hermes.stop(sessionRef.current);
      setSending(false);
    }

    /* Projet ouvert sans session sélectionnée : état vide + création. */
    if (!session) {
      return h('main', { style: mainStyle },
        h('div', { style: { margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-6)' } },
          h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 300 } }, (group && group.name) || 'Projet'),
          h('p', { style: { margin: 0, fontSize: '13px', color: 'var(--ink-muted)' } }, 'Aucune session ouverte dans ce projet.'),
          h(KLAI.Button, { variant: 'primary', icon: 'plus', onClick: function () { if (props.onNewSession) props.onNewSession(group); } }, 'Créer une session')));
    }

    return h('main', { style: mainStyle },
      h(ProjectHeader, { onNavigate: props.onNavigate, session: session, group: group, onFork: props.onFork }),
      h('div', { style: { flex: '1', minHeight: 0, display: 'flex' } },
        h(TimelineRail, { count: (messages || []).length }),
        h(ChatBody, { messages: messages || [], loading: messages === null, readOnly: readOnly })),
      h('div', { style: { flex: 'none', padding: '0 var(--space-5) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
        readOnly ? h('div', { style: { maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box', fontSize: '12.5px', color: 'var(--ink-muted)', background: 'var(--surface-muted)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' } },
          'Session créée par une autre surface Hermes (CLI, TUI, messaging…) : le gateway la refuse en écriture (409). Historique visible en lecture seule ; pour discuter, ouvrez-la dans sa surface d’origine ou créez une nouvelle session depuis le cockpit.') : null,
        h(SubAgentBar, { visible: sending, label: session.title, onStop: handleStop }),
        h(Composer, { onSend: handleSend, onStop: handleStop, sending: sending, model: session.model || props.model, readOnly: readOnly })));
  }


  /* ============================ Écran : réglages ============================ */

  function SettingsScreen(props) {
    var st = React.useState(null);
    var settings = st[0], setSettings = st[1];
    var test = React.useState(null);
    var testResult = test[0], setTestResult = test[1];
    var hasKlai = !!(global.klai && global.klai.settings);

    React.useEffect(function () {
      if (!hasKlai) return;
      global.klai.settings.get().then(setSettings);
    }, []);

    function field(label, key, hint, type) {
      return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h('span', { className: 'label' }, label),
        h('input', { type: type || 'text', value: settings ? (settings[key] || '') : '',
          disabled: !settings,
          onChange: function (e) { setSettings(Object.assign({}, settings, (function () { var o = {}; o[key] = e.target.value; return o; })())); },
          style: { height: '36px', padding: '0 var(--space-2)', border: '1px solid var(--line-control)', borderRadius: 'var(--radius-md)',
            background: 'var(--surface)', fontFamily: key === 'model' ? 'var(--font-mono)' : 'var(--font-sans)', fontSize: '13px', color: 'var(--ink)' } }),
        hint ? h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)' } }, hint) : null);
    }

    return h('main', { style: { flex: '999 1 520px', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto', padding: 'var(--space-4) var(--space-1) 0' } },
      h('div', null,
        h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '26px', lineHeight: '32px', fontWeight: 300 } }, 'Réglages Hermes'),
        h('p', { style: { margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-muted)' } }, hasKlai ? 'Connexion au gateway Hermes (API OpenAI-compatible).' : 'Aperçu sans backend : les réglages vivent dans l’app Electron.')),
      h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' } },
        field('URL du backend', 'hermesBaseUrl', 'Par défaut http://127.0.0.1:8642, le port annoncé par hermes gateway.'),
        field('Clé API', 'hermesApiKey', 'API_SERVER_KEY dans ~/.hermes/.env. Laisser vide si aucun clé n’est définie.', 'password'),
        field('Modèle', 'model', 'Nom du modèle vu par Hermes (hermes-agent par défaut).'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' } },
          h(KLAI.Button, { variant: 'primary', icon: 'check', disabled: !settings,
            onClick: function () { global.klai.settings.set({ hermesBaseUrl: settings.hermesBaseUrl, hermesApiKey: settings.hermesApiKey, model: settings.model })
              .then(function (m) { setSettings(m); if (props.onSaved) props.onSaved(); }); } }, 'Enregistrer'),
          h(KLAI.Button, { icon: 'refresh', disabled: !settings,
            onClick: function () { setTestResult({ pending: true });
              global.klai.hermes.status().then(function (r) { setTestResult(r); if (props.onBackend) props.onBackend(r); }); } }, 'Tester la connexion'),
          testResult && !testResult.pending ? h('span', { style: { fontSize: '12.5px', color: testResult.ok ? 'var(--ink-muted)' : 'var(--danger)' } },
            testResult.ok ? 'Connecté · ' + (testResult.models || []).length + ' modèles' : 'Injoignable : ' + testResult.error) : null,
          testResult && testResult.pending ? h('span', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Test en cours…') : null)),
      h('div', { style: { background: 'var(--surface-muted)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', fontSize: '13px', color: 'var(--ink-muted)', lineHeight: '20px' } },
        'Activer le serveur API côté Hermes : ajouter ',
        h('span', { style: { fontFamily: 'var(--font-mono)' } }, 'API_SERVER_ENABLED=true'),
        ' et ',
        h('span', { style: { fontFamily: 'var(--font-mono)' } }, 'API_SERVER_KEY'),
        ' dans ',
        h('span', { style: { fontFamily: 'var(--font-mono)' } }, '~/.hermes/.env'),
        ', puis lancer ',
        h('span', { style: { fontFamily: 'var(--font-mono)' } }, 'hermes gateway'),
        '.'));
  }


  /* ============================ Racine ============================ */

  /* Données de démonstration, mise à la forme attendue par les écrans réels. */
  function toDemoGroups() {
    return PROJECTS.map(function (p) {
      return {
        name: p.name, init: p.init, path: p.path, meta: p.meta || '',
        live: p.live || 0, alertCount: p.alert || 0, alertLabel: p.alertLabel || '',
        isProject: false, last: 0,
        sessions: p.sessions.map(function (s) {
          return { id: null, label: s.label, step: s.step, chipData: { status: s.status, chip: s.chip } };
        })
      };
    });
  }

  function App() {
    var routeState = React.useState('overview');
    var route = routeState[0], setRoute = routeState[1];
    var filterState = React.useState('all');
    var filter = filterState[0], setFilter = filterState[1];
    var backendState = React.useState(null);
    var backend = backendState[0], setBackend = backendState[1];
    var modelState = React.useState('hermes-agent');
    var model = modelState[0], setModel = modelState[1];
    var loadingState = React.useState(true);
    var loading = loadingState[0], setLoading = loadingState[1];
    var groupsState = React.useState(toDemoGroups);
    var groups = groupsState[0], setGroups = groupsState[1];
    var demoState = React.useState(true);
    var demo = demoState[0], setDemo = demoState[1];
    var sessionState = React.useState(null);
    var selectedSession = sessionState[0], setSelectedSession = sessionState[1];
    var groupState = React.useState(null);
    var activeGroup = groupState[0], setActiveGroup = groupState[1];
    var searchState = React.useState('');
    var search = searchState[0], setSearch = searchState[1];
    var jobsState = React.useState([]);
    var jobs = jobsState[0], setJobs = jobsState[1];
    var approvalsState = React.useState([]);
    var approvals = approvalsState[0], setApprovals = approvalsState[1];
    var toolsState = React.useState({});
    var toolsBySession = toolsState[0], setToolsBySession = toolsState[1];
    var searchInputRef = React.useRef(null);
    var hermes = global.klai && global.klai.hermes ? global.klai.hermes : null;
    var backendOk = !!(backend && backend.ok === true);

    /* Synchro complète : statut du gateway, sessions réelles, projets, jobs.
       Données réelles dès que le backend répond (même liste vide) ; démo sinon. */
    function loadAll() {
      if (!hermes) { setLoading(false); setDemo(true); return; }
      setLoading(true);
      var calls = [hermes.status(), hermes.sessions(), hermes.projects(), hermes.jobs()];
      var tries = Promise.allSettled
        ? Promise.allSettled(calls)
        : Promise.all(calls.map(function (p) {
            return p.then(function (v) { return { status: 'fulfilled', value: v }; },
                           function (e) { return { status: 'rejected', reason: e }; });
          }));
      tries.then(function (rs) {
        var st = rs[0] && rs[0].status === 'fulfilled' ? rs[0].value : null;
        if (st) setBackend(st);
        var sd = rs[1] && rs[1].status === 'fulfilled' ? rs[1].value : null;
        var pr = rs[2] && rs[2].status === 'fulfilled' ? rs[2].value : null;
        var jb = rs[3] && rs[3].status === 'fulfilled' ? rs[3].value : null;
        if (st && st.ok) {
          setGroups(groupRealSessions((sd && sd.ok && sd.sessions) || [], (pr && pr.ok && pr.projects) || []));
          setDemo(false);
          if (jb && jb.ok) setJobs(jb.jobs || []);
        } else {
          setGroups(toDemoGroups());
          setDemo(true);
        }
        setLoading(false);
      }).catch(function () { setLoading(false); });
    }

    React.useEffect(function () {
      loadAll();
      var timer = hermes ? setInterval(loadAll, 30000) : null;

      if (global.klai && global.klai.settings) {
        global.klai.settings.get().then(function (s) {
          if (s && s.theme) document.documentElement.setAttribute('data-theme', s.theme);
          if (s && s.model) setModel(s.model);
        }).catch(function () {});
      }

      var offs = [];
      if (global.klai && global.klai.on) {
        offs.push(global.klai.on('klai:theme', function (t) { document.documentElement.setAttribute('data-theme', t); }));
        offs.push(global.klai.on('klai:new-session', function () { newSession(activeGroup); }));
        offs.push(global.klai.on('klai:settings-open', function () { setRoute('settings'); }));
        offs.push(global.klai.on('klai:focus-search', function () {
          if (searchInputRef.current) { searchInputRef.current.focus(); searchInputRef.current.select(); }
        }));
      }
      /* Événements globaux : resynchro discrète + approbations + outils pour l'aside. */
      if (global.klai && global.klai.onHermesEvent) {
        offs.push(global.klai.onHermesEvent(function (ev) {
          if (ev.type === 'done' || ev.type === 'error' || ev.type === 'cancelled') {
            loadAll();
            if (ev.session) {
              setApprovals(function (prev) { return prev.filter(function (a) { return a.session !== ev.session; }); });
              setToolsBySession(function (prev) { var o = Object.assign({}, prev); delete o[ev.session]; return o; });
            }
          }
          if (ev.type === 'approval') {
            setApprovals(function (prev) {
              if (prev.some(function (a) { return a.runId === ev.runId && a.requestId === ev.requestId; })) return prev;
              var title = '';
              groups.forEach(function (g) { (g.sessions || []).forEach(function (s) { if (s.id === ev.session) title = s.title; }); });
              return prev.concat([{ session: ev.session, sessionTitle: title || ev.session, runId: ev.runId, requestId: ev.requestId, command: ev.command, description: ev.description, choices: ev.choices }]);
            });
          }
          if (ev.type === 'tool' && ev.session) {
            setToolsBySession(function (prev) {
              var list = (prev[ev.session] || []).slice();
              list.push({ name: ev.name, preview: ev.preview, error: !!ev.error });
              var o = Object.assign({}, prev); o[ev.session] = list;
              return o;
            });
          }
        }));
      }
      return function () {
        if (timer) clearInterval(timer);
        offs.forEach(function (off) { off(); });
      };
    }, []);

    function navigate(r) { setRoute(r); }

    function openSession(s, g) {
      if (s && s.id) setSelectedSession(s);
      if (g) setActiveGroup(g);
      setRoute('project');
    }

    function openGroup(g) {
      var list = g.sessions || [];
      var first = list.filter(function (s) { return s.id && !s.readOnly; })[0] || list.filter(function (s) { return s.id; })[0] || null;
      if (first) openSession(first, g);
      else { setActiveGroup(g); setSelectedSession(null); setRoute('project'); }
    }

    function demoSession(group) {
      return { id: 'demo-' + Date.now(), title: 'Nouvelle session (démo)', demo: true, messageCount: 0, workspace: group ? group.path : '', model: model };
    }

    function newSession(group) {
      if (hermes && backendOk) {
        hermes.createSession('Nouvelle session').then(function (r) {
          if (r && r.ok && r.session) { openSession(r.session, group || null); loadAll(); }
          else openSession(demoSession(group), group || null);
        }).catch(function () { openSession(demoSession(group), group || null); });
      } else {
        openSession(demoSession(group), group || null);
      }
    }

    function newProject() {
      if (!hermes || !backendOk) return;
      var name = global.prompt ? global.prompt('Nom du nouveau projet ?') : null;
      if (!name) return;
      hermes.createProject(name).then(function () { loadAll(); }).catch(function () {});
    }

    function forkCurrent() {
      if (!hermes || !backendOk || !selectedSession || !selectedSession.id) return;
      hermes.fork(selectedSession.id, (selectedSession.title || 'Session') + ' (copie)').then(function (r) {
        if (r && r.ok && r.session) { openSession(r.session, activeGroup); loadAll(); }
      }).catch(function () {});
    }

    function approveItem(a, choice) {
      if (!hermes) return;
      hermes.approve(a.runId, a.requestId, choice).then(function () {
        setApprovals(function (prev) { return prev.filter(function (x) { return x !== a; }); });
      }).catch(function () {});
    }

    /* Listes dérivées pour l'aside et la barre d'état. */
    var liveItems = [], todoItems = [];
    groups.forEach(function (g) {
      (g.sessions || []).forEach(function (s) {
        if (!s.id) return;
        if (s.streaming) liveItems.push({ session: s, group: g, groupName: g.name });
        if (s.attention) todoItems.push({ session: s, group: g, groupName: g.name });
      });
    });
    var liveCount = liveItems.length;
    var todoCount = todoItems.length + approvals.length;
    var liveOthers = selectedSession ? liveItems.filter(function (x) { return x.session.id !== selectedSession.id; }) : liveItems;
    var currentTools = selectedSession ? (toolsBySession[selectedSession.id] || []) : [];

    var main;
    if (route === 'overview') main = h(OverviewScreen, { filter: filter, onFilter: setFilter, groups: groups, demo: demo, loading: loading, search: search, onOpenSession: openSession, onOpenGroup: openGroup, onNewSessionInGroup: function (g) { newSession(g); } });
    else if (route === 'project') main = h(ProjectScreen, { onNavigate: navigate, model: model, session: selectedSession, group: activeGroup, backendOk: backendOk, onNewSession: newSession, onFork: forkCurrent, onTurnEnd: loadAll });
    else main = h(SettingsScreen, { onBackend: setBackend, onSaved: loadAll });

    return h('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: '13.5px' } },
      h(TopBar, { onNavigate: navigate, onNewSession: function () { newSession(activeGroup); }, onOpenSettings: function () { setRoute('settings'); }, onSearch: setSearch, searchInputRef: searchInputRef }),
      h('div', { style: { flex: '1', minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', padding: '0 var(--space-3) var(--space-3)' } },
        h(SideNav, { route: route, onNavigate: navigate, groups: groups, demo: demo, activeGroupName: activeGroup ? activeGroup.name : '', onOpenGroup: openGroup, onNewProject: newProject, liveCount: liveCount, todoCount: todoCount }),
        main,
        route === 'settings' ? null : h(ActivityAside, { route: route, asideStyle: { flex: '1 0 300px', maxWidth: '340px', height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 0, overflowY: 'auto' },
          demo: demo, approvals: approvals, todoItems: todoItems, liveItems: liveItems, jobs: jobs,
          tools: currentTools, contextPct: selectedSession ? (selectedSession.contextPct || 0) : 0, liveOthers: liveOthers,
          onOpenSession: openSession, onApprove: approveItem })),
      h(StatusBar, { route: route, projectName: selectedSession ? (selectedSession.title || (activeGroup && activeGroup.name)) : (activeGroup && activeGroup.name), sessionId: selectedSession ? selectedSession.id : '', backend: backend, onRetry: loadAll, liveCount: liveCount, todoCount: todoCount }));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})(window);
