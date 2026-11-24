/* Écran E′ — Projet ouvert : onglets de sessions, chronologie, conversation,
 * approbations et questions en ligne, sous-agents, composer, colonne Activité.
 * ChatPane est aussi utilisé par le HUD. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var React = global.React;
  var h = KC.h;
  var KLAI = global.KLAI;

  function argsPreview(args) {
    try {
      var o = typeof args === 'string' ? JSON.parse(args) : args;
      for (var k in o) if (typeof o[k] === 'string' && o[k]) return o[k].length > 70 ? o[k].slice(0, 70) + '…' : o[k];
    } catch (e) { /* arguments non JSON */ }
    var s = String(args || '');
    return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }

  /* Regroupe l'historique en tours : message utilisateur, puis outils et réponse. */
  function buildItems(messages) {
    var items = [];
    var pending = [];
    (messages || []).forEach(function (m, idx) {
      if (m.who === 'user') {
        if (pending.length) { items.push({ kind: 'answer', text: '', tools: pending, at: m.at, key: 'p' + idx }); pending = []; }
        items.push({ kind: 'user', text: m.text, at: m.at, key: 'u' + idx });
      } else if (m.who === 'tool') {
        for (var i = pending.length - 1; i >= 0; i--) {
          if (pending[i].result === undefined && (pending[i].tool === m.name || i === 0)) {
            pending[i].result = m.text;
            if (/^(BLOCKED|Error|error|Traceback)/.test(m.text || '')) pending[i].status = 'error';
            break;
          }
        }
      } else {
        (m.toolCalls || []).forEach(function (c) { pending.push({ tool: c.name, preview: argsPreview(c.args), status: 'done' }); });
        var tools = m.liveTools ? m.liveTools : pending;
        if (m.text || m.error || m.cancelled || m.liveTools) {
          items.push({ kind: 'answer', text: m.text, tools: tools, reasoning: m.reasoning, error: m.error, cancelled: m.cancelled,
            subagents: m.subagents, at: m.at, model: m.model, key: 'a' + idx });
          pending = [];
        }
      }
    });
    if (pending.length) items.push({ kind: 'answer', text: '', tools: pending, key: 'end' });
    return items;
  }
  KC.buildItems = buildItems;

  function ToolList(props) {
    var tools = props.tools || [];
    var o = React.useState(!!props.open), open = o[0], setOpen = o[1];
    if (!tools.length) return null;
    var running = tools.some(function (t) { return t.status === 'running'; });
    var failed = tools.filter(function (t) { return t.status === 'error'; }).length;
    var names = [];
    tools.forEach(function (t) { if (names.indexOf(t.tool) === -1) names.push(t.tool); });
    var total = tools.reduce(function (n, t) { return n + (t.duration || 0); }, 0);
    return h('div', { className: 'kc-tools' },
      h('button', { type: 'button', className: 'kc-plain kc-tools-sum', 'aria-expanded': open, onClick: function () { setOpen(!open); } },
        running ? h('span', { className: 'kc-dot kc-dot-live kc-dot-pulse' }) : h(KLAI.Icon, { name: failed ? 'close' : 'check', size: 14 }),
        h('span', { className: 'kc-ellipsis', style: { flex: 1 } },
          tools.length + ' outil' + (tools.length > 1 ? 's' : '') + ' · ' + names.slice(0, 4).join(' · ') + (names.length > 4 ? ' …' : '') + (failed ? ' · ' + failed + ' en échec' : '')),
        total ? h('span', null, KC.fmtDuration(total)) : null,
        h(KLAI.Icon, { name: 'chevron', size: 14, style: { transform: open ? 'rotate(180deg)' : 'none' } })),
      open ? h('div', { className: 'kc-tools-list' }, tools.map(function (t, i) {
        return h('div', { key: i, className: KC.cx('kc-tool', t.status === 'error' && 'is-err'), title: t.result || '' },
          t.status === 'running' ? h('span', { className: 'kc-dot kc-dot-live kc-dot-pulse', style: { marginTop: '4px' } }) : h(KLAI.Icon, { name: t.status === 'error' ? 'close' : 'check', size: 12 }),
          h('span', { style: { color: 'var(--ink)', fontWeight: 400 } }, t.tool),
          h('span', { className: 'kc-ellipsis' }, t.preview || (t.result ? String(t.result).slice(0, 120) : '')),
          h('span', null, t.duration ? KC.fmtDuration(t.duration) : ''));
      })) : null);
  }

  function Answer(props) {
    var it = props.item;
    var ctx = KC.Store.use(), api = ctx.api;
    return h('div', { className: 'kc-answer' },
      it.subagents && it.subagents.length ? h('div', { className: 'kc-notice kc-mono', style: { fontSize: '11.5px' } },
        it.subagents.map(function (s) { return 'sous-agent ' + s.name + ' · ' + KC.subStatus(s.status) + (s.summary ? ' — ' + s.summary : ''); }).join('\n')) : null,
      h(ToolList, { tools: it.tools }),
      it.reasoning ? h('details', { className: 'kc-reasoning' }, h('summary', null, 'Raisonnement'), it.reasoning) : null,
      it.text ? h(KC.Markdown, { text: it.text }) : null,
      it.error ? h('div', { className: 'kc-error-line' }, it.error) : null,
      it.cancelled ? h('div', { className: 'kc-notice' }, 'Tour interrompu.') : null,
      it.text ? h('div', { className: 'kc-answer-meta' },
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'copy', iconOnly: true, label: 'Copier',
          onClick: function () { navigator.clipboard.writeText(it.text); api.toast('Réponse copiée.'); } }),
        props.readOnly ? null : h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'branch', iconOnly: true, label: 'Créer une branche', onClick: function () { api.fork(props.sessionId); } }),
        props.onRegenerate ? h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'refresh', iconOnly: true, label: 'Régénérer', onClick: props.onRegenerate }) : null,
        h('span', { className: 'kc-stamp' }, [KC.fmtStamp(it.at), it.model].filter(Boolean).join(' · '))) : null);
  }

  function ApprovalCard(props) {
    var a = props.approval;
    var api = KC.Store.use().api;
    return h('div', { className: 'kc-card', role: 'group', 'aria-label': 'Approbation demandée' },
      h('div', { className: 'kc-todo-head' }, h(KLAI.StatusChip, { status: 'attention', label: 'Approbation' }), h('span', { className: 'kc-meta' }, a.description || 'Hermes attend votre accord')),
      a.command ? h('div', { className: 'kc-cmd' }, '$ ' + a.command) : null,
      h('div', { className: 'kc-row-actions' },
        h(KLAI.Button, { variant: 'primary', size: 'sm', onClick: function () { api.approve(props.sessionId, a, 'once'); } }, 'Approuver'),
        a.choices.indexOf('session') !== -1 ? h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { api.approve(props.sessionId, a, 'session'); } }, 'Pour la session') : null,
        a.choices.indexOf('always') !== -1 ? h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { api.approve(props.sessionId, a, 'always'); } }, 'Toujours') : null,
        h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { api.approve(props.sessionId, a, 'deny'); } }, 'Refuser')));
  }

  function ClarifyCard(props) {
    var c = props.clarify;
    var api = KC.Store.use().api;
    var v = React.useState(''), val = v[0], setVal = v[1];
    return h('form', { className: 'kc-card', onSubmit: function (e) { e.preventDefault(); if (val.trim()) api.answer(props.sessionId, c, val.trim()); } },
      h('div', { className: 'kc-todo-head' }, h(KLAI.StatusChip, { status: 'attention', label: 'Question' })),
      h('div', null, c.question),
      c.choices && c.choices.length
        ? h('div', { className: 'kc-row-actions' }, c.choices.map(function (ch, i) {
            var label = typeof ch === 'string' ? ch : (ch.label || ch.value);
            return h(KLAI.Button, { key: i, variant: i === 0 ? 'primary' : 'ghost', size: 'sm', onClick: function () { api.answer(props.sessionId, c, typeof ch === 'string' ? ch : ch.value || label); } }, label);
          }))
        : h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('input', { className: 'kc-input', style: { flex: 1 }, value: val, placeholder: 'Votre réponse', 'aria-label': 'Votre réponse', onChange: function (e) { setVal(e.target.value); } }),
            h(KLAI.Button, { variant: 'primary', size: 'sm', type: 'submit' }, 'Répondre')));
  }

  function SubagentBar(props) {
    var api = KC.Store.use().api;
    var s = React.useState(false), steering = s[0], setSteering = s[1];
    var t = React.useState(''), text = t[0], setText = t[1];
    var w = props.worker;
    var tick = React.useState(0)[1];
    React.useEffect(function () { var i = setInterval(function () { tick(Date.now()); }, 1000); return function () { clearInterval(i); }; }, []);
    return h('div', { className: 'kc-subbar' },
      h(KLAI.Overline, { label: 'Sous-agent', as: 'div' }),
      h(KLAI.StatusChip, { status: 'running' }),
      h('span', { className: 'kc-mono kc-ellipsis', style: { fontSize: '12px', flex: 1, minWidth: '160px' } }, w.name + ' · ' + KC.fmtDuration((Date.now() - w.at) / 1000)),
      steering
        ? h('form', { style: { display: 'flex', gap: '6px', flex: '1 1 100%' }, onSubmit: function (e) { e.preventDefault(); if (text.trim()) { api.steer(props.sessionId, text.trim()); setText(''); setSteering(false); } } },
            h('input', { className: 'kc-input', autoFocus: true, style: { flex: 1 }, value: text, placeholder: 'Consigne pour la prochaine étape', 'aria-label': 'Consigne', onChange: function (e) { setText(e.target.value); } }),
            h(KLAI.Button, { variant: 'primary', size: 'sm', type: 'submit' }, 'Envoyer'),
            h(KLAI.Button, { variant: 'ghost', size: 'sm', onClick: function () { setSteering(false); } }, 'Annuler'))
        : h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'steer', onClick: function () { setSteering(true); } }, 'Orienter'),
      steering ? null : h(KLAI.Button, { variant: 'danger', size: 'sm', onClick: function () { api.stop(props.sessionId); } }, 'Arrêter'));
  }

  /* ---------------- Composer ---------------- */
  var modelCache = null;
  function useModels(backend) {
    var m = React.useState(modelCache || []), models = m[0], setModels = m[1];
    React.useEffect(function () {
      if (modelCache || !KC.bridge || !backend || !backend.ok) return;
      KC.bridge.hermes.modelOptions().then(function (r) {
        var list = r.ok && r.models.length ? r.models : (backend.models || []).map(function (id) { return { id: id, label: id, provider: '' }; });
        modelCache = list;
        setModels(list);
      });
    }, [backend && backend.ok]);
    return models;
  }

  /* Sélecteur de modèle : recherche, regroupement par fournisseur, verrou de session. */
  function ModelPicker(props) {
    var q = React.useState(''), query = q[0], setQuery = q[1];
    var ref = React.useRef(null);
    React.useEffect(function () { ref.current && ref.current.focus(); }, []);
    var qn = query.trim().toLowerCase();
    var list = props.models.filter(function (m) {
      return !qn || (m.id + ' ' + m.label + ' ' + (m.providerName || '') + ' ' + (m.provider || '')).toLowerCase().indexOf(qn) !== -1;
    });
    var groups = [];
    var byProv = {};
    list.forEach(function (m) {
      var k = m.providerName || m.provider || 'Autres';
      if (!byProv[k]) { byProv[k] = []; groups.push(k); }
      byProv[k].push(m);
    });
    function item(label, sub, on, run, key) {
      return h('button', { key: key, type: 'button', className: KC.cx('kc-palette-item', on && 'is-on'), onClick: function () { run(); props.onClose(); } },
        h('span', { className: 'kc-ellipsis' }, label),
        sub ? h('span', { className: 'kc-mono kc-subtle kc-ellipsis', style: { fontSize: '11px', maxWidth: '260px' } }, sub) : null,
        on ? h('span', { className: 'kc-hint' }, 'actuel') : null);
    }
    return h('div', { className: 'kc-overlay', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); },
      onKeyDown: function (e) { if (e.key === 'Escape') props.onClose(); } },
      h('div', { className: 'kc-palette kc-pop', role: 'dialog', 'aria-label': 'Choisir le modèle' },
        h('input', { ref: ref, value: query, placeholder: 'Rechercher un modèle ou un fournisseur…', 'aria-label': 'Rechercher un modèle',
          onChange: function (e) { setQuery(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter' && list.length === 1) { props.onPick(list[0].id, list[0].provider); props.onClose(); } } }),
        h('div', { className: 'kc-palette-list' },
          !qn ? item('Modèle par défaut du gateway', props.defaultLabel || '', !props.model, function () { props.onPick('', ''); }, 'def') : null,
          props.model && props.onLock ? item('Verrouiller « ' + props.model + ' » sur cette session', 'POST /api/sessions/{id}/model', false, props.onLock, 'lock') : null,
          props.models.length === 0 ? h('div', { className: 'kc-palette-group kc-meta' }, 'Catalogue indisponible : le gateway n’a renvoyé aucun modèle.') : null,
          groups.map(function (g) {
            return [h('div', { key: 'g' + g, className: 'kc-palette-group' }, h(KLAI.Overline, { label: g, count: byProv[g].length, as: 'div' }))]
              .concat(byProv[g].map(function (m) {
                return item(m.label, m.label !== m.id ? m.id : '', props.model === m.id && (!props.provider || props.provider === m.provider),
                  function () { props.onPick(m.id, m.provider); }, g + m.id);
              }));
          }),
          qn && list.length === 0 ? h('div', { className: 'kc-palette-group kc-meta' }, 'Aucun modèle ne correspond.') : null)));
  }

  function Composer(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var v = React.useState(KC.local.get('draft:' + props.sessionId, '')), value = v[0], setValue = v[1];
    var at = React.useState([]), attachments = at[0], setAttachments = at[1];
    var hist = React.useRef(-1);
    var taRef = React.useRef(null);
    var fileRef = React.useRef(null);
    var models = useModels(state.backend);
    var mk = 'model:' + props.sessionId;
    var pk = 'provider:' + props.sessionId;
    var mm = React.useState(KC.local.get(mk, '') || (state.settings && state.settings.model) || ''), model = mm[0], setModel = mm[1];
    var pp = React.useState(KC.local.get(pk, '') || (state.settings && state.settings.provider) || ''), provider = pp[0], setProvider = pp[1];
    function choose(id, prov) { setModel(id); setProvider(prov || ''); KC.local.set(mk, id); KC.local.set(pk, prov || ''); }
    var lv = state.live[props.sessionId] || {};
    var busy = !!lv.busy;
    var ro = !!props.readOnly;
    var offline = !state.backend || !state.backend.ok;

    React.useEffect(function () { KC.local.set('draft:' + props.sessionId, value); }, [value]);
    React.useEffect(function () {
      var ta = taRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(240, ta.scrollHeight) + 'px';
    }, [value]);
    React.useEffect(function () { if (props.focusKey && taRef.current) taRef.current.focus(); }, [props.focusKey]);

    var prompts = (state.messages[props.sessionId] || []).filter(function (m) { return m.who === 'user'; }).map(function (m) { return m.text; });

    function submit() {
      var text = value.trim();
      if ((!text && !attachments.length) || busy || ro || offline) return;
      var full = text + attachments.map(function (a) { return '\n\n```' + (a.lang || '') + ' ' + a.name + '\n' + a.text + '\n```'; }).join('');
      setValue(''); setAttachments([]); hist.current = -1;
      api.send(props.sessionId, full, model, provider);
    }
    function onFiles(list) {
      Array.prototype.forEach.call(list || [], function (f) {
        if (f.size > 512 * 1024) { api.toast(f.name + ' : fichier trop lourd (512 Ko max).', 'error'); return; }
        f.text().then(function (text) {
          if (/\u0000/.test(text.slice(0, 1000))) { api.toast(f.name + ' : fichier binaire non pris en charge.', 'error'); return; }
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          setAttachments(function (prev) { return prev.concat([{ name: f.name, text: text, lang: ext.length <= 5 ? ext : '' }]); });
        });
      });
    }
    var pk2 = React.useState(false), picking = pk2[0], setPicking = pk2[1];
    function lockModel() {
      KC.bridge.hermes.setSessionModel(props.sessionId, model, provider).then(function (r) {
        api.toast(r.ok ? 'Modèle verrouillé sur la session.' : (r.status === 404 || r.status === 405 ? 'Ce gateway ne propose pas le verrou de modèle par session.' : 'Verrou refusé : ' + r.error), r.ok ? 'info' : 'error');
      });
    }

    var placeholder = ro ? 'Lecture seule : session tenue par une autre surface Hermes.'
      : offline ? 'Gateway injoignable.'
      : busy ? 'Hermes travaille… (Arrêter avec ⌘.)'
      : 'Donnez une tâche à Hermes' + (props.groupName ? ' dans ' + props.groupName : '') + '…';

    return h('div', { className: KC.cx('kc-composer', ro && 'is-ro'),
      onDragOver: function (e) { e.preventDefault(); }, onDrop: function (e) { e.preventDefault(); onFiles(e.dataTransfer.files); } },
      h('label', null, h('span', { className: 'kc-sr' }, 'Message'),
        h('textarea', { ref: taRef, rows: 1, value: value, disabled: ro, placeholder: placeholder,
          onChange: function (e) { setValue(e.target.value); },
          onKeyDown: function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); return; }
            if (e.key === 'Escape' && busy) { e.preventDefault(); api.stop(props.sessionId); return; }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (!value || hist.current !== -1) && prompts.length) {
              e.preventDefault();
              var n = hist.current === -1 ? prompts.length : hist.current;
              n = e.key === 'ArrowUp' ? Math.max(0, n - 1) : n + 1;
              if (n >= prompts.length) { hist.current = -1; setValue(''); } else { hist.current = n; setValue(prompts[n]); }
            }
          } })),
      attachments.length ? h('div', { className: 'kc-attach' }, attachments.map(function (a, i) {
        return h('span', { key: i }, a.name, h('button', { type: 'button', className: 'kc-tab-close', style: { opacity: 1 }, 'aria-label': 'Retirer ' + a.name,
          onClick: function () { setAttachments(attachments.filter(function (_, j) { return j !== i; })); } }, h(KLAI.Icon, { name: 'close', size: 12 })));
      })) : null,
      h('div', { className: 'kc-composer-bar' },
        h('input', { ref: fileRef, type: 'file', multiple: true, hidden: true, onChange: function (e) { onFiles(e.target.files); e.target.value = ''; } }),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Joindre un fichier texte', disabled: ro, onClick: function () { fileRef.current.click(); } }),
        h(KLAI.Button, { variant: 'ghost', size: 'sm', iconRight: 'chevron', disabled: ro, onClick: function () { setPicking(true); },
          title: ro ? 'Session en lecture seule : « Reprendre ici » pour écrire et choisir le modèle' : 'Modèle de cette session' },
          model ? (models.find(function (m) { return m.id === model; }) || { label: model }).label : 'Modèle par défaut'),
        picking ? h(ModelPicker, { models: models, model: model, provider: provider, onPick: choose, onLock: ro ? null : lockModel,
          defaultLabel: state.backend && state.backend.models && state.backend.models[0], onClose: function () { setPicking(false); } }) : null,
        h('div', { style: { flex: 1 } }),
        busy
          ? h(KLAI.Button, { variant: 'secondary', icon: 'stop', iconOnly: true, label: 'Arrêter le tour', onClick: function () { api.stop(props.sessionId); } })
          : h(KLAI.Button, { variant: 'primary', icon: 'send', iconOnly: true, label: 'Envoyer', disabled: ro || offline || (!value.trim() && !attachments.length), onClick: submit })));
  }

  /* ---------------- Volet de conversation ---------------- */
  function ChatPane(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var id = props.sessionId;
    var session = state.sessions.find(function (s) { return s.id === id; }) || { id: id, title: 'Session', readOnly: false };
    var messages = state.messages[id];
    var lv = state.live[id] || {};
    var items = React.useMemo(function () { return buildItems(messages); }, [messages]);
    var scrollRef = React.useRef(null);
    var follow = React.useRef(true);
    var userRefs = React.useRef({});
    var a = React.useState(-1), activeMark = a[0], setActiveMark = a[1];

    React.useEffect(function () { api.loadMessages(id); }, [id]);
    React.useEffect(function () {
      var el = scrollRef.current;
      if (el && follow.current) el.scrollTop = el.scrollHeight;
    }, [items.length, lv.text, lv.tools && lv.tools.length, lv.approvals && lv.approvals.length]);
    React.useEffect(function () { follow.current = true; var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [id]);

    var userItems = items.filter(function (it) { return it.kind === 'user'; });
    var lastUser = userItems.length ? userItems[userItems.length - 1].text : '';
    var running = (lv.subagents || []).filter(function (w) { return w.status === 'running'; });

    function onScroll(e) {
      var el = e.currentTarget;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      var top = el.scrollTop + 80;
      var current = -1;
      userItems.forEach(function (u, i) { var n = userRefs.current[u.key]; if (n && n.offsetTop <= top) current = i; });
      if (current !== activeMark) setActiveMark(current);
    }

    var lastAnswerIdx = -1;
    items.forEach(function (it, i) { if (it.kind === 'answer' && it.text) lastAnswerIdx = i; });

    return h('div', { className: 'kc-pane' },
      h('div', { className: 'kc-pane-body' },
        props.compact || userItems.length < 3 ? null : h('div', { role: 'navigation', 'aria-label': 'Chronologie des messages', className: 'kc-rail' },
          userItems.map(function (u, i) {
            return h('button', { key: u.key, type: 'button', className: (activeMark === -1 ? i === userItems.length - 1 : i === activeMark) ? 'is-on' : '',
              'aria-label': 'Message ' + (i + 1) + ' : ' + u.text.slice(0, 60), title: u.text.slice(0, 120),
              onClick: function () { var n = userRefs.current[u.key]; if (n) { follow.current = false; scrollRef.current.scrollTop = n.offsetTop - 24; } } });
          })),
        h('div', { ref: scrollRef, className: 'kc-transcript', onScroll: onScroll },
          h('div', { className: 'kc-col' },
            messages === undefined ? h('div', { className: 'kc-notice' }, 'Chargement de l’historique…') : null,
            messages && items.length === 0 && !lv.busy ? h('div', { className: 'kc-blank', style: { padding: '24px 0' } },
              h(KLAI.Overline, { label: session.readOnly ? 'Session en lecture seule' : 'Nouvelle session', as: 'div' }),
              h('p', null, session.readOnly ? 'Cette session appartient à une autre surface Hermes ; dérivez-la pour continuer ici.' : 'Donnez une première tâche à Hermes dans le composer ci-dessous.')) : null,
            items.map(function (it, i) {
              if (it.kind === 'user') return h('div', { key: it.key, ref: function (n) { userRefs.current[it.key] = n; }, className: 'kc-bubble' }, it.text);
              return h(Answer, { key: it.key, item: it, sessionId: id, readOnly: session.readOnly,
                onRegenerate: i === lastAnswerIdx && lastUser && !session.readOnly && !lv.busy ? function () { api.send(id, lastUser); } : null });
            }),
            lv.busy ? h('div', { className: 'kc-answer' },
              h(ToolList, { tools: lv.tools, open: true }),
              lv.reasoning ? h('details', { className: 'kc-reasoning' }, h('summary', null, 'Raisonnement en cours'), lv.reasoning) : null,
              lv.interim ? h('div', { className: 'kc-notice' }, lv.interim) : null,
              lv.text ? h(KC.Markdown, { text: lv.text }, h('span', { className: 'kc-cursor', 'aria-hidden': 'true' }))
                : h('div', { className: 'kc-notice', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { className: 'kc-dot kc-dot-live kc-dot-pulse' }), 'Hermes réfléchit…')) : null,
            (lv.approvals || []).map(function (ap) { return h(ApprovalCard, { key: ap.requestId, approval: ap, sessionId: id }); }),
            lv.clarify ? h(ClarifyCard, { clarify: lv.clarify, sessionId: id }) : null,
            (lv.notices || []).filter(Boolean).slice(-3).map(function (n, i) { return h('div', { key: 'n' + i, className: 'kc-notice' }, n); }),
            lv.pendingSteer ? h('div', { className: 'kc-notice' }, 'Consigne non délivrée avant la fin du tour : « ' + lv.pendingSteer + ' ».') : null))),
      h('div', { className: 'kc-bottom' },
        running.map(function (w, i) { return h(SubagentBar, { key: i, worker: w, sessionId: id }); }),
        session.readOnly ? h('div', { className: 'kc-ro-note' },
          h('span', { style: { flex: 1 } }, 'Session tenue par ' + (KC.sourceLabel(session.source) || 'une autre surface') + ' : visible en lecture seule.'),
          h(KLAI.Button, { variant: 'secondary', size: 'sm', icon: 'branch', onClick: function () { api.fork(id); } }, 'Reprendre ici')) : null,
        h(Composer, { sessionId: id, readOnly: session.readOnly, groupName: props.groupName, focusKey: props.focusKey })));
  }

  /* ---------------- Colonne Activité ---------------- */
  function ActivityAside(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var id = props.sessionId;
    var session = state.sessions.find(function (s) { return s.id === id; }) || {};
    var lv = state.live[id] || {};
    var tools = lv.busy ? lv.tools : (lv.lastTools && lv.lastTools.length ? lv.lastTools : (function () {
      var its = buildItems(state.messages[id]);
      for (var i = its.length - 1; i >= 0; i--) if (its[i].kind === 'answer' && its[i].tools && its[i].tools.length) return its[i].tools;
      return [];
    })());
    var elsewhere = [];
    props.groups.forEach(function (g) {
      if (g.key === props.groupKey) return;
      g.sessions.forEach(function (s) {
        var st = KC.sessionState(s, state.live[s.id]);
        if (st.status === 'running' || st.status === 'attention' || st.status === 'error') elsewhere.push({ s: s, st: st, g: g });
      });
    });
    var pct = Math.max(0, Math.min(100, Math.round(session.contextPct || 0)));
    return h('aside', { 'aria-label': 'Activité', className: 'kc-aside' },
      pct ? h(KLAI.ContextMeter, { label: 'Contexte', value: pct + ' %', segments: [{ label: 'Utilisé', percent: pct }] }) : null,
      h(KLAI.Panel, { title: 'Outils de ce tour' },
        tools.length === 0 ? h('div', { className: 'kc-meta' }, 'Aucun outil sur ce tour.') : null,
        h('div', { style: { display: 'flex', flexDirection: 'column' } }, tools.slice(-8).map(function (t, i) {
          return h('div', { key: i, style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-3)', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: '12.5px' } },
            h('span', { className: 'kc-ellipsis' }, h('span', { className: 'kc-mono', style: { fontWeight: 400, color: t.status === 'error' ? 'var(--danger)' : 'var(--ink)' } }, t.tool), ' ', h('span', { className: 'kc-muted' }, t.preview || '')),
            h('span', { className: 'kc-mono kc-muted', style: { fontSize: '11px' } }, t.status === 'running' ? '…' : (t.duration ? KC.fmtDuration(t.duration) : '')));
        }))),
      KC.Review ? h(KC.Review, { session: session }) : null,
      h(KLAI.Panel, { title: 'Session', meta: KC.sourceLabel(session.source) },
        h('div', { className: 'kc-meta', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('span', { className: 'kc-mono kc-ellipsis', title: session.id }, session.id),
          session.model ? h('span', null, 'Modèle : ' + session.model) : null,
          h('span', null, (session.messageCount || 0) + ' messages' + (session.started ? ' · ouverte ' + KC.fmtAgo(session.started) : '')),
          session.parentId ? h('span', null, 'Dérivée de ', h('button', { type: 'button', className: 'kc-link', onClick: function () { api.open(session.parentId); } }, session.parentId)) : null)),
      h(KLAI.Panel, { title: 'Ailleurs', actionLabel: 'Vue d’ensemble', actionHref: '#' },
        h('div', { onClick: function (e) { if (e.target.tagName === 'A') { e.preventDefault(); api.navigate('overview'); } } },
          elsewhere.length === 0 ? h('div', { className: 'kc-meta' }, 'Rien d’actif dans les autres projets.') : null,
          elsewhere.slice(0, 5).map(function (e) {
            return h('button', { key: e.s.id, type: 'button', className: 'kc-plain', style: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '9px 0', borderBottom: '1px solid var(--line)', width: '100%' },
              onClick: function () { api.open(e.s.id); } },
              h('span', { style: { display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' } },
                h('span', { className: 'kc-ellipsis', style: { flex: 1, fontWeight: 400 } }, e.s.title),
                h(KLAI.StatusChip, { status: e.st.status, label: e.st.label })),
              h('span', { className: 'kc-meta kc-ellipsis', style: { fontSize: '12px' } }, e.g.name + ' · ' + e.st.step));
          }))));
  }

  /* ---------------- Écran projet ---------------- */
  function Project(props) {
    var ctx = KC.Store.use(), state = ctx.state, api = ctx.api;
    var ov = KC.useOverlay();
    var groups = props.groups;
    var active = state.active;
    var group = groups.find(function (g) { return g.sessions.some(function (s) { return s.id === active; }); });
    if (!active) return h('main', { className: 'kc-main' }, h('div', { className: 'kc-blank' }, h('p', null, 'Aucune session ouverte.')));
    var inGroup = function (id) { return group ? group.sessions.some(function (s) { return s.id === id; }) : id === active; };
    var tabs = state.tabs.filter(inGroup);
    if (tabs.indexOf(active) === -1) tabs.push(active);
    var split = state.split && tabs.indexOf(state.split) !== -1 && state.split !== active ? state.split : null;
    var gIndex = group ? groups.indexOf(group) : -1;

    return h(React.Fragment, null,
      h('main', { className: 'kc-main is-flush' },
        h('div', { className: 'kc-proj-head' },
          h('div', { className: 'kc-proj-title' },
            h('div', { style: { flex: 1, minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' } },
                h(KLAI.Overline, { label: 'Projet ' + (gIndex >= 0 ? KC.pad2(gIndex + 1) : '—'), as: 'div' }),
                h('span', { className: 'kc-mono kc-muted kc-ellipsis', style: { fontSize: '11.5px' } }, group ? KC.shortPath(group.path) : '')),
              h('h1', { className: 'kc-h1' }, group ? group.name : 'Session')),
            group ? h('span', { className: 'kc-meta' }, tabs.length + ' session' + (tabs.length > 1 ? 's' : '') + ' ouverte' + (tabs.length > 1 ? 's' : '') + ' sur ' + group.sessions.length) : null,
            h(KLAI.Button, { size: 'sm', icon: 'split', disabled: tabs.length < 2 && !split, 'aria-pressed': !!split,
              onClick: function () {
                if (split) api.setSplit(null);
                else { var other = tabs.filter(function (t) { return t !== active; }); if (other.length) api.setSplit(other[other.length - 1]); }
              } }, split ? 'Une seule' : 'Côte à côte')),
          h('div', { role: 'tablist', 'aria-label': 'Sessions ouvertes', className: 'kc-tabs' },
            tabs.map(function (tid) {
              var s = state.sessions.find(function (x) { return x.id === tid; }) || { id: tid, title: tid };
              var st = KC.sessionState(s, state.live[tid]);
              var on = tid === active;
              return h('div', { key: tid, role: 'tab', 'aria-selected': on ? 'true' : 'false', tabIndex: 0, className: 'kc-tab',
                onClick: function () { api.open(tid); },
                onKeyDown: function (e) { if (e.key === 'Enter') api.open(tid); },
                onAuxClick: function (e) { if (e.button === 1) api.close(tid); },
                onContextMenu: function (e) { ov.menu(e, [{ label: 'Fermer l’onglet', run: function () { api.close(tid); } }, { label: 'Afficher à côté', icon: 'split', run: function () { api.setSplit(tid); } }, '-'].concat(KC.sessionMenu(ov, api, s))); } },
                h('span', { className: KC.dotClass(st.status), role: 'img', 'aria-label': st.label }),
                h('span', { className: 'kc-ellipsis' }, s.title),
                h('button', { type: 'button', className: 'kc-tab-close', 'aria-label': 'Fermer ' + s.title, onClick: function (e) { e.stopPropagation(); api.close(tid); } }, h(KLAI.Icon, { name: 'close', size: 12 })));
            }),
            h(KLAI.Button, { variant: 'ghost', size: 'sm', icon: 'plus', iconOnly: true, label: 'Nouvelle session' + (group ? ' dans ' + group.name : ''),
              onClick: function () { api.newSession(group); } }))),
        h('div', { className: 'kc-split' },
          h(ChatPane, { key: active, sessionId: active, groupName: group && group.name, focusKey: props.focusKey }),
          split ? h(ChatPane, { key: 'split-' + split, sessionId: split, groupName: group && group.name, compact: true }) : null)),
      h(ActivityAside, { sessionId: active, groups: groups, groupKey: group && group.key }));
  }

  KC.Screens = KC.Screens || {};
  KC.Screens.Project = Project;
  KC.ChatPane = ChatPane;
})(window);
