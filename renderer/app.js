/* KostoLabs AI Cockpit — racine du renderer : routage, raccourcis, HUD. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;
  var S = KC.Screens;
  var params = new URLSearchParams(global.location.search);

  /* Écrans disponibles. Les écrans pleine largeur n'ont pas de colonne de droite. */
  KC.ROUTES = {
    overview: { screen: 'Overview', aside: 'TodoAside' },
    project: { screen: 'Project' },
    settings: { screen: 'Settings' },
    capabilities: { screen: 'Capabilities' },
    messaging: { screen: 'Messaging' },
    artifacts: { screen: 'Artifacts' },
    jobs: { screen: 'Jobs' },
    terminal: { screen: 'Terminal' },
    sync: { screen: 'Sync' }
  };
  KC.hasRoute = function (r) { return !!(KC.ROUTES[r] && S[KC.ROUTES[r].screen]); };

  /* Dérivés communs : groupes, file « À traiter », sous-agents, compteurs. */
  function useDerived(state) {
    return React.useMemo(function () {
      var groups = KC.groupSessions(state.sessions, state.projects, state.live);
      var groupOf = {};
      groups.forEach(function (g) { g.sessions.forEach(function (s) { groupOf[s.id] = g; }); });
      var todo = [];
      var subagents = [];
      var approvals = 0;
      state.sessions.forEach(function (s) {
        var lv = state.live[s.id];
        var g = groupOf[s.id];
        var gname = g ? g.name : '';
        if (lv) {
          (lv.approvals || []).forEach(function (a) { approvals++; todo.push({ kind: 'approval', session: s, approval: a, group: gname, at: a.at }); });
          if (lv.clarify) todo.push({ kind: 'clarify', session: s, clarify: lv.clarify, group: gname, at: Date.now() });
          if (lv.error && !lv.busy) todo.push({ kind: 'error', session: s, text: lv.error, group: gname, at: s.updated });
          else if (lv.unread && !lv.busy) todo.push({ kind: 'unread', session: s, group: gname, at: s.updated });
          (lv.subagents || []).forEach(function (w) { subagents.push(Object.assign({ group: gname, sessionId: s.id }, w)); });
        } else if (s.attention) {
          todo.push({ kind: 'unread', session: s, group: gname, at: s.updated });
        }
      });
      var rank = { approval: 0, clarify: 1, error: 2, unread: 3 };
      todo.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || (b.at || 0) - (a.at || 0); });
      subagents.sort(function (a, b) { return (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.at - a.at; });
      var live = groups.reduce(function (n, g) { return n + g.live; }, 0);
      var today = new Date().toDateString();
      return {
        groups: groups, todo: todo, subagents: subagents,
        counts: {
          todo: todo.length, approvals: approvals, live: live,
          subagents: subagents.filter(function (w) { return w.status === 'running'; }).length,
          jobsToday: state.jobs.filter(function (j) { return j.nextRun && !j.paused && new Date(j.nextRun).toDateString() === today; }).length,
          messaging: state.sessions.filter(function (s) { return KC.MESSAGING.test(s.source || '') && s.updated && Date.now() - s.updated < 864e5; }).length
        }
      };
    }, [state.sessions, state.projects, state.live, state.jobs]);
  }
  KC.useDerived = useDerived;

  function App() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var d = useDerived(state);
    var p = React.useState(false), palette = p[0], setPalette = p[1];
    var f = React.useState(false), find = f[0], setFind = f[1];
    var fk = React.useState(0), focusKey = fk[0], setFocusKey = fk[1];

    var newSession = React.useCallback(function () {
      var activeGroup = state.route === 'project' ? d.groups.find(function (g) { return g.sessions.some(function (s) { return s.id === state.active; }); }) : null;
      api.newSession(activeGroup).then(function (s) { if (s) setFocusKey(Date.now()); });
    }, [state.route, state.active, d.groups]);

    var refs = React.useRef({});
    refs.current = { newSession: newSession, state: state };
    React.useEffect(function () {
      global.__klaiNavigate = function (r) { api.navigate(r); };
      if (!KC.bridge) return;
      var offs = [
        KC.bridge.on('klai:navigate', function (r) { api.navigate(r); }),
        KC.bridge.on('klai:command', function (c) {
          var st = refs.current.state;
          if (c === 'new-session') refs.current.newSession();
          else if (c === 'palette') setPalette(true);
          else if (c === 'find') setFind(true);
          else if (c === 'stop' && st.active) api.stop(st.active);
          else if (c === 'close-tab' && st.route === 'project' && st.active) api.close(st.active);
        })
      ];
      function key(e) {
        var mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
        if (e.key === 'Escape') { setPalette(false); setFind(false); }
        if (e.ctrlKey && e.key === 'Tab') {
          var st = refs.current.state;
          if (st.tabs.length > 1) {
            e.preventDefault();
            var i = st.tabs.indexOf(st.active);
            api.open(st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length]);
          }
        }
      }
      global.addEventListener('keydown', key);
      return function () { offs.forEach(function (o) { o(); }); global.removeEventListener('keydown', key); };
    }, []);

    var route = KC.hasRoute(state.route) ? state.route : 'overview';
    if (route === 'project' && !state.active) route = 'overview';
    var def = KC.ROUTES[route];
    var Screen = S[def.screen];
    var Aside = def.aside ? S[def.aside] : null;

    return h('div', { className: 'kc-app' },
      h(KC.Shell.TopBar, { onPalette: function () { setPalette(true); }, onNewSession: newSession }),
      h('div', { className: 'kc-body', style: { position: 'relative' } },
        h(KC.Shell.SideNav, { groups: d.groups, counts: d.counts }),
        h(Screen, { groups: d.groups, todo: d.todo, subagents: d.subagents, counts: d.counts, focusKey: focusKey }),
        Aside ? h(Aside, { groups: d.groups, todo: d.todo, subagents: d.subagents }) : null,
        find && route === 'project' ? h(KC.Shell.FindBar, { onClose: function () { setFind(false); } }) : null),
      h(KC.Shell.StatusBar, { counts: d.counts }),
      palette ? h(KC.Shell.Palette, { groups: d.groups, onClose: function () { setPalette(false); }, onNewSession: newSession }) : null,
      h(KC.Shell.Toasts, null));
  }

  /* HUD : barre flottante, une session, composer. */
  function Hud() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var d = useDerived(state);
    var wanted = params.get('session');
    React.useEffect(function () {
      if (wanted) api.open(wanted);
    }, []);
    var id = state.active || (state.sessions.find(function (s) { return !s.readOnly; }) || {}).id;
    React.useEffect(function () { if (id && id !== state.active) api.open(id); }, [id]);
    var session = state.sessions.find(function (s) { return s.id === id; });
    return h('div', { className: 'kc-hud' },
      h('div', { className: 'kc-hud-top' },
        h(KLAI.Logo, { variant: 'mark', size: 14 }),
        h('button', { type: 'button', className: 'kc-plain kc-ellipsis', style: { flex: 1, fontWeight: 400, WebkitAppRegion: 'no-drag' },
          onClick: function (e) {
            ov.menu(e, d.groups.slice(0, 6).reduce(function (acc, g) {
              return acc.concat(g.sessions.slice(0, 3).map(function (s) { return { label: g.name + ' · ' + s.title, on: s.id === id, run: function () { api.open(s.id); } }; }));
            }, []).concat(['-', { label: 'Nouvelle session', icon: 'plus', run: function () { api.newSession(); } }]));
          } }, session ? session.title : 'Choisir une session', ' ', h(KLAI.Icon, { name: 'chevron', size: 12 })),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'close', iconOnly: true, label: 'Quitter le HUD', onClick: function () { KC.bridge.ext.hudClose(); } })),
      id ? h(KC.ChatPane, { sessionId: id, compact: true }) : h('div', { className: 'kc-blank', style: { padding: '24px' } }, h('p', null, state.loading ? 'Chargement…' : 'Aucune session.')),
      h(KC.Shell.Toasts, null));
  }

  var Root = params.get('mode') === 'hud' ? Hud : App;
  ReactDOM.createRoot(document.getElementById('root')).render(
    h(KC.Store.Provider, null, h(KC.OverlayHost, null, h(Root))));
})(window);
