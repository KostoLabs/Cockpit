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

  /* ============================ Pièces communes ============================ */

  function TopBar(props) {
    return h('header', {
      style: { height: '84px', flex: 'none', display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-3)', padding: '0 var(--space-4) 0 28px' }
    },
      h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onNavigate('overview'); },
        'aria-label': 'KostoLabs AI, vue d’ensemble', style: { flex: '0 0 226px', display: 'flex', textDecoration: 'none' } },
        h(KLAI.Logo, { size: 19 })),
      h('div', { style: { flex: '1', minWidth: '220px', display: 'flex', justifyContent: 'center' } },
        h('div', { style: { width: '100%', maxWidth: '460px' } },
          h(KLAI.SearchField, { placeholder: 'Aller à un projet, une session, une commande…', shortcut: '⌘K', style: { width: '100%' } }))),
      h(KLAI.Button, { variant: 'primary', icon: 'plus' }, 'Nouvelle session'),
      h(KLAI.Button, { variant: 'ghost', icon: 'hud', iconOnly: true, label: 'Mode HUD' }),
      h(KLAI.Button, { variant: 'ghost', icon: 'settings', iconOnly: true, label: 'Réglages' }));
  }

  function SideNav(props) {
    var current = props.route;
    return h('nav', { 'aria-label': 'Navigation',
      style: { flex: '0 0 244px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', height: '100%', minHeight: 0 } },
      h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px' } },
        NAV.map(function (n) {
          var active = n.route && n.route === current;
          return h(KLAI.NavItem, Object.assign({ key: n.label, icon: n.icon, label: n.label, active: active,
            count: active && current === 'overview' ? '3' : (n.count || ''),
            countTone: active ? 'attention' : 'neutral',
            onClick: n.route ? function (e) { e.preventDefault(); props.onNavigate(n.route); } : undefined,
            href: n.route ? '#' : '#' }));
        })),
      h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minHeight: 0, overflowY: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', padding: '0 var(--space-1) var(--space-1) 10px' } },
          h('span', { style: { flex: '1', fontSize: '12px', fontWeight: 500, color: 'var(--ink-muted)' } }, 'Projets actifs · 6'),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Ajouter un projet' })),
        PROJECTS.map(function (p) {
          var open = props.route === 'project' && p.name === 'Accueil';
          var tone = open ? 'ink' : (p.live === 0 && p.alert === 0 ? 'outline' : 'strong');
          return h('a', { key: p.name, href: open ? '#' : '#',
            'aria-current': open ? 'page' : undefined,
            onClick: function (e) { e.preventDefault(); props.onNavigate('project', p.name); },
            style: { display: 'flex', alignItems: 'center', gap: '10px', height: '40px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-sm)', textDecoration: 'none', color: 'var(--ink)',
              background: open ? 'var(--surface-muted)' : 'transparent' } },
            h(KLAI.ProjectAvatar, { initials: p.init, tone: tone }),
            h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 } }, p.name),
            p.live > 0 ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--ink-muted)' } },
              h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ink)' } }), String(p.live)) : null,
            p.alert > 0 ? h(KLAI.Badge, { tone: p.alertTone, label: String(p.alert) }) : null);
        }),
        h('a', { href: '#', style: { fontSize: '12.5px', padding: '6px 10px', color: 'var(--ink-muted)', textDecoration: 'none' } }, 'Tous les projets'),
        h('div', { style: { flex: '1' } }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 10px 0', borderTop: '1px solid var(--line)', fontSize: '11.5px', color: 'var(--ink-muted)' } },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
            h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ink)' } }), 'en cours'),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
            h(KLAI.Badge, { tone: 'attention', label: '1' }), 'à traiter'))));
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
      props.route === 'project' ? h('span', null, 'Projet : Accueil') : null,
      props.route === 'project' ? h('span', null, 'Approbations manuelles') : h('span', null, '6 sessions en cours'),
      props.route === 'project' ? h('span', null, 'Intelligent') : h('span', null, '2 sous-agents'),
      h('span', { style: { fontFamily: 'var(--font-mono)' } }, 'd923a5e'));
  }

  /* ============================ Écran : vue d'ensemble ============================ */

  var FILTERS = [
    { value: 'all', label: 'Actifs · 6' },
    { value: 'live', label: 'En cours · 4' },
    { value: 'todo', label: 'À traiter · 3' },
    { value: 'idle', label: 'En veille · 1' }
  ];

  function OverviewScreen(props) {
    var filter = props.filter;
    var keep = {
      all: function () { return true; },
      live: function (p) { return p.live > 0; },
      todo: function (p) { return p.alert > 0; },
      idle: function (p) { return p.live === 0 && p.alert === 0; }
    };
    var cards = PROJECTS.filter(keep[filter] || keep.all);
    return h('main', { style: { flex: '999 1 520px', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap', padding: 'var(--space-1) var(--space-1) 0' } },
        h('div', { style: { flex: '1', minWidth: '220px' } },
          h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '26px', lineHeight: '32px', fontWeight: 300, letterSpacing: '-0.01em' } }, 'Vue d’ensemble'),
          h('p', { style: { margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-muted)' } }, '6 projets actifs · 6 sessions en cours · 3 éléments à traiter')),
        h(KLAI.Segmented, { options: FILTERS, value: filter, onChange: props.onFilter, label: 'Filtrer les projets' })),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' } },
        cards.map(function (p) {
          return h('section', { key: p.name, style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h(KLAI.ProjectAvatar, { initials: p.init, tone: 'strong', size: 32 }),
              h('div', { style: { flex: '1', minWidth: 0 } },
                h('h2', { style: { margin: 0, fontSize: '15px', lineHeight: '22px', fontWeight: 600 } },
                  h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onOpenProject(p.name); }, style: { color: 'var(--ink)', textDecoration: 'none' } }, p.name)),
                h('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.path)),
              p.alert > 0 ? h(KLAI.Badge, { tone: p.alertTone, label: p.alertLabel }) : null),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1' } },
              p.sessions.map(function (s) {
                return h('a', { key: s.label, href: '#', onClick: function (e) { e.preventDefault(); props.onOpenProject(p.name); },
                  style: { display: 'flex', flexDirection: 'column', gap: '3px', padding: 'var(--space-2) 10px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', textDecoration: 'none', color: 'var(--ink)' } },
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' } },
                    h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, fontSize: '13px' } }, s.label),
                    h(KLAI.StatusChip, { status: s.status, label: s.chip })),
                  h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.step));
              }),
              p.sessions.length === 0 ? h('div', { style: { flex: '1', minHeight: '90px', border: '1px dashed var(--line-control)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-3)', fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune session active, dernière activité il y a 30 jours') : null),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' } },
              h(KLAI.Button, { size: 'sm', icon: 'plus' }, 'Session'),
              h('span', { style: { flex: '1', minWidth: 0, fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.meta),
              h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { props.onOpenProject(p.name); } }, 'Ouvrir')));
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
      var tools = [
        { tool: 'read_file', arg: 'contrat_actual_v3.pdf', t: '4.2s' },
        { tool: 'web_search', arg: 'CNIL sous-traitance paie', t: '6.8s' },
        { tool: 'diff_docs', arg: 'annexes 2 ↔ 4', t: '7.1s' }
      ];
      var elsewhere = [
        ['Recette Preprod App', 'Koordo', '2 échecs en correction', 'running', 'KO'],
        ['Pipeline géno-phénotype', 'GenRes', 'étape 4/7', 'running', 'GR'],
        ["Corriger les tests d'intégration", 'GusAI', 'étape 2/5', 'running', 'GU'],
        ['Mettre à jour le runner', 'actions-runner', 'backend indisponible', 'error', 'AR']
      ];
      return h('aside', { 'aria-label': 'Activité', style: props.asideStyle },
        h(KLAI.Panel, null,
          h(KLAI.ContextMeter, { label: 'Contexte de la session', value: '76k / 200k',
            segments: [{ label: 'Fichiers', percent: 18 }, { label: 'Conversation', percent: 12 }, { label: 'Mémoire', percent: 8 }] })),
        h(KLAI.Panel, { title: 'Outils de ce tour' },
          tools.map(function (t) {
            return h('div', { key: t.tool, style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12.5px' } },
              h('span', { style: { width: '22px', height: '22px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } },
                h(KLAI.Icon, { name: 'check', size: 14 })),
              h('span', { style: { flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                h('span', { style: { fontFamily: 'var(--font-mono)' } }, t.tool), ' ', h('span', { style: { color: 'var(--ink-muted)' } }, t.arg)),
              h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)' } }, t.t));
          })),
        h(KLAI.Panel, { title: 'Revoir', meta: 'main · d923a5e' },
          h(KLAI.Segmented, { options: ['Non validé', 'Branche', 'Dernier tour'], defaultValue: 'Dernier tour', block: true, size: 'sm', label: 'Vue de la revue' }),
          h('div', { style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Aucune différence sur ce tour.')),
        h(KLAI.Panel, { title: 'Ailleurs dans vos projets', actionLabel: "Vue d'ensemble", actionHref: '#' },
          elsewhere.map(function (e) {
            return h('a', { key: e[0], href: '#', style: { display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'var(--ink)' } },
              h(KLAI.ProjectAvatar, { initials: e[4] }),
              h('span', { style: { flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' } },
                h('span', { style: { fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e[0]),
                h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e[1] + ' · ' + e[2])),
              h(KLAI.StatusChip, { status: e[3] }));
          })));
    }
    return h('aside', { 'aria-label': 'À traiter', style: props.asideStyle },
      h(KLAI.Panel, { title: 'À traiter', meta: '3' },
        TODO.map(function (t) { return h(TodoPanel, { key: t.title, item: t }); })),
      h(KLAI.Panel, { title: 'Sous-agents actifs' },
        WORKERS.map(function (w) {
          return h('div', { key: w.name, style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' } },
              h('span', { style: { fontFamily: 'var(--font-mono)', flex: '1', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.name),
              h('span', { style: { color: 'var(--ink-muted)' } }, w.project + ' · ' + w.prog)),
            h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--surface-strong)', overflow: 'hidden' } },
              h('div', { style: { width: w.width, height: '100%', background: 'var(--ink)' } })));
        })),
      h(KLAI.Panel, { title: 'Planifié aujourd’hui', actionLabel: 'Tout voir' },
        h('div', { style: { display: 'flex', gap: '10px', fontSize: '13px' } },
          h('span', { style: { fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' } }, '08:30'),
          h('span', { style: { flex: '1' } }, 'Veille réglementaire'),
          h('span', { style: { color: 'var(--ink-muted)' } }, 'Accueil')),
        h('div', { style: { display: 'flex', gap: '10px', fontSize: '13px' } },
          h('span', { style: { fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' } }, '23:00'),
          h('span', { style: { flex: '1' } }, 'Recette nocturne'),
          h('span', { style: { color: 'var(--ink-muted)' } }, 'Koordo'))));
  }
  /* ============================ Écran : projet ============================ */

  var SESSION_TABS = [
    { label: 'Première analyse juridique', status: 'done', chip: 'Terminée', on: true },
    { label: 'Retrouver secrets PREP…', status: 'running', chip: 'En cours', on: false },
    { label: 'Connecter Apple Remote…', status: 'attention', chip: 'Approbation', on: false }
  ];

  function ProjectHeader(props) {
    return h('div', { style: { flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) 0', borderBottom: '1px solid var(--line)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' } },
        h('a', { href: '#', onClick: function (e) { e.preventDefault(); props.onNavigate('overview'); }, style: { fontSize: '12.5px', color: 'var(--ink-muted)' } }, 'Vue d’ensemble'),
        h('span', { style: { color: 'var(--ink-subtle)' } }, '/'),
        h('h1', { style: { margin: 0, fontFamily: 'var(--font-display)', fontSize: '22px', lineHeight: '28px', fontWeight: 300 } }, 'Accueil'),
        h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)' } }, '~/qhaddouche · main'),
        h('div', { style: { flex: '1' } }),
        h('span', { style: { fontSize: '12px', color: 'var(--ink-muted)' } }, '3 ouvertes · 18 au total'),
        h(KLAI.Button, { size: 'sm', icon: 'split' }, 'Côte à côte')),
      h('div', { role: 'tablist', 'aria-label': 'Sessions ouvertes', style: { display: 'flex', gap: '2px', overflowX: 'auto' } },
        SESSION_TABS.map(function (t) {
          return h('button', {
            key: t.label, role: 'tab', type: 'button', 'aria-selected': t.on,
            style: {
              display: 'flex', alignItems: 'center', gap: '8px', height: '42px',
              padding: '0 12px', fontFamily: 'var(--font-sans)', fontSize: '13px', flex: 'none',
              background: 'transparent', border: 0,
              borderBottom: '2px solid ' + (t.on ? 'var(--ink)' : 'transparent'),
              color: t.on ? 'var(--ink)' : 'var(--ink-muted)',
              fontWeight: t.on ? 600 : 400
            }
          },
            h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' } }, t.label),
            h(KLAI.StatusChip, { status: t.status, label: t.chip }));
        }),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Nouvelle session dans Accueil' })));
  }

  function TimelineRail() {
    var marks = ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message actuel'];
    return h('div', { role: 'navigation', 'aria-label': 'Chronologie des messages',
      style: { flex: '0 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-6) 0', gap: '14px', borderRight: '1px solid var(--line)' } },
      marks.map(function (m, i) {
        var on = i === marks.length - 1;
        return h('button', { key: m, type: 'button', 'aria-label': m,
          style: { width: '10px', height: '10px', padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', background: on ? 'var(--ink)' : 'var(--line-control)', boxShadow: on ? '0 0 0 4px var(--surface-strong)' : 'none' } });
      }));
  }

  function ChatBody(props) {
    var num = { listStyleType: 'decimal', margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' };
    var messages = props.messages || [];
    var colStyle = { maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', lineHeight: '24px', fontSize: '15px' };
    return h('div', { style: { flex: '1', minWidth: 0, overflowY: 'auto', padding: 'var(--space-6)' } },
      h('div', { style: colStyle },
        h('div', { style: { alignSelf: 'flex-end', background: 'var(--inverse)', color: 'var(--on-inverse)', borderRadius: '14px 14px 4px 14px', padding: '10px 14px', maxWidth: '80%' } },
          'Première analyse juridique, à froid, de ce contrat'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12.5px', color: 'var(--ink-muted)' } },
          h(KLAI.Icon, { name: 'check', size: 15 }),
          h('span', null, '3 outils utilisés · lecture du contrat, recherche CNIL, comparaison des annexes · 18 s')),
        h('h2', { style: { margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 600 } }, 'Conclusion pratique'),
        h('p', { style: { margin: 0 } },
          h('b', { style: { fontWeight: 600 } }, 'Le principal risque n’est pas le prix du BUILD : c’est de dépendre d’un prestataire pour la paie, avec des recours réduits et une sortie mal organisée.')),
        h('ol', { style: num },
          h('li', null, 'Fixer l’identité des parties et sécuriser le montage intragroupe.'),
          h('li', null, 'Protéger les fonds de paie et recalibrer la garantie d’impayés.'),
          h('li', null, 'Réécrire responsabilité, preuve et délais de recours.')),
        h('p', { style: { margin: 0, padding: 'var(--space-3) 14px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)' } },
          h('b', { style: { fontWeight: 600 } }, 'En bref :'), ' une base de négociation utilisable, mais pas une version prête pour signature côté ACTUAL.'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'copy', iconOnly: true, label: 'Copier' }),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'branch', iconOnly: true, label: 'Créer une branche' }),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'refresh', iconOnly: true, label: 'Régénérer' }),
          h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-muted)', marginLeft: 'var(--space-2)' } }, '6 oct., 16:16 · GPT-6-astra')),
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

  function SubAgentBar() {
    return h('div', { style: { maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface-muted)' } },
      h('span', { style: { fontSize: '12px', fontWeight: 500, color: 'var(--ink-muted)' } }, 'Sous-agent'),
      h(KLAI.StatusChip, { status: 'running' }),
      h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', flex: '1', minWidth: '160px' } }, 'veille-jurisprudence · 3/8 étapes'),
      h(KLAI.Button, { size: 'sm', icon: 'steer' }, 'Orienter'),
      h(KLAI.Button, { variant: 'danger', size: 'sm', icon: 'stop' }, 'Arrêter'));
  }

  function Composer(props) {
    var text = React.useState('');
    var value = text[0], setValue = text[1];
    var sending = !!props.sending;
    function submit() {
      var v = value.trim();
      if (!v || sending) return;
      setValue('');
      if (props.onSend) props.onSend(v);
    }
    return h('div', { style: { maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box', border: '1px solid var(--line-control)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' } },
      h('label', { style: { display: 'block', padding: 'var(--space-3) 14px var(--space-1)' } },
        h('span', { style: { position: 'absolute', left: '-9999px' } }, 'Message'),
        h('textarea', { rows: 2, value: value,
          placeholder: sending ? 'Hermes réfléchit… (le composer reprend à la fin du tour)' : 'Donnez une tâche à Hermes dans Accueil…',
          onChange: function (e) { setValue(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } },
          style: { width: '100%', border: 0, outline: 0, resize: 'none', fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--ink)', background: 'transparent' } })),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px var(--space-2) var(--space-2)', flexWrap: 'wrap' } },
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Joindre un fichier' }),
        h(KLAI.Button, { size: 'sm', iconRight: 'chevron' }, props.model || 'hermes-agent'),
        h(KLAI.Button, { size: 'sm', iconRight: 'chevron' }, 'Ultra → Max'),
        h('div', { style: { flex: '1' } }),
        h(KLAI.Button, { variant: 'ghost', icon: 'mic', iconOnly: true, label: 'Conversation vocale' }),
        sending
          ? h(KLAI.Button, { variant: 'danger', icon: 'stop', iconOnly: true, label: 'Arrêter', onClick: props.onStop })
          : h(KLAI.Button, { variant: 'primary', icon: 'send', iconOnly: true, label: 'Envoyer', onClick: submit })));
  }

  var SESSION_ID = 'cockpit-accueil';

  function ProjectScreen(props) {
    var m = React.useState([]);
    var messages = m[0], setMessages = m[1];
    var s = React.useState(false);
    var sending = s[0], setSending = s[1];
    var hermes = global.klai && global.klai.hermes ? global.klai.hermes : null;

    React.useEffect(function () {
      if (!global.klai || !global.klai.onHermesEvent) return;
      return global.klai.onHermesEvent(function (ev) {
        if (ev.session !== SESSION_ID) return;
        if (ev.type === 'delta') {
          setMessages(function (prev) {
            var next = prev.slice();
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
            var next = prev.slice();
            var last = next[next.length - 1];
            if (last && last.streaming) next[next.length - 1] = Object.assign({}, last, { streaming: false });
            return next;
          });
          setSending(false);
        }
        if (ev.type === 'cancelled') {
          setMessages(function (prev) {
            var next = prev.slice();
            var last = next[next.length - 1];
            if (last && last.streaming) next[next.length - 1] = Object.assign({}, last, { streaming: false, text: last.text + ' [interrompu]' });
            return next;
          });
          setSending(false);
        }
        if (ev.type === 'error') {
          setMessages(function (prev) {
            var next = prev.slice();
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
      setMessages(function (prev) { return prev.concat([{ who: 'user', text: text }]); });
      setSending(true);
      if (hermes) {
        hermes.send(SESSION_ID, text).catch(function () { setSending(false); });
      } else {
        // Aucun backend branché (aperçu dans un navigateur, par exemple) :
        // réponse simulée pour que le fil reste démontrable.
        setMessages(function (prev) { return prev.concat([{ who: 'assistant', text: '', streaming: true }]); });
        setTimeout(function () {
          setMessages(function (prev) {
            var next = prev.slice();
            var last = next[next.length - 1];
            if (last && last.streaming) {
              next[next.length - 1] = Object.assign({}, last, {
                text: 'Le cockpit n’est pas relié à un backend Hermes ici. Lancez l’app Electron avec \`hermes gateway\` actif (API_SERVER_ENABLED=true) pour converser avec l’agent.',
                streaming: false });
            }
            return next;
          });
          setSending(false);
        }, 700);
      }
    }

    function handleStop() {
      if (hermes) hermes.stop(SESSION_ID);
      setSending(false);
    }

    return h('main', { style: { flex: '999 1 520px', minWidth: 0, height: '100%', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      h(ProjectHeader, { onNavigate: props.onNavigate }),
      h('div', { style: { flex: '1', minHeight: 0, display: 'flex' } },
        h(TimelineRail),
        h(ChatBody, { messages: messages })),
      h('div', { style: { flex: 'none', padding: '0 var(--space-5) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
        h(SubAgentBar),
        h(Composer, { onSend: handleSend, onStop: handleStop, sending: sending, model: props.model })));
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

  function App() {
    var routeState = React.useState('overview');
    var route = routeState[0], setRoute = routeState[1];
    var filterState = React.useState('all');
    var filter = filterState[0], setFilter = filterState[1];
    var backendState = React.useState(null);
    var backend = backendState[0], setBackend = backendState[1];
    var modelState = React.useState('hermes-agent');
    var model = modelState[0], setModel = modelState[1];
    var hermes = global.klai && global.klai.hermes ? global.klai.hermes : null;

    function probe() {
      if (!hermes) return;
      hermes.status().then(setBackend);
    }

    React.useEffect(function () {
      probe();
      var timer = hermes ? setInterval(function () { probe(); }, 25000) : null;

      if (global.klai && global.klai.settings) {
        global.klai.settings.get().then(function (s) {
          if (s && s.theme) document.documentElement.setAttribute('data-theme', s.theme);
          if (s && s.model) setModel(s.model);
        });
      }

      var offs = [];
      if (global.klai && global.klai.on) {
        offs.push(global.klai.on('klai:theme', function (t) { document.documentElement.setAttribute('data-theme', t); }));
        offs.push(global.klai.on('klai:new-session', function () { setRoute('project'); }));
        offs.push(global.klai.on('klai:settings-open', function () { setRoute('settings'); }));
      }
      return function () {
        if (timer) clearInterval(timer);
        offs.forEach(function (off) { off(); });
      };
    }, []);

    function navigate(r) { setRoute(r); }

    var main;
    if (route === 'overview') main = h(OverviewScreen, { filter: filter, onFilter: setFilter, onOpenProject: function () { setRoute('project'); } });
    else if (route === 'project') main = h(ProjectScreen, { onNavigate: navigate, model: model });
    else main = h(SettingsScreen, { onBackend: setBackend, onSaved: probe });

    return h('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: '13.5px' } },
      h(TopBar, { onNavigate: navigate }),
      h('div', { style: { flex: '1', minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', padding: '0 var(--space-3) var(--space-3)' } },
        h(SideNav, { route: route, onNavigate: navigate }),
        main,
        route === 'settings' ? null : h(ActivityAside, { route: route, asideStyle: { flex: '1 0 300px', maxWidth: '340px', height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 0, overflowY: 'auto' } })),
      h(StatusBar, { route: route, backend: backend, onRetry: probe }));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})(window);
