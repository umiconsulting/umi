#!/usr/bin/env node
// Fixed-response DeepSeek stub for the gate-3 narrative capture.
//
//   LLM_PROVIDER=deepseek
//   DEEPSEEK_BASE_URL=http://127.0.0.1:4319
//   DEEPSEEK_API_KEY=local-gate3
//   DEEPSEEK_MODEL=gate3-stub
//
// The stub answers POST /chat/completions with one grounded sentence built from
// the user message. It records every user message to GATE3_STUB_LOG.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.GATE3_STUB_PORT ?? 4319);
const LOG = process.env.GATE3_STUB_LOG ?? '/tmp/gate3-narrative-stub.jsonl';
const FALLBACK = 'Vendiste $285.00 en 2 órdenes; el ticket promedio fue $142.50.';

function money(value) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function sentence(input) {
  if (!input || typeof input !== 'object') return FALLBACK;
  const orders = Number(input.ordenes ?? 0);
  if (!Number.isFinite(orders) || orders <= 0) return FALLBACK;
  return `Vendiste ${money(input.ventasNetas)} en ${orders} órdenes; el ticket promedio fue ${money(input.ticketPromedio)}.`;
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    const userMessage = body?.messages?.find((m) => m.role === 'user')?.content ?? '';
    let input = null;
    try {
      input = JSON.parse(userMessage);
    } catch {
      input = null;
    }
    const text = sentence(input);
    appendFileSync(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), model: body.model ?? null, userMessage, narrative: text })}\n`,
    );
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'gate3-stub',
        object: 'chat.completion',
        model: body.model ?? 'gate3-stub',
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: userMessage.length, completion_tokens: text.length },
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`gate3 narrative stub on http://127.0.0.1:${PORT} log=${LOG}`);
});
