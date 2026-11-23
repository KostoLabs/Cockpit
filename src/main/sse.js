'use strict';
/* Parseur Server-Sent Events minimal et tolérant.
 * - lignes « : commentaire » (keepalive Hermes toutes les 10 s) ignorées ;
 * - « event: nom » + une ou plusieurs « data: … » ; un bloc se termine par une ligne vide ;
 * - CRLF accepté.
 * Chaque bloc complet est rendu sous la forme { event, data } (data = chaîne brute). */

function createSseParser(onMessage) {
  let buf = '';
  let event = '';
  let data = [];

  function flush() {
    if (data.length) onMessage({ event: event || 'message', data: data.join('\n') });
    event = '';
    data = [];
  }

  function line(raw) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (l === '') { flush(); return; }
    if (l.startsWith(':')) return;
    const i = l.indexOf(':');
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }

  return {
    push(chunk) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) line(l);
    },
    end() {
      if (buf) { line(buf); buf = ''; }
      flush();
    }
  };
}

/* Lit un Response fetch en SSE ; résout quand le flux se termine. */
async function readSse(res, onMessage, signal) {
  const parser = createSseParser(onMessage);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      if (signal && signal.aborted) break;
      const step = await reader.read();
      if (step.done) break;
      parser.push(decoder.decode(step.value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    try { reader.releaseLock(); } catch { /* déjà libéré */ }
  }
}

module.exports = { createSseParser, readSse };
