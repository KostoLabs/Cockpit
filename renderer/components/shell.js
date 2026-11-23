/* Structure de l'app : barre du haut, navigation, barre d'état, palette, menus, dialogues. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;

  /* ---------------- Superpositions partagées (menu contextuel, dialogue) ---------------- */
  var OverlayCtx = React.createContext(null);

  function OverlayHost(props) {
    var m = React.useState(null), menu = m[0], setMenu = m[1];
    var d = React.useState(null), dialog = d[0], setDialog = d[1];
    var api = React.useMemo(function () {
      return {
        menu: function (e, items) { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items: items }); },
        prompt: function (opts) { return new Promise(function (resolve) { setDialog(Object.assign({ kind: 'prompt', resolve: resolve }, opts)); }); },
        confirm: function (opts) { return new Promise(function (resolve) { setDialog(Object.assign({ kind: 'confirm', resolve: resolve }, opts)); }); }
      };
    }, []);
    return h(OverlayCtx.Provider, { value: api }, props.children,
      menu ? h(ContextMenu, { menu: menu, onClose: function () { setMenu(null); } }) : null,
      dialog ? h(Dialog, { dialog: dialog, onClose: function (v) { dialog.resolve(v); setDialog(null); } }) : null);
  }

  function ContextMenu(props) {
    var ref = React.useRef(null);
    var menu = props.menu;
    React.useEffect(function () {
      var close = function () { props.onClose(); };
      var key = function (e) { if (e.key === 'Escape') props.onClose(); };
      setTimeout(function () { window.addEventListener('click', close); window.addEventListener('contextmenu', close); }, 0);
      window.addEventListener('keydown', key);
      var first = ref.current && ref.current.querySelector('button');
      if (first) first.focus();
      return function () { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); window.removeEventListener('keydown', key); };
    }, []);
    var x = Math.min(menu.x, window.innerWidth - 220);
    var y = Math.min(menu.y, window.innerHeight - 40 * menu.items.length - 20);
    return h('div', { ref: ref, role: 'menu', className: 'kc-menu kc-pop', style: { left: x, top: y } },
      menu.items.map(function (it, i) {
        if (it === '-') return h('hr', { key: i });
        return h('button', { key: i, role: 'menuitem', type: 'button', className: KC.cx(it.danger && 'is-danger', it.on && 'is-on'),
          onClick: function (e) { e.stopPropagation(); props.onClose(); it.run(); } },
          it.icon ? h(KLAI.Icon, { name: it.icon, size: 15 }) : null, it.label);
      }));
  }

  function Dialog(props) {
    var dlg = props.dialog;
    var v = React.useState(dlg.value || ''), value = v[0], setValue = v[1];
    var inputRef = React.useRef(null);
    var formRef = React.useRef(null);
    React.useEffect(function () {
      if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); return; }
      var btns = formRef.current && formRef.current.querySelectorAll('button');
      if (btns && btns.length) btns[btns.length - 1].focus();
    }, []);
    function submit(e) { e.preventDefault(); props.onClose(dlg.kind === 'prompt' ? value.trim() || null : true); }
    return h('div', { className: 'kc-overlay', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(null); },
      onKeyDown: function (e) { if (e.key === 'Escape') props.onClose(null); } },
      h('form', { ref: formRef, className: 'kc-dialog kc-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': dlg.title, onSubmit: submit },
        h(KLAI.Overline, { label: dlg.title, as: 'h2' }),
        dlg.text ? h('p', { style: { margin: 0, lineHeight: '21px' } }, dlg.text) : null,
        dlg.kind === 'prompt' ? h('label', { className: 'kc-field' }, h('span', null, dlg.label || 'Nom'),
          h('input', { ref: inputRef, className: 'kc-input', value: value, onChange: function (e) { setValue(e.target.value); } })) : null,
        h('div', { className: 'kc-row-actions', style: { justifyContent: 'flex-end' } },
          h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { props.onClose(null); } }, 'Annuler'),
          dlg.danger
            ? h(KLAI.Button, { variant: 'danger', size: 'sm', type: 'submit' }, dlg.ok || 'Supprimer')
            : h(KLAI.Button, { variant: 'primary', size: 'sm', type: 'submit' }, dlg.ok || 'Valider'))));
  }

  KC.useOverlay = function () { return React.useContext(OverlayCtx); };
  KC.OverlayHost = OverlayHost;

  /* Menu standard d'une session (clic droit). */
  KC.sessionMenu = function (ov, api, s) {
    var items = [
      { label: 'Ouvrir', icon: 'steer', run: function () { api.open(s.id); } },
      { label: 'Ouvrir dans le HUD', icon: 'hud', run: function () { KC.bridge.ext.hudOpen(s.id); } }
    ];
    if (!s.readOnly) items.push({ label: 'Renommer…', icon: 'more', run: function () {
      ov.prompt({ title: 'Renommer la session', label: 'Titre', value: s.title, ok: 'Renommer' }).then(function (t) { if (t) api.rename(s.id, t); });
    } });
    items.push({ label: s.readOnly ? 'Reprendre ici (dériver)' : 'Dériver une branche', icon: 'branch', run: function () { api.fork(s.id); } });
    items.push({ label: 'Copier l’identifiant', icon: 'copy', run: function () { navigator.clipboard.writeText(s.id); api.toast('Identifiant copié.'); } });
    if (!s.readOnly) {
      items.push('-');
      items.push({ label: 'Supprimer…', danger: true, run: function () {
        ov.confirm({ title: 'Supprimer la session', text: '« ' + s.title + ' » et son historique seront supprimés du gateway Hermes.', danger: true })
          .then(function (ok) { if (ok) api.remove(s.id); });
      } });
    }
    return items;
  };

  /* ---------------- Barre du haut ---------------- */
  function TopBar(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var mac = state.info && state.info.platform === 'darwin';
    return h('header', { className: KC.cx('kc-top', mac && 'is-mac') },
      h('a', { href: '#', className: 'kc-top-logo', 'aria-label': 'KostoLabs AI, vue d’ensemble',
        onClick: function (e) { e.preventDefault(); api.navigate('overview'); } },
        h(KLAI.Logo, { variant: 'lockup-mark', size: 19 })),
      h('div', { className: 'kc-top-search' },
        h('div', { onMouseDown: function (e) { e.preventDefault(); props.onPalette(); }, onFocus: function () { props.onPalette(); } },
          h(KLAI.SearchField, { placeholder: 'Projet, session, commande', shortcut: '⌘K' }))),
      h('div', { className: 'kc-top-actions' },
        h(KLAI.Button, { variant: 'primary', icon: 'plus', onClick: function () { props.onNewSession(); }, disabled: !state.backend || !state.backend.ok }, 'Nouvelle session'),
        h(KLAI.Button, { variant: 'ghost', icon: 'hud', iconOnly: true, label: 'Mode HUD', title: 'Mode HUD (⇧⌘H)',
          onClick: function () { KC.bridge && KC.bridge.ext.hudOpen(state.route === 'project' ? state.active : ''); } }),
        h(KLAI.Button, { variant: 'ghost', icon: 'settings', iconOnly: true, label: 'Réglages', title: 'Réglages (⌘,)',
          onClick: function () { api.navigate('settings'); } })));
  }

  /* ---------------- Navigation ---------------- */
  var NAV = [
    { route: 'overview', icon: 'grid', label: 'Vue d’ensemble' },
    { route: 'capabilities', icon: 'capabilities', label: 'Capacités' },
    { route: 'messaging', icon: 'chat', label: 'Messagerie' },
    { route: 'artifacts', icon: 'artifact', label: 'Artefacts' },
    { route: 'jobs', icon: 'clock', label: 'Tâches planifiées' },
    { route: 'terminal', icon: 'terminal', label: 'Terminal' },
    { route: 'sync', icon: 'refresh', label: 'Synchro' }
  ];
  KC.NAV = NAV;

  function SideNav(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var groups = props.groups;
    var activeSession = state.sessions.find(function (s) { return s.id === state.active; });
    var openGroupKey = state.route === 'project' && activeSession ? groups.find(function (g) { return g.sessions.indexOf(activeSession) !== -1; }) : null;
    var counts = props.counts;
    var expanded = React.useState({}), exp = expanded[0], setExp = expanded[1];
    return h('nav', { 'aria-label': 'Navigation', className: 'kc-nav' },
      h('div', { className: 'kc-nav-items' }, NAV.filter(function (n) { return KC.hasRoute(n.route); }).map(function (n) {
        var count = n.route === 'overview' ? (counts.todo || '') : n.route === 'jobs' ? (counts.jobsToday || '') : n.route === 'messaging' ? (counts.messaging || '') : '';
        return h('div', { key: n.route, onClick: function (e) { e.preventDefault(); api.navigate(n.route); } },
          h(KLAI.NavItem, { icon: n.icon, label: n.label, href: '#', active: state.route === n.route,
            count: count ? String(count) : '', countTone: n.route === 'overview' ? 'attention' : 'neutral' }));
      })),
      h('div', { className: 'kc-nav-projects' },
        h(KLAI.Overline, { label: 'Projets actifs', count: groups.length }),
        groups.length === 0 ? h('div', { className: 'kc-meta' }, state.loading ? 'Chargement…' : 'Aucune session.') : null,
        h('div', null, groups.slice(0, 14).map(function (g) {
          var isOpen = openGroupKey && openGroupKey.key === g.key;
          var full = exp[g.key];
          var list = isOpen ? (full ? g.sessions : g.sessions.slice(0, 3)) : [];
          return h('div', { key: g.key, className: 'kc-proj' },
            h('button', { type: 'button', className: 'kc-plain kc-proj-row', 'aria-current': isOpen ? 'page' : undefined,
              onClick: function () { api.open(g.sessions[0].id); } },
              h('span', { className: 'kc-proj-num' }, g.num),
              h('span', { className: KC.cx('kc-proj-name kc-ellipsis', isOpen && 'is-open') }, g.name),
              h('span', { className: 'kc-proj-live' }, g.live > 0 ? g.live + ' en cours' : '—'),
              g.attention + g.errors > 0 ? h('span', { className: 'kc-dot ' + (g.errors ? 'kc-dot-err' : 'kc-dot-wait'), style: { alignSelf: 'center' }, role: 'img',
                'aria-label': g.errors ? g.errors + ' erreur' : g.attention + ' élément à traiter' }) : null),
            isOpen ? h('div', { className: 'kc-proj-sessions' },
              list.map(function (s) {
                var st = KC.sessionState(s, state.live[s.id]);
                return h('button', { key: s.id, type: 'button', className: KC.cx('kc-plain kc-proj-sess', s.id === state.active && 'is-on'),
                  onClick: function () { api.open(s.id); }, onContextMenu: function (e) { ov.menu(e, KC.sessionMenu(ov, api, s)); } },
                  h('span', { className: KC.dotClass(st.status) }),
                  h('span', { className: 'kc-ellipsis', style: { flex: 1 } }, s.title));
              }),
              g.sessions.length > 3 ? h('button', { type: 'button', className: 'kc-link', style: { padding: '4px 0', textAlign: 'left' },
                onClick: function () { var n = Object.assign({}, exp); n[g.key] = !full; setExp(n); } },
                full ? 'Réduire' : 'Afficher les ' + g.sessions.length + ' sessions') : null) : null);
        })),
        h('button', { type: 'button', className: 'kc-link', style: { textAlign: 'left' }, onClick: function () { api.navigate('overview', 'all'); } }, 'Tous les projets')));
  }

  /* ---------------- Barre d'état ---------------- */
  function StatusBar(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var bk = state.backend;
    var up = bk && bk.ok;
    var counts = props.counts;
    var version = up && bk.health && (bk.health.version || bk.health.hermes_version);
    var model = (state.settings && state.settings.model) || (up && bk.models && bk.models[0]) || '';
    return h('footer', { className: 'kc-foot' },
      up
        ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, h('span', { className: 'kc-dot kc-dot-live' }), 'gateway connecté' + (version ? ' · hermes ' + version : ''))
        : h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--attention)' } }, h('span', { className: 'kc-dot kc-dot-wait' }),
            bk ? 'gateway injoignable' + (bk.status === 401 ? ' (clé refusée)' : '') : 'connexion au gateway…'),
      !up && bk ? h('button', { type: 'button', className: 'kc-link', style: { fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }, onClick: function () { api.refresh(true); } }, 'reconnecter') : null,
      h('div', { className: 'kc-spacer' }),
      counts.approvals ? h('span', { style: { color: 'var(--attention)' } }, counts.approvals + ' approbation' + (counts.approvals > 1 ? 's' : '')) : null,
      h('span', null, counts.live + ' session' + (counts.live > 1 ? 's' : '') + ' en cours'),
      h('span', null, counts.subagents + ' sous-agent' + (counts.subagents > 1 ? 's' : '')),
      model ? h('span', null, model) : null,
      state.info ? h('span', null, 'cockpit ' + state.info.version) : null);
  }

  /* ---------------- Palette de commandes (⌘K) ---------------- */
  function Palette(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var q = React.useState(''), query = q[0], setQuery = q[1];
    var c = React.useState(0), cursor = c[0], setCursor = c[1];
    var inputRef = React.useRef(null);
    React.useEffect(function () { inputRef.current && inputRef.current.focus(); }, []);

    var items = React.useMemo(function () {
      var out = [];
      out.push({ group: 'Actions', label: 'Nouvelle session', hint: '⌘N', icon: 'plus', run: props.onNewSession });
      KC.NAV.forEach(function (n) { out.push({ group: 'Aller à', label: n.label, icon: n.icon, run: function () { api.navigate(n.route); } }); });
      out.push({ group: 'Aller à', label: 'Réglages', icon: 'settings', hint: '⌘,', run: function () { api.navigate('settings'); } });
      out.push({ group: 'Actions', label: 'Mode HUD', icon: 'hud', hint: '⇧⌘H', run: function () { KC.bridge.ext.hudOpen(state.active || ''); } });
      out.push({ group: 'Actions', label: 'Reconnecter le gateway', icon: 'refresh', run: function () { api.refresh(true); } });
      out.push({ group: 'Actions', label: 'Thème clair', icon: 'more', run: function () { api.saveSettings({ theme: 'light' }); } });
      out.push({ group: 'Actions', label: 'Thème sombre', icon: 'more', run: function () { api.saveSettings({ theme: 'dark' }); } });
      out.push({ group: 'Actions', label: 'Thème du système', icon: 'more', run: function () { api.saveSettings({ theme: 'system' }); } });
      props.groups.forEach(function (g) {
        out.push({ group: 'Projets', label: g.name, sub: KC.shortPath(g.path), icon: 'folder', run: function () { api.open(g.sessions[0].id); } });
      });
      state.sessions.forEach(function (s) {
        out.push({ group: 'Sessions', label: s.title, sub: s.id, icon: 'chat', run: function () { api.open(s.id); } });
      });
      return out;
    }, [state.sessions, props.groups]);

    var qn = query.trim().toLowerCase();
    var shown = (qn ? items.filter(function (it) { return (it.label + ' ' + (it.sub || '') + ' ' + it.group).toLowerCase().indexOf(qn) !== -1; }) : items.filter(function (it) { return it.group !== 'Sessions'; })).slice(0, 60);
    var sel = Math.min(cursor, Math.max(0, shown.length - 1));
    function pick(it) { props.onClose(); setTimeout(it.run, 0); }
    var lastGroup = null;
    return h('div', { className: 'kc-overlay', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('div', { className: 'kc-palette kc-pop', role: 'dialog', 'aria-label': 'Palette de commandes' },
        h('input', { ref: inputRef, value: query, placeholder: 'Projet, session, commande…', 'aria-label': 'Rechercher',
          onChange: function (e) { setQuery(e.target.value); setCursor(0); },
          onKeyDown: function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(sel + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(Math.max(sel - 1, 0)); }
            else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); pick(shown[sel]); }
            else if (e.key === 'Escape') props.onClose();
          } }),
        h('div', { className: 'kc-palette-list', role: 'listbox' },
          shown.length === 0 ? h('div', { className: 'kc-palette-group kc-meta' }, 'Aucun résultat.') : null,
          shown.map(function (it, i) {
            var head = it.group !== lastGroup ? h('div', { key: 'g' + i, className: 'kc-palette-group' }, h(KLAI.Overline, { label: it.group, as: 'div' })) : null;
            lastGroup = it.group;
            return [head, h('button', { key: i, type: 'button', role: 'option', 'aria-selected': i === sel, className: KC.cx('kc-palette-item', i === sel && 'is-on'),
              onMouseEnter: function () { setCursor(i); }, onClick: function () { pick(it); } },
              h(KLAI.Icon, { name: it.icon || 'more', size: 16 }),
              h('span', { className: 'kc-ellipsis' }, it.label),
              it.sub ? h('span', { className: 'kc-mono kc-subtle kc-ellipsis', style: { fontSize: '11px', maxWidth: '200px' } }, it.sub) : null,
              it.hint ? h('span', { className: 'kc-hint' }, it.hint) : null)];
          }))));
  }

  /* ---------------- Notifications ---------------- */
  function Toasts() {
    var ctx = KC.Store.use();
    return h('div', { className: 'kc-toasts', role: 'status', 'aria-live': 'polite' },
      ctx.state.toasts.map(function (t) {
        return h('div', { key: t.id, className: KC.cx('kc-toast kc-pop', t.kind === 'error' && 'is-err') },
          h('span', { style: { flex: 1 } }, t.text),
          h('button', { type: 'button', className: 'kc-link', onClick: function () { ctx.api.dispatch({ type: 'dismiss', id: t.id }); } }, 'Fermer'));
      }));
  }

  /* ---------------- Recherche dans la page (⌘F) ---------------- */
  function FindBar(props) {
    var q = React.useState(''), query = q[0], setQuery = q[1];
    var ref = React.useRef(null);
    React.useEffect(function () { ref.current && ref.current.focus(); }, []);
    function go(back) { if (query && global.find) global.find(query, false, !!back, true, false, false, false); }
    return h('div', { className: 'kc-findbar kc-pop', role: 'search' },
      h('input', { ref: ref, value: query, placeholder: 'Rechercher dans la conversation', 'aria-label': 'Rechercher dans la conversation',
        onChange: function (e) { setQuery(e.target.value); },
        onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey); } if (e.key === 'Escape') props.onClose(); } }),
      h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'chevron', iconOnly: true, label: 'Suivant', onClick: function () { go(false); } }),
      h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'close', iconOnly: true, label: 'Fermer', onClick: props.onClose }));
  }

  KC.Shell = { TopBar: TopBar, SideNav: SideNav, StatusBar: StatusBar, Palette: Palette, Toasts: Toasts, FindBar: FindBar };
})(window);
