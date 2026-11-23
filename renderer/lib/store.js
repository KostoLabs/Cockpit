/* État global du cockpit : données du gateway, conversations en direct, onglets.
 * Un seul reducer ; les événements Hermes (klai:hermes:event) y entrent tels quels. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var B = KC.bridge;

  var initial = {
    settings: null,
    info: null,
    backend: null,           // null = pas encore sondé ; {ok, models, capabilities, health, error}
    loading: true,
    sessions: [],
    projects: [],
    jobs: [],
    messages: {},            // id -> [message] (undefined = non chargé)
    live: {},                // id -> état du tour en cours / dernier tour
    route: 'overview',
    tabs: KC.local.get('tabs', []),
    active: KC.local.get('active', null),
    split: null,
    filter: 'all',
    toasts: [],
    systemTheme: 'light'
  };

  function blankLive() {
    return { busy: false, runId: null, text: '', reasoning: '', interim: '', tools: [], subagents: [], approvals: [],
      clarify: null, notices: [], error: null, unread: false, startedAt: 0, lastTools: [] };
  }

  function patchLive(state, id, fn) {
    var cur = Object.assign(blankLive(), state.live[id] || {});
    var next = fn(cur) || cur;
    var live = Object.assign({}, state.live);
    live[id] = next;
    return Object.assign({}, state, { live: live });
  }

  function appendMessage(state, id, msg) {
    var messages = Object.assign({}, state.messages);
    messages[id] = (messages[id] || []).concat([msg]);
    return Object.assign({}, state, { messages: messages });
  }

  function finalize(state, id, kind, ev) {
    var lv = Object.assign(blankLive(), state.live[id] || {});
    var msg = null;
    if (lv.text || lv.tools.length || kind !== 'done') {
      msg = { who: 'assistant', text: lv.text, reasoning: lv.reasoning, liveTools: lv.tools, subagents: lv.subagents, at: Date.now(),
        error: kind === 'error' ? (ev.text || 'Le tour a échoué.') : null, cancelled: kind === 'cancelled' };
    }
    var s = msg ? appendMessage(state, id, msg) : state;
    return patchLive(s, id, function (l) {
      return Object.assign(l, { busy: false, text: '', reasoning: '', interim: '', lastTools: l.tools, tools: [], approvals: [], clarify: null, notices: [],
        error: kind === 'error' ? (ev.text || 'Le tour a échoué.') : null, unread: state.active !== id || state.route !== 'project',
        pendingSteer: ev && ev.pendingSteer || '' });
    });
  }

  function onEvent(state, ev) {
    var id = ev.session;
    switch (ev.type) {
      case 'start':
        return patchLive(state, id, function (l) {
          return Object.assign(blankLive(), { busy: true, startedAt: Date.now(), lastTools: l.lastTools });
        });
      case 'run': return patchLive(state, id, function (l) { l.runId = ev.runId; });
      case 'delta': return patchLive(state, id, function (l) { l.text += ev.text || ''; l.interim = ''; });
      case 'reasoning': return patchLive(state, id, function (l) { l.reasoning += ev.text || ''; });
      case 'interim': return patchLive(state, id, function (l) { l.interim = ev.text || ''; });
      case 'notice': return patchLive(state, id, function (l) { l.notices = l.notices.concat([ev.text]); });
      case 'tool':
        return patchLive(state, id, function (l) {
          var tools = l.tools.slice();
          if (ev.phase === 'started') tools.push({ tool: ev.tool, preview: ev.preview, status: 'running', at: Date.now(), id: ev.id });
          else {
            var idx = -1;
            for (var i = tools.length - 1; i >= 0; i--) {
              if (tools[i].status === 'running' && (ev.id ? tools[i].id === ev.id : tools[i].tool === ev.tool)) { idx = i; break; }
            }
            var done = { tool: ev.tool, status: ev.error ? 'error' : 'done', duration: ev.duration, result: ev.preview };
            if (idx >= 0) tools[idx] = Object.assign({}, tools[idx], done);
            else tools.push(Object.assign({ at: Date.now() }, done));
          }
          l.tools = tools;
        });
      case 'subagent':
        return patchLive(state, id, function (l) {
          var subs = l.subagents.slice();
          if (ev.phase === 'start') subs.push({ name: ev.name, delegationId: ev.delegationId, status: 'running', at: Date.now() });
          else {
            var j = -1;
            for (var k = subs.length - 1; k >= 0; k--) if (subs[k].status === 'running' && subs[k].name === ev.name) { j = k; break; }
            var fin = { name: ev.name, status: ev.status || 'completed', summary: ev.summary, duration: ev.duration, childSessionId: ev.childSessionId };
            if (j >= 0) subs[j] = Object.assign({}, subs[j], fin); else subs.push(Object.assign({ at: Date.now() }, fin));
          }
          l.subagents = subs;
        });
      case 'approval': return patchLive(state, id, function (l) { l.approvals = l.approvals.concat([Object.assign({ at: Date.now(), runId: ev.runId || l.runId }, ev)]); });
      case 'clarify': return patchLive(state, id, function (l) { l.clarify = Object.assign({ runId: ev.runId || l.runId }, ev); });
      case 'done': return finalize(state, id, 'done', ev);
      case 'cancelled': return finalize(state, id, 'cancelled', ev);
      case 'error': {
        var st = finalize(state, id, 'error', ev);
        if (ev.code === 'read_only') {
          st = Object.assign({}, st, { sessions: st.sessions.map(function (s) { return s.id === id ? Object.assign({}, s, { readOnly: true }) : s; }) });
        }
        return st;
      }
      case 'detached': return patchLive(state, id, function (l) { l.busy = false; l.notices = l.notices.concat(['Le tour continue côté gateway (' + ev.status + ').']); });
      case 'end': return patchLive(state, id, function (l) { l.busy = false; l.approvals = []; l.clarify = null; });
      default: return state;
    }
  }

  function reducer(state, a) {
    switch (a.type) {
      case 'settings': return Object.assign({}, state, { settings: a.settings });
      case 'info': return Object.assign({}, state, { info: a.info });
      case 'backend': return Object.assign({}, state, { backend: a.backend });
      case 'systemTheme': return Object.assign({}, state, { systemTheme: a.value });
      case 'data': {
        var next = { loading: false };
        if (a.sessions) {
          // conserve les sessions créées localement pas encore listées
          var known = {};
          a.sessions.forEach(function (s) { known[s.id] = true; });
          var pending = state.sessions.filter(function (s) { return s.localOnly && !known[s.id]; });
          next.sessions = pending.concat(a.sessions.map(function (s) {
            var prev = state.sessions.find(function (p) { return p.id === s.id; });
            return prev && prev.readOnly && !s.readOnly ? Object.assign({}, s, { readOnly: true }) : s;
          }));
        }
        if (a.projects) next.projects = a.projects;
        if (a.jobs) next.jobs = a.jobs;
        return Object.assign({}, state, next);
      }
      case 'loading': return Object.assign({}, state, { loading: a.value });
      case 'messages': {
        var m = Object.assign({}, state.messages);
        m[a.id] = a.messages;
        return Object.assign({}, state, { messages: m });
      }
      case 'append': return appendMessage(state, a.id, a.message);
      case 'event': return onEvent(state, a.ev);
      case 'upsertSession': {
        var exists = state.sessions.some(function (s) { return s.id === a.session.id; });
        return Object.assign({}, state, { sessions: exists
          ? state.sessions.map(function (s) { return s.id === a.session.id ? Object.assign({}, s, a.session) : s; })
          : [a.session].concat(state.sessions) });
      }
      case 'removeSession':
        return Object.assign({}, state, {
          sessions: state.sessions.filter(function (s) { return s.id !== a.id; }),
          tabs: state.tabs.filter(function (t) { return t !== a.id; }),
          active: state.active === a.id ? null : state.active
        });
      case 'route': return Object.assign({}, state, { route: a.route }, a.filter ? { filter: a.filter } : {});
      case 'filter': return Object.assign({}, state, { filter: a.value });
      case 'open': {
        var tabs = state.tabs.indexOf(a.id) === -1 ? state.tabs.concat([a.id]).slice(-12) : state.tabs;
        var s2 = Object.assign({}, state, { tabs: tabs, active: a.id, route: 'project' });
        return state.live[a.id] && state.live[a.id].unread ? patchLive(s2, a.id, function (l) { l.unread = false; }) : s2;
      }
      case 'close': {
        var rest = state.tabs.filter(function (t) { return t !== a.id; });
        var idx = state.tabs.indexOf(a.id);
        var nextActive = state.active === a.id ? (rest[Math.min(idx, rest.length - 1)] || null) : state.active;
        return Object.assign({}, state, { tabs: rest, active: nextActive, split: state.split === a.id ? null : state.split,
          route: !nextActive && state.route === 'project' ? 'overview' : state.route });
      }
      case 'split': return Object.assign({}, state, { split: a.id });
      case 'markRead': return patchLive(state, a.id, function (l) { l.unread = false; l.error = null; });
      case 'dropApproval': return patchLive(state, a.id, function (l) { l.approvals = l.approvals.filter(function (x) { return x.requestId !== a.requestId; }); });
      case 'clearClarify': return patchLive(state, a.id, function (l) { l.clarify = null; });
      case 'toast': return Object.assign({}, state, { toasts: state.toasts.concat([a.toast]).slice(-4) });
      case 'dismiss': return Object.assign({}, state, { toasts: state.toasts.filter(function (t) { return t.id !== a.id; }) });
      default: return state;
    }
  }

  var Ctx = React.createContext(null);

  function Provider(props) {
    var pair = React.useReducer(reducer, initial);
    var state = pair[0], dispatch = pair[1];
    var stateRef = React.useRef(state);
    stateRef.current = state;

    var api = React.useMemo(function () {
      var toastSeq = 0;
      function toast(text, kind) {
        var id = ++toastSeq;
        dispatch({ type: 'toast', toast: { id: id, text: text, kind: kind || 'info' } });
        setTimeout(function () { dispatch({ type: 'dismiss', id: id }); }, kind === 'error' ? 7000 : 3500);
      }

      async function refresh(full) {
        if (!B) { dispatch({ type: 'loading', value: false }); return; }
        var st = stateRef.current;
        var jobs = null;
        if (full || !st.backend || !st.backend.ok) {
          var backend = await B.hermes.status();
          dispatch({ type: 'backend', backend: backend });
          if (!backend.ok) { dispatch({ type: 'data', sessions: [], projects: [] }); return; }
        }
        var res = await Promise.all([B.hermes.sessions({ limit: 200 }), full ? B.hermes.projects() : null, B.hermes.jobs()]);
        if (!res[0].ok) {
          dispatch({ type: 'backend', backend: { ok: false, error: res[0].error, status: res[0].status } });
          dispatch({ type: 'loading', value: false });
          return;
        }
        jobs = res[2] && res[2].ok ? res[2].jobs : [];
        dispatch({ type: 'data', sessions: res[0].sessions, projects: res[1] && res[1].ok ? res[1].projects : undefined, jobs: jobs });
      }

      async function loadMessages(id, force) {
        if (!B || !id) return;
        if (!force && stateRef.current.messages[id] !== undefined) return;
        var r = await B.hermes.messages(id);
        dispatch({ type: 'messages', id: id, messages: r.ok ? r.messages : [] });
        if (!r.ok && r.status !== 404) toast('Historique indisponible : ' + r.error, 'error');
      }

      function open(id) {
        dispatch({ type: 'open', id: id });
        loadMessages(id);
      }

      async function newSession(group) {
        if (!B) return null;
        var body = {};
        if (group && group.path) body.cwd = group.path;
        var r = await B.hermes.createSession(body);
        if (!r.ok && body.cwd) r = await B.hermes.createSession({});
        if (!r.ok) { toast('Création impossible : ' + r.error, 'error'); return null; }
        var s = Object.assign({}, r.session, { localOnly: true, title: r.session.title === 'Session sans titre' ? 'Nouvelle session' : r.session.title,
          workspace: r.session.workspace || (group && group.path) || '', updated: Date.now() });
        dispatch({ type: 'upsertSession', session: s });
        dispatch({ type: 'messages', id: s.id, messages: [] });
        dispatch({ type: 'open', id: s.id });
        return s;
      }

      async function send(id, text, model) {
        if (!B || !text.trim()) return;
        dispatch({ type: 'append', id: id, message: { who: 'user', text: text, at: Date.now() } });
        dispatch({ type: 'markRead', id: id });
        var sess = stateRef.current.sessions.find(function (x) { return x.id === id; });
        var r = await B.hermes.send({ sessionId: id, input: text, model: model || '', cwd: sess && sess.workspace || '' });
        if (r && r.ok === false && r.error && !r.readOnly && !r.cancelled) toast(r.error, 'error');
      }

      async function stop(id) { if (B) await B.hermes.stop({ sessionId: id }); }

      async function approve(id, a, choice) {
        dispatch({ type: 'dropApproval', id: id, requestId: a.requestId });
        var r = await B.hermes.approve({ sessionId: id, runId: a.runId, requestId: a.requestId, generation: a.generation, choice: choice });
        if (!r.ok) {
          toast('Approbation refusée par le gateway : ' + r.error, 'error');
          dispatch({ type: 'event', ev: Object.assign({}, a, { session: id, type: 'approval' }) });
        } else {
          dispatch({ type: 'event', ev: { session: id, type: 'notice', text: choice === 'deny' ? 'Commande refusée.' : 'Commande approuvée (' + choiceLabel(choice) + ').' } });
        }
        return r;
      }

      async function answer(id, c, text) {
        dispatch({ type: 'clearClarify', id: id });
        var r = await B.hermes.clarify({ sessionId: id, runId: c.runId, requestId: c.requestId, generation: c.generation, answer: text });
        if (!r.ok) toast('Réponse non transmise : ' + r.error, 'error');
      }

      async function steer(id, text) {
        var r = await B.hermes.steer({ sessionId: id, text: text });
        if (!r.ok) toast('Orientation impossible : ' + r.error, 'error');
        else toast('Consigne transmise à la prochaine étape.');
      }

      async function rename(id, title) {
        var r = await B.hermes.renameSession(id, title);
        if (!r.ok) return toast('Renommage impossible : ' + r.error, 'error');
        dispatch({ type: 'upsertSession', session: { id: id, title: title } });
      }

      async function fork(id, title) {
        var r = await B.hermes.forkSession(id, title);
        if (!r.ok) { toast('Dérivation impossible : ' + r.error, 'error'); return null; }
        dispatch({ type: 'upsertSession', session: Object.assign({ localOnly: true, updated: Date.now() }, r.session) });
        open(r.session.id);
        toast('Session dérivée : la suite se passe ici.');
        return r.session;
      }

      async function remove(id) {
        var r = await B.hermes.deleteSession(id);
        if (!r.ok) return toast('Suppression impossible : ' + r.error, 'error');
        dispatch({ type: 'removeSession', id: id });
      }

      async function saveSettings(next) {
        var s = await B.settings.set(next);
        dispatch({ type: 'settings', settings: s });
        return s;
      }

      return {
        dispatch: dispatch, toast: toast, refresh: refresh, loadMessages: loadMessages, open: open, newSession: newSession,
        send: send, stop: stop, approve: approve, answer: answer, steer: steer, rename: rename, fork: fork, remove: remove,
        saveSettings: saveSettings,
        navigate: function (route, filter) { dispatch({ type: 'route', route: route, filter: filter }); },
        close: function (id) { dispatch({ type: 'close', id: id }); },
        setSplit: function (id) { dispatch({ type: 'split', id: id }); }
      };
    }, []);

    /* Démarrage : réglages, infos, première synchro, abonnements. */
    React.useEffect(function () {
      if (!B) { dispatch({ type: 'loading', value: false }); return; }
      B.settings.get().then(function (s) { dispatch({ type: 'settings', settings: s }); });
      B.app.info().then(function (i) { dispatch({ type: 'info', info: i }); });
      api.refresh(true);
      var offs = [
        B.on('klai:hermes:event', function (ev) {
          dispatch({ type: 'event', ev: ev });
          if (ev.type === 'end') refreshSoon(ev.session);
        }),
        B.on('klai:settings', function (s) { dispatch({ type: 'settings', settings: s }); }),
        B.on('klai:system-theme', function (t) { dispatch({ type: 'systemTheme', value: t }); })
      ];
      var refreshSoon = KC.debounce(function (sid) {
        api.refresh(false);
        if (sid) api.loadMessages(sid, true);
      }, 1200);
      return function () { offs.forEach(function (o) { o(); }); };
    }, []);

    /* Rafraîchissement périodique. */
    var poll = (state.settings && state.settings.pollSeconds) || 15;
    React.useEffect(function () {
      if (!B) return;
      var t = setInterval(function () { api.refresh(!stateRef.current.backend || !stateRef.current.backend.ok); }, Math.max(5, poll) * 1000);
      return function () { clearInterval(t); };
    }, [poll]);

    /* Onglets mémorisés par appareil. */
    React.useEffect(function () { KC.local.set('tabs', state.tabs); KC.local.set('active', state.active); }, [state.tabs, state.active]);

    /* Thème. */
    React.useEffect(function () {
      var t = state.settings && state.settings.theme;
      var resolved = t === 'system' ? state.systemTheme : (t || 'light');
      document.documentElement.setAttribute('data-theme', resolved === 'dark' ? 'dark' : 'light');
    }, [state.settings && state.settings.theme, state.systemTheme]);
    React.useEffect(function () {
      if (global.matchMedia) {
        var mq = global.matchMedia('(prefers-color-scheme: dark)');
        dispatch({ type: 'systemTheme', value: mq.matches ? 'dark' : 'light' });
      }
    }, []);

    return h(Ctx.Provider, { value: { state: state, api: api } }, props.children);
  }

  function choiceLabel(c) { return { once: 'une fois', session: 'pour la session', always: 'toujours', deny: 'refus' }[c] || c; }

  KC.Store = { Provider: Provider, use: function () { return React.useContext(Ctx); }, reducer: reducer, choiceLabel: choiceLabel };
})(window);
