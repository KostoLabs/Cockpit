/* @ds-bundle: {"format":4,"namespace":"KLAI","components":[{"name":"Logo"},{"name":"Icon"},{"name":"Button"},{"name":"StatusChip"},{"name":"Badge"},{"name":"ProjectAvatar"},{"name":"NavItem"},{"name":"SearchField"},{"name":"Segmented"},{"name":"ContextMeter"},{"name":"Panel"},{"name":"Greeting"},{"name":"Overline"},{"name":"ProgressLine"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) { if (arguments[i]) out.push(arguments[i]); }
    return out.join(' ');
  }
  function pick(props, skip) {
    var out = {};
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k) || skip.indexOf(k) !== -1) continue;
      if (k === 'ariaLabel') out['aria-label'] = props[k];
      else if (k === 'ariaPressed') out['aria-pressed'] = props[k];
      else if (k === 'ariaCurrent') out['aria-current'] = props[k];
      else out[k] = props[k];
    }
    return out;
  }

  function has(c) { return c != null && c !== '' && c !== false && !(Array.isArray(c) && c.length === 0); }

  var MARK = 'M2 48C14 48 16 8 24 8C32 8 34 48 46 48ZM18 48C30 48 32 22 40 22C48 22 50 48 62 48Z';

  var ICONS = {
    plus: 'M12 5v14M5 12h14',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
    settings: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    hud: 'M4 14h16v5H4zM8 10h8',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    bot: 'M6 8h12v10H6zM12 4v4M9 13h.01M15 13h.01',
    capabilities: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
    chat: 'M4 5h16v11H8l-4 4z',
    artifact: 'M7 3h7l5 5v13H7zM14 3v5h5',
    clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z',
    terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4',
    check: 'M5 12l4 4 10-10',
    close: 'M6 6l12 12M18 6L6 18',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    send: 'M12 19V5M5 12l7-7 7 7',
    split: 'M4 5h16v14H4zM12 5v14',
    branch: 'M6 4v10M6 14a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM18 12c0 4-6 3-10 6',
    folder: 'M3 7h6l2 2h10v10H3z',
    chevron: 'M6 9l6 6 6-6',
    copy: 'M8 8h12v12H8zM4 16V4h12',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    pin: 'M12 17v4M8 3h8l-1 6 3 3H6l3-3z',
    stop: 'M7 7h10v10H7z',
    steer: 'M4 12h12M12 6l6 6-6 6'
  };

  function Mark(props) {
    return h('svg', { viewBox: '0 -4 64 64', width: props.size, height: props.size, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false', className: 'kl-mark' },
      h('path', { fillRule: 'evenodd', d: MARK }));
  }

  function Logo(props) {
    var variant = props.variant || 'lockup';
    var name = props.name || 'full';
    var size = Number(props.size) || 19;
    var tone = props.tone || 'ink';
    var label = name === 'short' ? 'KL AI' : 'KostoLabs AI';
    var base = { className: cx('kl-logo', 'kl-logo-' + tone, props.className), role: 'img', 'aria-label': label, style: props.style };
    var tileSize = Math.round(size * 1.5);
    var tile = h('span', { className: 'kl-logo-tile', style: { width: tileSize, height: tileSize, borderRadius: Math.max(6, Math.round(tileSize * 0.28)) } },
      h(Mark, { size: Math.round(tileSize * 0.68) }));
    if (variant === 'tile') return h('span', base, tile);
    if (variant === 'mark') return h('span', base, h(Mark, { size: Math.round(size * 1.6) }));
    var word = h('span', { className: 'kl-logo-word', style: { fontSize: size, gap: Math.round(size * 0.5) } },
      h('span', null, name === 'short' ? 'KL' : 'KostoLabs'),
      h('span', { className: size >= 40 ? 'kl-logo-ai kl-logo-ai-lg' : 'kl-logo-ai' }, 'AI'));
    var markEl = variant === 'lockup-mark' ? h(Mark, { size: Math.round(size * 1.15) }) : tile;
    return h('span', Object.assign({}, base, { style: Object.assign({ gap: Math.round(size * 0.5) }, props.style || {}) }), markEl, word);
  }

  function Icon(props) {
    var size = Number(props.size) || 18;
    var a = props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': 'true' };
    return h('svg', Object.assign({
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
      strokeWidth: props.strokeWidth || 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
      focusable: 'false', className: cx('kl-icon', props.className), style: props.style
    }, a), h('path', { d: ICONS[props.name] || ICONS.more }));
  }

  function Button(props) {
    var variant = props.variant || 'secondary';
    var size = props.size || 'md';
    var iconSize = size === 'sm' ? 15 : 17;
    var rest = pick(props, ['variant', 'size', 'icon', 'iconOnly', 'iconRight', 'children', 'className', 'label', 'href']);
    if (props.iconOnly && props.label && !rest['aria-label']) rest['aria-label'] = props.label;
    var cls = cx('kl-btn', 'kl-btn-' + variant, 'kl-btn-' + size, props.iconOnly && 'kl-btn-icon', props.className);
    var kids = [
      props.icon ? h(Icon, { key: 'i', name: props.icon, size: iconSize }) : null,
      props.iconOnly ? null : (has(props.children) ? props.children : props.label),
      props.iconRight ? h(Icon, { key: 'r', name: props.iconRight, size: iconSize }) : null
    ];
    if (props.href) return h.apply(null, ['a', Object.assign(rest, { href: props.href, className: cls })].concat(kids));
    return h.apply(null, ['button', Object.assign({ type: 'button' }, rest, { className: cls })].concat(kids));
  }

  var STATUS = { running: 'En cours', attention: 'À valider', error: 'Erreur', done: 'Terminée', idle: 'En veille' };
  function StatusChip(props) {
    var s = STATUS[props.status] ? props.status : 'idle';
    return h('span', { className: cx('kl-chip', 'kl-chip-' + s, props.className), style: props.style },
      h('span', { className: 'kl-chip-dot', 'aria-hidden': 'true' }),
      has(props.children) ? props.children : (props.label || STATUS[s]));
  }

  function Badge(props) {
    var tone = props.tone || 'neutral';
    return h('span', { className: cx('kl-badge', 'kl-badge-' + tone, props.className), style: props.style },
      has(props.children) ? props.children : props.label);
  }

  function ProjectAvatar(props) {
    var size = Number(props.size) || 28;
    var tone = props.tone || 'strong';
    var label = props.name ? props.name : null;
    return h('span', {
      className: cx('kl-avatar', 'kl-avatar-' + tone, props.className),
      style: Object.assign({ width: size, height: size, fontSize: Math.round(size * 0.39) }, props.style || {}),
      role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true'
    }, props.initials);
  }

  function NavItem(props) {
    var cls = cx('kl-nav', props.active && 'kl-nav-active', props.className);
    var count = has(props.count) ? h(Badge, { tone: props.countTone || 'neutral' }, String(props.count)) : null;
    return h('a', { href: props.href || '#', className: cls, 'aria-current': props.active ? 'page' : null, style: props.style },
      props.icon ? h(Icon, { name: props.icon }) : null,
      h('span', { className: 'kl-nav-label' }, has(props.children) ? props.children : props.label),
      count);
  }

  function SearchField(props) {
    return h('label', { className: cx('kl-search', props.className), style: props.style },
      h(Icon, { name: 'search', size: 16 }),
      h('input', { type: 'search', placeholder: props.placeholder || 'Rechercher…', 'aria-label': props.label || props.placeholder || 'Rechercher', defaultValue: props.defaultValue }),
      props.shortcut ? h('kbd', { className: 'kl-kbd' }, props.shortcut) : null);
  }

  function Segmented(props) {
    var opts = (props.options || []).map(function (o) { return typeof o === 'string' ? { value: o, label: o } : o; });
    var first = opts.length ? opts[0].value : null;
    var st = React.useState(props.defaultValue != null ? props.defaultValue : first);
    var current = props.value != null ? props.value : st[0];
    return h('div', { className: cx('kl-seg', props.block && 'kl-seg-block', props.size === 'sm' && 'kl-seg-sm', props.className), role: 'group', 'aria-label': props.label || null, style: props.style },
      opts.map(function (o) {
        return h('button', {
          key: o.value, type: 'button', className: 'kl-seg-opt', 'aria-pressed': o.value === current ? 'true' : 'false',
          onClick: function () { st[1](o.value); if (props.onChange) props.onChange(o.value); }
        }, o.label);
      }));
  }

  function ContextMeter(props) {
    var segs = props.segments || [];
    return h('div', { className: cx('kl-meter', props.className), style: props.style },
      h('div', { className: 'kl-meter-head' }, h('span', null, props.label || 'Contexte'), h('span', { className: 'kl-meter-num' }, props.value || '')),
      h('div', { className: 'kl-meter-bar', role: 'img', 'aria-label': (props.label || 'Contexte') + ' ' + (props.value || '') },
        segs.map(function (s, i) { return h('span', { key: i, className: 'kl-meter-seg kl-meter-s' + (i % 3), style: { width: (Number(s.percent) || 0) + '%' } }); })),
      h('div', { className: 'kl-meter-legend' },
        segs.map(function (s, i) { return h('span', { key: i }, h('span', { className: 'kl-meter-key kl-meter-s' + (i % 3), 'aria-hidden': 'true' }), s.label + ' ' + s.percent + ' %'); })));
  }

  function Panel(props) {
    var head = (props.title || props.actionLabel) ? h('div', { className: 'kl-panel-head' },
      props.title ? h('h2', { className: 'kl-panel-title' }, props.title) : null,
      props.meta ? h('span', { className: 'kl-panel-meta' }, props.meta) : null,
      props.actionLabel ? h('a', { className: 'kl-panel-action', href: props.actionHref || '#' }, props.actionLabel) : null) : null;
    return h('section', { className: cx('kl-panel', props.tone === 'strong' && 'kl-panel-strong', props.className), style: props.style }, head, props.children);
  }

  var GREETINGS = {
    night: ['Session nocturne', 'Encore debout, {name} ?', 'La nuit porte conseil', 'Calme plat sur les serveurs'],
    morning: ['Bonjour {name}', 'Café et code, {name} ?', 'On attaque, {name} ?', 'Belle journée pour livrer'],
    afternoon: ['Bon après-midi, {name}', 'On reprend, {name} ?', 'Prêt pour la suite ?', 'Deuxième souffle'],
    evening: ['Bonsoir {name}', 'Dernière ligne droite ?', 'Encore un tour, {name} ?', 'Fin de journée, on fait le point']
  };
  function daySlot(hr) { return hr < 6 ? 'night' : hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : hr < 23 ? 'evening' : 'night'; }
  function pickGreeting(name, hour, seed) {
    var pool = GREETINGS[daySlot(hour)];
    var i = seed != null ? Math.abs(Number(seed)) % pool.length : Math.floor(Math.random() * pool.length);
    var text = pool[i];
    return name ? text.replace('{name}', name) : text.replace(/,? ?\{name\}/, '');
  }
  function Greeting(props) {
    var hour = props.hour != null && props.hour !== '' ? Number(props.hour) : new Date().getHours();
    var st = React.useState(function () { return pickGreeting(props.name, hour, props.seed); });
    var size = Number(props.size) || 34;
    return h(props.as || 'h1', { className: cx('kl-greeting', props.className), style: Object.assign({ fontSize: size, lineHeight: Math.round(size * 1.18) + 'px' }, props.style || {}) }, st[0]);
  }

  function Overline(props) {
    var label = has(props.children) ? props.children : props.label;
    var count = has(props.count) ? ' — ' + props.count : '';
    return h(props.as || 'h2', { className: cx('kl-overline', props.className), style: props.style }, label, count);
  }

  function ProgressLine(props) {
    var v = Math.max(0, Math.min(100, Number(props.value) || 0));
    return h('div', { className: cx('kl-progress', props.className), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': v, 'aria-label': props.label || null, style: props.style },
      h('span', { className: 'kl-progress-fill', style: { width: v + '%' } }));
  }

  var api = { Logo: Logo, Icon: Icon, Button: Button, StatusChip: StatusChip, Badge: Badge, ProjectAvatar: ProjectAvatar, NavItem: NavItem, SearchField: SearchField, Segmented: Segmented, ContextMeter: ContextMeter, Panel: Panel, Greeting: Greeting, Overline: Overline, ProgressLine: ProgressLine, pickGreeting: pickGreeting, iconNames: Object.keys(ICONS) };
  window.KLAI = window.KLAI || {};
  Object.assign(window.KLAI, api);
})();
