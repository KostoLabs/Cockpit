/* Test final : serveur SSE connu-fonctionnel (pattern variant.js) + client qui
 * réplique EXACTEMENT le pilote Hermes du cockpit (headers, signal, parser). */
const http = require('http');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer test-key') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': keepalive\n\n');
      res.write('event: hermes.tool.progress\ndata: {"tool":"terminal","preview":"ls -la"}\n\n');
      const words = ['Bonjour', ' depuis', ' Hermes', '.', ' Tout', ' fonctionne', '.'];
      let i = 0;
      const tick = setInterval(() => {
        if (i < words.length) {
          res.write('data: ' + JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: words[i] }, finish_reason: null }] }) + '\n\n');
          i++;
        } else {
          clearInterval(tick);
          res.end('data: ' + JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
        }
      }, 20);
    });
    return;
  }
  res.writeHead(404); res.end('{}');
});

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const SETTINGS = { hermesBaseUrl: base, hermesApiKey: 'test-key', model: 'hermes-agent' };
  const events = [];

  function hermesFetch(pathname, init) {
    const s = SETTINGS;
    const url = s.hermesBaseUrl.replace(/\/+$/, '') + pathname;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    if (s.hermesApiKey) headers.Authorization = 'Bearer ' + s.hermesApiKey;
    return fetch(url, Object.assign({}, init, { headers }));
  }

  async function hermesSend(sessionId, content) {
    const s = SETTINGS;
    const key = crypto.randomUUID();
    const ctrl = new AbortController();
    events.push({ type: 'start' });
    const res = await hermesFetch('/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'X-Hermes-Session-Id': sessionId, 'Idempotency-Key': key },
      body: JSON.stringify({ model: s.model || 'hermes-agent', messages: [{ role: 'user', content }], stream: true })
    });
    if (!res.ok) { const b = await res.text(); throw new Error('HTTP ' + res.status + ' ' + b.slice(0, 200)); }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.slice(5).trim();
        if (payloadStr === '[DONE]') { events.push({ type: 'done' }); return; }
        try {
          const chunk = JSON.parse(payloadStr);
          const choice = chunk.choices && chunk.choices[0];
          const delta = choice && choice.delta && choice.delta.content;
          if (delta) events.push({ type: 'delta', text: delta });
          const finish = choice && choice.finish_reason;
          if (finish && finish !== 'stop') events.push({ type: 'notice', text: 'finish_reason : ' + finish });
        } catch { /* commentaire SSE, keepalive */ }
      }
    }
    events.push({ type: 'done' });
  }

  console.log('envoi…');
  await hermesSend('cockpit-test', 'Bonjour');
  const texte = events.filter(e => e.type === 'delta').map(e => e.text).join('');
  const types = events.map(e => e.type).join(',');
  console.log('texte =', JSON.stringify(texte));
  console.log('types =', types);
  const ok = texte === 'Bonjour depuis Hermes. Tout fonctionne.'
    && types === 'start,delta,delta,delta,delta,delta,delta,delta,done'
    && !events.some(e => e.type === 'notice' || e.type === 'error');
  console.log(ok ? '=== PILOTE OK ===' : '=== PILOTE ÉCHOUÉ ===');
  server.close();
  process.exit(ok ? 0 : 1);
});
setTimeout(() => { console.log('TIMEOUT — le pilote HANG'); process.exit(2); }, 15000);
