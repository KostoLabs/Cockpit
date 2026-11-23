/* Écrans de travail : Revue Git (panneau « Revoir » de E′), Terminal, Artefacts. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;
  var B = KC.bridge;

  /* ---------------- Diff ---------------- */
  function DiffView(props) {
    var lines = String(props.text || '').split('\n');
    return h('pre', { className: 'kc-term', style: { margin: 0, maxHeight: '60vh', overflow: 'auto', background: 'var(--surface-muted)', padding: '12px 16px', borderRadius: 'var(--radius-sm)' } },
      lines.map(function (l, i) {
        var c = /^\+(?!\+\+)/.test(l) ? 'var(--ink)' : /^-(?!--)/.test(l) ? 'var(--danger)' : /^@@/.test(l) ? 'var(--ink-subtle)' : 'var(--ink-muted)';
        var bg = /^\+(?!\+\+)/.test(l) ? 'var(--surface-strong)' : 'transparent';
        return h('div', { key: i, style: { color: c, background: bg } }, l || ' ');
      }));
  }

  function DiffModal(props) {
    React.useEffect(function () {
      var k = function (e) { if (e.key === 'Escape') props.onClose(); };
      global.addEventListener('keydown', k);
      return function () { global.removeEventListener('keydown', k); };
    }, []);
    return h('div', { className: 'kc-overlay', style: { paddingTop: '6vh' }, onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('div', { className: 'kc-pop', role: 'dialog', 'aria-label': 'Diff de ' + props.file, style: { width: '900px', maxWidth: 'calc(100vw - 32px)', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px' } },
          h(KLAI.Overline, { label: props.scopeLabel, as: 'div' }),
          h('span', { className: 'kc-mono kc-ellipsis', style: { flex: 1, fontSize: '12px' } }, props.file),
          h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'close', iconOnly: true, label: 'Fermer', onClick: props.onClose })),
        props.loading ? h('div', { className: 'kc-meta' }, 'Chargement…') : props.error ? h('div', { className: 'kc-error-line' }, props.error) : h(DiffView, { text: props.text || '(aucune différence)' })));
  }

  /* ---------------- Revue Git (panneau de la colonne Activité) ---------------- */
  var SCOPES = [{ value: 'uncommitted', label: 'Non validé' }, { value: 'branch', label: 'Branche' }, { value: 'turn', label: 'Dernier tour' }];

  function Review(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var cwd = props.session && props.session.workspace;
    var sid = props.session && props.session.id;
    var sc = React.useState('uncommitted'), scope = sc[0], setScope = sc[1];
    var st = React.useState(null), status = st[0], setStatus = st[1];
    var fl = React.useState(null), files = fl[0], setFiles = fl[1];
    var dv = React.useState(null), diff = dv[0], setDiff = dv[1];
    var lv = state.live[sid] || {};

    function load() {
      if (!B || !cwd) return;
      B.ext.gitStatus(cwd).then(setStatus);
      B.ext.gitDiff(cwd, scope, '', sid).then(setFiles);
    }
    React.useEffect(load, [cwd, scope, sid, lv.busy]);

    if (!cwd) return h(KLAI.Panel, { title: 'Revoir' }, h('div', { className: 'kc-meta' }, 'Session sans dossier de travail.'));
    if (status && !status.ok) return h(KLAI.Panel, { title: 'Revoir' }, h('div', { className: 'kc-meta' }, status.error));
    var meta = status ? status.branch + (status.head ? ' · ' + status.head : '') + (status.ahead ? ' · ↑' + status.ahead : '') + (status.behind ? ' · ↓' + status.behind : '') : '';
    var list = files && files.ok ? files.files : [];
    var staged = status && status.ok ? status.files.filter(function (f) { return f.staged; }).map(function (f) { return f.path; }) : [];
    var scopeLabel = SCOPES.find(function (s) { return s.value === scope; }).label;

    function openDiff(f) {
      setDiff({ file: f.path, loading: true });
      B.ext.gitDiff(cwd, scope, f.path, sid).then(function (r) { setDiff({ file: f.path, text: r.text, error: r.ok ? '' : r.error }); });
    }
    function toggleStage(f) {
      var on = staged.indexOf(f.path) === -1;
      B.ext.gitStage(cwd, [f.path], on).then(function (r) { if (!r.ok) api.toast(r.error, 'error'); load(); });
    }
    function commitFlow(push) {
      if (!staged.length) return api.toast('Indexez au moins un fichier (clic sur la case).', 'error');
      ov.prompt({ title: push ? 'Valider et pousser' : 'Valider', label: 'Message de commit', ok: push ? 'Valider et pousser' : 'Valider' }).then(function (msg) {
        if (!msg) return;
        B.ext.gitCommit(cwd, msg, push).then(function (r) { api.toast(r.ok ? 'Commit créé' + (push ? ' et poussé.' : '.') : r.error, r.ok ? 'info' : 'error'); load(); });
      });
    }

    return h(KLAI.Panel, { title: 'Revoir', meta: meta },
      h(KLAI.Segmented, { options: SCOPES, value: scope, onChange: setScope, block: true, size: 'sm', label: 'Vue de la revue' }),
      !files ? h('div', { className: 'kc-meta' }, 'Lecture du dépôt…') : null,
      files && !files.ok ? h('div', { className: 'kc-meta' }, files.error) : null,
      files && files.ok && list.length === 0 ? h('div', { className: 'kc-meta' }, files.note || 'Aucune différence' + (scope === 'turn' ? ' sur ce tour.' : '.')) : null,
      h('div', { style: { display: 'flex', flexDirection: 'column' } }, list.slice(0, 30).map(function (f) {
        var isStaged = staged.indexOf(f.path) !== -1;
        return h('div', { key: f.path, style: { display: 'grid', gridTemplateColumns: scope === 'uncommitted' ? '18px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto', gap: '8px', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: '12.5px' } },
          scope === 'uncommitted' ? h('input', { type: 'checkbox', checked: isStaged, 'aria-label': (isStaged ? 'Retirer de l’index ' : 'Indexer ') + f.path, onChange: function () { toggleStage(f); }, style: { accentColor: 'var(--ink)', margin: 0 } }) : null,
          h('button', { type: 'button', className: 'kc-plain kc-mono kc-ellipsis', style: { fontSize: '12px' }, title: f.path, onClick: function () { openDiff(f); } }, f.path),
          h('span', { className: 'kc-mono', style: { fontSize: '11px', whiteSpace: 'nowrap' } },
            f.untracked ? h('span', { className: 'kc-muted' }, 'nouveau') : [h('span', { key: 'a' }, f.added != null ? '+' + f.added : ''), ' ', h('span', { key: 'r', style: { color: 'var(--danger)' } }, f.removed != null ? '−' + f.removed : '')]));
      })),
      list.length > 30 ? h('div', { className: 'kc-meta' }, '+ ' + (list.length - 30) + ' fichiers') : null,
      scope === 'uncommitted' && list.length ? h('div', { className: 'kc-row-actions' },
        h(KLAI.Button, { size: 'sm', onClick: function () { commitFlow(false); } }, 'Valider'),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { commitFlow(true); } }, 'Valider et pousser'),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'chat', onClick: function () {
          api.send(sid, 'Relis les changements non validés de ce dépôt, propose un message de commit, puis ouvre une pull request.');
        }, disabled: props.session.readOnly }, 'Demander à Hermes')) : null,
      diff ? h(DiffModal, Object.assign({ scopeLabel: scopeLabel, onClose: function () { setDiff(null); } }, diff)) : null);
  }
  KC.Review = Review;

  /* ---------------- Terminal ---------------- */
  var termSeq = 0;
  function Terminal(props) {
    var ctx = KC.Store.use(), state = ctx.state;
    var r = React.useState(KC.local.get('term:runs', []).slice(-20)), runs = r[0], setRuns = r[1];
    var c = React.useState(''), cmd = c[0], setCmd = c[1];
    var groups = props.groups;
    var dirs = [];
    groups.forEach(function (g) { if (g.path && dirs.indexOf(g.path) === -1) dirs.push(g.path); });
    var d = React.useState(KC.local.get('term:cwd', dirs[0] || '')), cwd = d[0], setCwd = d[1];
    var outRef = React.useRef(null);
    var histIdx = React.useRef(-1);

    React.useEffect(function () {
      if (!B) return;
      return B.on('klai:terminal', function (ev) {
        setRuns(function (prev) {
          return prev.map(function (run) {
            if (run.id !== ev.id) return run;
            if (ev.kind === 'exit') return Object.assign({}, run, { running: false, code: ev.code, signal: ev.signal, duration: ev.duration });
            var out = (run.out + (ev.kind === 'err' ? '\u0000' : '') + ev.data);
            if (out.length > 200000) out = out.slice(-200000);
            return Object.assign({}, run, { out: out });
          });
        });
      });
    }, []);
    React.useEffect(function () { KC.local.set('term:runs', runs.filter(function (x) { return !x.running; }).slice(-20).map(function (x) { return Object.assign({}, x, { out: x.out.slice(-8000) }); })); }, [runs]);
    React.useEffect(function () { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [runs]);

    function exec(e) {
      e.preventDefault();
      var command = cmd.trim();
      if (!command || !B) return;
      if (command === 'clear') { setRuns([]); setCmd(''); return; }
      var id = 't' + Date.now() + '-' + (++termSeq);
      setRuns(function (prev) { return prev.concat([{ id: id, cmd: command, cwd: cwd, out: '', running: true, at: Date.now() }]).slice(-30); });
      setCmd(''); histIdx.current = -1;
      KC.local.set('term:cwd', cwd);
      B.ext.termRun(id, cwd, command).then(function (res) {
        if (!res.ok) setRuns(function (prev) { return prev.map(function (x) { return x.id === id ? Object.assign({}, x, { running: false, out: '\u0000' + res.error, code: -1 }) : x; }); });
      });
    }
    var history = runs.map(function (x) { return x.cmd; });
    var active = runs.filter(function (x) { return x.running; });

    return h(KC.Page, { overline: 'Terminal', title: 'Commandes locales',
      meta: 'Chaque commande s’exécute dans votre shell, sur cet appareil, dans le dossier choisi. Pas de programmes plein écran (vim, top) : utilisez votre terminal pour ceux-là.',
      actions: active.length ? h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { active.forEach(function (x) { B.ext.termKill(x.id); }); } }, 'Interrompre') : null },
      h('div', { ref: outRef, className: 'kc-term', style: { padding: 'var(--space-6) 0', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }, role: 'log', 'aria-live': 'polite' },
        runs.length === 0 ? h('div', { className: 'kc-meta' }, 'Aucune commande pour l’instant.') : null,
        runs.map(function (run) {
          var parts = run.out.split('\u0000');
          return h('div', { key: run.id, style: { marginBottom: '16px' } },
            h('div', { className: 'is-cmd' }, h('span', { className: 'kc-subtle' }, KC.shortPath(run.cwd) + ' $ '), run.cmd),
            h('div', { className: 'kc-term-out' }, parts.map(function (p, i) { return h('span', { key: i, className: i > 0 ? 'is-err' : '' }, p); })),
            run.running ? h('div', { className: 'kc-subtle' }, h('span', { className: 'kc-dot kc-dot-live kc-dot-pulse' }), ' en cours…')
              : h('div', { className: 'kc-subtle', style: { fontSize: '11px' } }, (run.code === 0 ? 'terminé' : 'code ' + (run.code != null ? run.code : run.signal)) + (run.duration ? ' · ' + KC.fmtDuration(run.duration) : '')));
        })),
      h('form', { onSubmit: exec, style: { display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', borderTop: '1px solid var(--rule)', paddingTop: 'var(--space-4)' } },
        h('label', { className: 'kc-field', style: { width: '260px' } }, h('span', null, 'Dossier'),
          h('select', { className: 'kc-select is-mono', value: cwd, onChange: function (e) { setCwd(e.target.value); } },
            h('option', { value: '' }, '~ (dossier personnel)'),
            dirs.map(function (p) { return h('option', { key: p, value: p }, KC.shortPath(p)); }))),
        h('label', { className: 'kc-field', style: { flex: 1 } }, h('span', null, 'Commande'),
          h('input', { className: 'kc-input is-mono', value: cmd, autoFocus: true, spellCheck: false, placeholder: 'git status', onChange: function (e) { setCmd(e.target.value); },
            onKeyDown: function (e) {
              if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
                e.preventDefault();
                var n = histIdx.current === -1 ? history.length : histIdx.current;
                n = e.key === 'ArrowUp' ? Math.max(0, n - 1) : n + 1;
                if (n >= history.length) { histIdx.current = -1; setCmd(''); } else { histIdx.current = n; setCmd(history[n]); }
              }
            } })),
        h(KLAI.Button, { variant: 'primary', type: 'submit', icon: 'terminal' }, 'Exécuter')));
  }

  /* ---------------- Artefacts ---------------- */
  var WRITE_TOOLS = /^(write_file|create_file|edit_file|patch|apply_patch|str_replace_editor|save_file|image_generate|generate_image|vision_analyze|export)/i;

  function collectArtifacts(sessions, messages) {
    var out = [];
    var seen = {};
    sessions.forEach(function (s) {
      (messages[s.id] || []).forEach(function (m) {
        (m.toolCalls || []).forEach(function (c) {
          if (!WRITE_TOOLS.test(c.name)) return;
          var args = {};
          try { args = JSON.parse(c.args); } catch (e) { return; }
          var p = args.path || args.file_path || args.filename || args.output_path || args.target;
          if (!p || typeof p !== 'string') return;
          var abs = p.charAt(0) === '/' ? p : (s.workspace ? s.workspace.replace(/\/$/, '') + '/' + p.replace(/^\.\//, '') : p);
          var key = 'f:' + abs;
          if (seen[key]) return;
          seen[key] = true;
          out.push({ kind: /\.(png|jpe?g|gif|webp|svg)$/i.test(abs) ? 'image' : 'fichier', label: KC.baseName(abs), target: abs, tool: c.name, session: s, at: m.at || s.updated });
        });
        if (m.who === 'assistant' && m.text) {
          (m.text.match(/https?:\/\/[^\s<)\]]+[^\s<)\].,;:!?'"]/g) || []).forEach(function (u) {
            var key = 'l:' + u;
            if (seen[key]) return;
            seen[key] = true;
            out.push({ kind: 'lien', label: u.replace(/^https?:\/\//, '').slice(0, 80), target: u, session: s, at: m.at || s.updated });
          });
        }
      });
    });
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }
  KC.collectArtifacts = collectArtifacts;

  function Artifacts() {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var q = React.useState(''), query = q[0], setQuery = q[1];
    var k = React.useState('all'), kind = k[0], setKind = k[1];
    var pv = React.useState(null), preview = pv[0], setPreview = pv[1];
    var recent = state.sessions.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }).slice(0, 20);
    React.useEffect(function () { recent.forEach(function (s) { api.loadMessages(s.id); }); }, [recent.map(function (s) { return s.id; }).join()]);
    var all = React.useMemo(function () { return collectArtifacts(recent, state.messages); }, [state.messages, state.sessions]);
    var qn = query.trim().toLowerCase();
    var list = all.filter(function (a) { return (kind === 'all' || a.kind === kind) && (!qn || (a.label + ' ' + a.target + ' ' + a.session.title).toLowerCase().indexOf(qn) !== -1); });
    var loaded = recent.filter(function (s) { return state.messages[s.id] !== undefined; }).length;

    function open(a) {
      if (a.kind === 'lien') return B.app.openExternal(a.target);
      B.ext.openPath(a.target).then(function (r) { if (!r.ok) api.toast(r.error, 'error'); });
    }
    function show(a) {
      setPreview({ a: a, loading: true });
      B.ext.readFile(a.target).then(function (r) { setPreview({ a: a, text: r.ok ? r.text : '', error: r.ok ? '' : r.error }); });
    }

    return h(KC.Page, { overline: 'Artefacts — ' + all.length, title: 'Ce que vos sessions ont produit',
      meta: 'Fichiers écrits et liens cités dans les ' + recent.length + ' sessions les plus récentes' + (loaded < recent.length ? ' (lecture ' + loaded + '/' + recent.length + ')' : '') + '.',
      actions: h('div', { style: { display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end' } },
        h('div', { style: { width: '220px' } }, h('label', { className: 'kl-search' }, h(KLAI.Icon, { name: 'search', size: 16 }),
          h('input', { type: 'search', placeholder: 'Filtrer', 'aria-label': 'Filtrer les artefacts', value: query, onChange: function (e) { setQuery(e.target.value); } }))),
        h(KLAI.Segmented, { value: kind, onChange: setKind, label: 'Type', options: [{ value: 'all', label: 'Tout' }, { value: 'fichier', label: 'Fichiers' }, { value: 'image', label: 'Images' }, { value: 'lien', label: 'Liens' }] })) },
      h('div', { className: 'kc-table' },
        list.length === 0 ? h('div', { className: 'kc-empty' }, loaded < recent.length ? 'Lecture des sessions…' : 'Aucun artefact.') : null,
        list.slice(0, 200).map(function (a, i) {
          return h('div', { key: i, className: 'kc-tr', style: { gridTemplateColumns: '64px minmax(0, 1.4fr) minmax(0, 1fr) 110px auto' } },
            h('span', { className: 'kc-mono kc-subtle', style: { fontSize: '11px' } }, a.kind),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              h('span', { className: 'kc-ellipsis', style: { fontWeight: 400 } }, a.label),
              h('span', { className: 'kc-mono kc-muted kc-ellipsis', style: { fontSize: '11px' }, title: a.target }, KC.shortPath(a.target))),
            h('button', { type: 'button', className: 'kc-plain kc-meta kc-ellipsis', onClick: function () { api.open(a.session.id); } }, a.session.title),
            h('span', { className: 'kc-meta' }, KC.fmtAgo(a.at)),
            h('span', { style: { display: 'flex', gap: '2px' } },
              a.kind === 'fichier' ? h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { show(a); } }, 'Aperçu') : null,
              h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { open(a); } }, 'Ouvrir'),
              a.kind !== 'lien' ? h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'folder', iconOnly: true, label: 'Afficher dans le Finder', onClick: function () { B.ext.revealPath(a.target).then(function (r) { if (!r.ok) api.toast(r.error, 'error'); }); } }) : null));
        })),
      preview ? h(DiffModal, { scopeLabel: 'Aperçu', file: preview.a.target, loading: preview.loading, error: preview.error,
        text: preview.text, onClose: function () { setPreview(null); } }) : null);
  }

  KC.Screens.Terminal = Terminal;
  KC.Screens.Artifacts = Artifacts;
})(window);
