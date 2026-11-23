/* Rendu Markdown → éléments React, sans innerHTML (aucune injection possible).
 * Couvre ce que produit Hermes : titres, paragraphes, listes (numérotées en index
 * mono comme dans E′), citations, blocs de code, tableaux, filets, gras, italique,
 * code en ligne, liens et liens nus. */
(function (global) {
  'use strict';
  var KC = global.KC;
  var h = KC.h;
  var React = global.React;

  function openLink(e, url) {
    e.preventDefault();
    if (KC.bridge && KC.bridge.app) KC.bridge.app.openExternal(url);
  }

  var INLINE = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|(^|[^\w])_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)|(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/;

  function inline(text, keyBase) {
    var out = [];
    var rest = String(text || '');
    var k = 0;
    while (rest) {
      var m = INLINE.exec(rest);
      if (!m) { out.push(rest); break; }
      var before = rest.slice(0, m.index);
      if (m[6] !== undefined) before += m[6];
      if (before) out.push(before);
      var key = keyBase + '-' + (k++);
      if (m[2] !== undefined) out.push(h('code', { key: key }, m[2]));
      else if (m[3] !== undefined || m[4] !== undefined) out.push(h('strong', { key: key }, inline(m[3] || m[4], key)));
      else if (m[5] !== undefined) out.push(h('em', { key: key }, inline(m[5], key)));
      else if (m[7] !== undefined) out.push(h('em', { key: key }, inline(m[7], key)));
      else if (m[8] !== undefined) out.push(h('a', { key: key, href: m[9], onClick: function (u) { return function (e) { openLink(e, u); }; }(m[9]) }, m[8]));
      else if (m[10] !== undefined) out.push(h('a', { key: key, href: m[10], onClick: function (u) { return function (e) { openLink(e, u); }; }(m[10]) }, m[10]));
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  function isTableSep(l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l); }
  function cells(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); }

  function parse(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var l = lines[i];
      var fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(l);
      if (fence) {
        var code = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + fence[1] + '\\s*$').test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        blocks.push({ t: 'code', lang: fence[2], text: code.join('\n') });
        continue;
      }
      if (/^\s*$/.test(l)) { i++; continue; }
      var hd = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (hd) { blocks.push({ t: 'h', level: hd[1].length, text: hd[2] }); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { blocks.push({ t: 'hr' }); i++; continue; }
      if (/^\s*>/.test(l)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        blocks.push({ t: 'quote', text: q.join('\n') });
        continue;
      }
      if (/\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var head = cells(l);
        var rows = [];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        blocks.push({ t: 'table', head: head, rows: rows });
        continue;
      }
      var li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
      if (li) {
        var ordered = /\d/.test(li[2]);
        var items = [];
        var start = ordered ? parseInt(li[2], 10) : 1;
        while (i < lines.length) {
          var m2 = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (m2 && (/\d/.test(m2[2]) === ordered) && m2[1].length < 4) { items.push(m2[3]); i++; continue; }
          if (m2 && m2[1].length >= 2) { items[items.length - 1] += '\n' + lines[i].trim(); i++; continue; }
          if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        blocks.push({ t: ordered ? 'ol' : 'ul', items: items, start: start });
        continue;
      }
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*(```|~~~)/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) blocks.push({ t: 'p', text: para.map(function (x) { return / {2,}$/.test(x) ? x.replace(/ +$/, '') + '\n' : x + ' '; }).join('').trim() });
      else i++;
    }
    return blocks;
  }

  function render(block, i) {
    var key = 'b' + i;
    switch (block.t) {
      case 'h': return h('h' + Math.min(block.level + 1, 6), { key: key }, inline(block.text, key));
      case 'hr': return h('hr', { key: key });
      case 'quote': return h('blockquote', { key: key }, h(Markdown, { text: block.text }));
      case 'code': return h('pre', { key: key },
        block.lang ? h('span', { className: 'kc-pre-lang' }, block.lang) : null,
        h('code', null, block.text));
      case 'table': return h('table', { key: key },
        h('thead', null, h('tr', null, block.head.map(function (c, j) { return h('th', { key: j }, inline(c, key + 'h' + j)); }))),
        h('tbody', null, block.rows.map(function (r, j) {
          return h('tr', { key: j }, r.map(function (c, n) { return h('td', { key: n }, inline(c, key + 'r' + j + n)); }));
        })));
      case 'ol': return h('ol', { key: key, className: 'kc-md-ol' }, block.items.map(function (it, j) {
        return h('li', { key: j }, h('span', { className: 'kc-li-n', 'aria-hidden': 'true' }, KC.pad2(block.start + j)), h('span', null, inline(it, key + 'i' + j)));
      }));
      case 'ul': return h('ul', { key: key }, block.items.map(function (it, j) { return h('li', { key: j }, inline(it, key + 'i' + j)); }));
      default: return h('p', { key: key }, inline(block.text, key));
    }
  }

  function Markdown(props) {
    var blocks = React.useMemo(function () { return parse(props.text); }, [props.text]);
    return h('div', { className: 'kc-md' }, blocks.map(function (b, i) { return render(b, i); }), props.children);
  }

  KC.Markdown = Markdown;
  KC.parseMarkdown = parse;
})(window);
