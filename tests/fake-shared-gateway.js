'use strict';
/* Faux gateway partagé d'Hermes (WebSocket `/api/ws`, protocole `hermes-gateway-v1`)
 * et faux exécutable `hermes gateway attach --json`, pour tester l'écriture dans les
 * sessions Desktop sans Hermes. Comportement calqué sur la doc « Programmatic
 * Integration » et les types de apps/shared (gateway-canonical.ts, gateway-contract). */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

function createFakeSharedGateway(opts) {
  opts = opts || {};
  const tick = opts.tick || 10;
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const tickets = new Set();
  const log = [];
  const sockets = new Set();
  let generation = 3;
  const pendingApproval = new Map();

  const wss = new WebSocketServer({
    server, path: '/api/ws',
    handleProtocols: (protocols) => {
      if (api.syncTickets) api.syncTickets();
      const list = Array.from(protocols);
      const t = list.find((p) => p.startsWith('hermes-gateway-ticket.'));
      if (!list.includes('hermes-gateway-v1') || !t || !tickets.has(t.slice('hermes-gateway-ticket.'.length))) return false;
      tickets.delete(t.slice('hermes-gateway-ticket.'.length)); // usage unique
      return 'hermes-gateway-v1';
    },
    verifyClient: (info) => !info.req.headers.origin // pas d'en-tête Origin
  });

  function event(ws, sid, type, payload) {
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid, payload, execution_generation: generation } }));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runTurn(ws, sid, text) {
    event(ws, sid, 'message.start', {});
    event(ws, sid, 'tool.start', { tool_id: 't1', name: 'read_file', preview: 'notes.md' });
    await wait(tick);
    event(ws, sid, 'tool.complete', { tool_id: 't1', name: 'read_file', duration_s: 0.3, summary: '12 lignes' });
    if (/approuve/i.test(text)) {
      event(ws, sid, 'approval.request', { prompt_id: 'pr-1', execution_generation: generation, kind: 'approval', command: 'git push', description: 'Pousser la branche' });
      const choice = await new Promise((r) => pendingApproval.set('pr-1', r));
      event(ws, sid, 'approval.settled', { prompt_id: 'pr-1', execution_generation: generation });
      event(ws, sid, 'tool.complete', { tool_id: 't2', name: 'terminal', duration_s: 1, summary: choice === 'deny' ? 'BLOCKED: refusé' : 'poussé' });
    }
    for (const w of ['Depuis', ' Desktop', ' :', ' ', 'c’est', ' fait.']) {
      if (ws.interrupted) { ws.interrupted = false; event(ws, sid, 'message.complete', { status: 'interrupted' }); return; }
      event(ws, sid, 'message.delta', { text: w });
      await wait(tick);
    }
    event(ws, sid, 'message.complete', { status: 'complete', text: 'Depuis Desktop : c’est fait.' });
  }

  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      log.push(msg.method || 'response');
      const reply = (result) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      const fail = (code, message) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }));
      const p = msg.params || {};
      switch (msg.method) {
        case 'runtime.describe': return reply({ capabilities: ['session-client-v1'], session_create: { sources: ['tui'], parameters: ['source', 'request_id', 'client'] } });
        case 'client.capabilities': return reply({ server_requests: ['approval', 'clarify'] });
        case 'session.resume':
          if (!p.session_id) return fail(-32602, 'session_id requis');
          return reply({ session_id: p.session_id, stored_session_id: p.session_id, messages: [], message_count: 0, running: false, execution_generation: generation, pending: [], prompts: [] });
        case 'prompt.submit':
          if (!p.input_id || typeof p.text !== 'string') return fail(4000, 'paramètres invalides');
          ws.lastSubmit = p;
          reply({ admission_id: 'adm-' + log.length, ref: { profile_id: 'default', session_id: p.session_id }, sequence: 1, status: 'started', outcome: null, authority_epoch: 1, execution_generation: generation });
          setTimeout(() => runTurn(ws, p.session_id, p.text), 5);
          return undefined;
        case 'approval.respond': {
          if (p.execution_generation !== generation) return fail(4090, 'génération périmée');
          const r = pendingApproval.get(p.prompt_id);
          if (!r) return reply({ status: 'already_resolved' });
          pendingApproval.delete(p.prompt_id);
          r(p.choice);
          return reply({ status: 'resolved', prompt_id: p.prompt_id });
        }
        case 'session.interrupt': ws.interrupted = true; return reply({ execution_state: 'idle', execution_generation: generation });
        default: return fail(-32601, 'méthode inconnue');
      }
    });
  });

  var api = {
    log, sockets,
    lastSubmit: () => Array.from(sockets).map((s) => s.lastSubmit).filter(Boolean).pop(),
    /* Un tour lancé depuis Hermes Desktop lui-même : le Cockpit le voit en spectateur. */
    externalTurn: (sid) => { for (const s of sockets) runTurn(s, sid, 'externe'); },
    async listen() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      api.port = server.address().port;
      return api.port;
    },
    /* Faux `hermes` : `gateway attach --json` imprime une autorisation avec un ticket neuf. */
    makeHermesBin(dir) {
      const ticketsFile = path.join(dir, 'tickets');
      fs.writeFileSync(ticketsFile, '');
      const bin = path.join(dir, 'hermes');
      fs.writeFileSync(bin, '#!/bin/sh\n' +
        'T=$(od -An -N8 -tx1 /dev/urandom | tr -d " \\n")\n' +
        'echo "$T" >> "' + ticketsFile + '"\n' +
        'echo "{\\"state\\":\\"ready\\",\\"url\\":\\"ws://127.0.0.1:' + api.port + '/api/ws\\",\\"protocol\\":\\"hermes-gateway-v1\\",\\"protocols\\":[\\"hermes-gateway-v1\\",\\"hermes-gateway-ticket.$T\\"],\\"ticket\\":\\"$T\\",\\"endpoint\\":{\\"profile_id\\":\\"default\\",\\"instance_id\\":\\"i1\\"}}"\n');
      fs.chmodSync(bin, 0o755);
      // les tickets émis par le faux binaire deviennent valides côté serveur
      const sync = () => { for (const t of fs.readFileSync(ticketsFile, 'utf-8').split('\n').filter(Boolean)) tickets.add(t); };
      fs.watchFile(ticketsFile, { interval: 50 }, sync);
      api.stopWatch = () => fs.unwatchFile(ticketsFile);
      api.syncTickets = sync;
      return bin;
    },
    close() {
      if (api.stopWatch) api.stopWatch();
      for (const s of sockets) s.terminate();
      return new Promise((r) => wss.close(() => server.close(r)));
    }
  };
  return api;
}

module.exports = { createFakeSharedGateway, tmpDir: () => fs.mkdtempSync(path.join(os.tmpdir(), 'klai-shared-')) };

if (require.main === module) {
  const gw = createFakeSharedGateway({ tick: 120 });
  gw.listen().then((port) => {
    const bin = gw.makeHermesBin(module.exports.tmpDir());
    console.log('Faux gateway partagé sur ws://127.0.0.1:' + port + '/api/ws ; commande hermes : ' + bin);
  });
}
