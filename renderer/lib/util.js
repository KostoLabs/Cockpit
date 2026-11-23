/* Utilitaires partagés du renderer. Espace de noms : window.KC. */
(function (global) {
  'use strict';
  var KC = global.KC = global.KC || {};
  var React = global.React;
  KC.h = React.createElement;

  KC.cx = function () {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  };

  KC.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  KC.fmtAgo = function (ms) {
    if (!ms) return '';
    var mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return 'à l’instant';
    if (mins < 60) return 'il y a ' + mins + ' min';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return 'il y a ' + hrs + ' h';
    var days = Math.round(hrs / 24);
    if (days < 60) return 'il y a ' + days + ' j';
    return 'il y a ' + Math.round(days / 30) + ' mois';
  };

  KC.fmtTime = function (ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return KC.pad2(d.getHours()) + ':' + KC.pad2(d.getMinutes());
  };

  KC.fmtStamp = function (ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var today = new Date();
    var time = KC.fmtTime(ms);
    if (d.toDateString() === today.toDateString()) return 'aujourd’hui, ' + time;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' + time;
  };

  KC.fmtDuration = function (sec) {
    if (!sec && sec !== 0) return '';
    if (sec < 1) return Math.round(sec * 1000) + ' ms';
    if (sec < 60) return (Math.round(sec * 10) / 10) + ' s';
    var m = Math.floor(sec / 60);
    return m + ' min ' + KC.pad2(Math.round(sec % 60));
  };

  KC.today = function () {
    return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  /* ~/… pour les chemins sous le dossier personnel. */
  KC.shortPath = function (p) {
    if (!p) return '';
    return String(p).replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~');
  };
  KC.baseName = function (p) {
    var parts = String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || String(p || '');
  };
  function isHome(p) { return /^\/(Users|home)\/[^/]+\/?$/.test(p || '') || /^[A-Z]:\\Users\\[^\\]+\\?$/i.test(p || ''); }

  var SOURCE_LABEL = { api_server: 'cockpit', api: 'cockpit', cli: 'CLI', tui: 'TUI', desktop: 'Desktop', telegram: 'Telegram',
    discord: 'Discord', slack: 'Slack', whatsapp: 'WhatsApp', signal: 'Signal', matrix: 'Matrix', teams: 'Teams', cron: 'tâche planifiée', acp: 'ACP' };
  KC.sourceLabel = function (s) { return SOURCE_LABEL[String(s || '').toLowerCase()] || s || ''; };
  KC.MESSAGING = /^(telegram|discord|slack|whatsapp|signal|matrix|teams|sms|email|mattermost|irc)$/i;

  /* Regroupe les sessions par dossier de travail (ou projet Hermes s'il existe). */
  KC.groupSessions = function (sessions, projects, live) {
    var projById = {};
    (projects || []).forEach(function (p) { if (p && p.id) projById[p.id] = p; });
    var byKey = {};
    var groups = [];
    (sessions || []).forEach(function (s) {
      if (s.archived) return;
      var proj = s.projectId && projById[s.projectId];
      var key = proj ? 'p:' + proj.id : 'w:' + (s.workspace || '');
      var g = byKey[key];
      if (!g) {
        var name = proj ? proj.name : (!s.workspace ? 'Sans dossier' : isHome(s.workspace) ? 'Accueil' : KC.baseName(s.workspace));
        g = byKey[key] = { key: key, name: name, path: s.workspace || '', sessions: [] };
        groups.push(g);
      }
      g.sessions.push(s);
    });
    groups.forEach(function (g) {
      g.sessions.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      g.live = 0; g.attention = 0; g.errors = 0;
      g.sessions.forEach(function (s) {
        var st = KC.sessionState(s, live && live[s.id]);
        if (st.status === 'running') g.live++;
        if (st.status === 'attention') g.attention++;
        if (st.status === 'error') g.errors++;
      });
      g.last = g.sessions.length ? g.sessions[0].updated || 0 : 0;
    });
    groups.sort(function (a, b) {
      var aa = a.live + a.attention + a.errors > 0 ? 1 : 0;
      var bb = b.live + b.attention + b.errors > 0 ? 1 : 0;
      return bb - aa || (b.last || 0) - (a.last || 0);
    });
    groups.forEach(function (g, i) { g.num = KC.pad2(i + 1); });
    return groups;
  };

  /* État affiché d'une session : point, libellé et étape. */
  KC.sessionState = function (s, lv) {
    if (lv && lv.approvals && lv.approvals.length) return { status: 'attention', label: 'Approbation', step: 'Attend votre accord' };
    if (lv && lv.clarify) return { status: 'attention', label: 'Question', step: 'Hermes vous pose une question' };
    if (lv && lv.busy) {
      var t = lv.tools && lv.tools.length ? lv.tools[lv.tools.length - 1] : null;
      return { status: 'running', label: 'En cours', step: t && t.status === 'running' ? t.tool + (t.preview ? ' · ' + t.preview : '') : (lv.text ? 'Hermes écrit…' : 'Hermes réfléchit…') };
    }
    if (lv && lv.error) return { status: 'error', label: 'Erreur', step: lv.error };
    if (s && s.attention) return { status: 'attention', label: 'À traiter', step: 'Attend une action' };
    if (s && s.streaming) return { status: 'running', label: 'En cours', step: 'Tour en cours (' + KC.sourceLabel(s.source) + ')' };
    if (s && /error|fail/i.test(s.endReason || '')) return { status: 'error', label: 'Erreur', step: 'Dernier tour en échec' };
    if (lv && lv.unread) return { status: 'done', label: 'À relire', step: 'Réponse non lue' };
    var bits = [];
    if (s) {
      bits.push((s.messageCount || 0) + ' message' + ((s.messageCount || 0) > 1 ? 's' : ''));
      if (s.updated) bits.push(KC.fmtAgo(s.updated));
      if (s.source && !/^api/i.test(s.source)) bits.push(KC.sourceLabel(s.source));
    }
    var recent = s && s.updated && Date.now() - s.updated < 36e5;
    return { status: recent ? 'done' : 'idle', label: recent ? 'Terminée' : 'En veille', step: bits.join(' · ') };
  };

  KC.subStatus = function (st) {
    return { completed: 'terminé', complete: 'terminé', success: 'terminé', failed: 'en échec', error: 'en échec', timeout: 'délai dépassé', cancelled: 'annulé', running: 'en cours' }[String(st || '').toLowerCase()] || st || 'terminé';
  };

  KC.dotClass = function (status) {
    return { running: 'kc-dot kc-dot-live kc-dot-pulse', attention: 'kc-dot kc-dot-wait', error: 'kc-dot kc-dot-err' }[status] || 'kc-dot kc-dot-done';
  };

  KC.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  };

  /* Petit stockage local tolérant (préférences par appareil). */
  KC.local = {
    get: function (k, d) { try { var v = localStorage.getItem('kc:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('kc:' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  KC.bridge = global.klai || null;
  KC.hasBridge = !!global.klai;
})(window);
