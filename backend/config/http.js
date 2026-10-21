/**
 * config/http.js — fast outbound networking for every AI provider call.
 * Load this FIRST in server.js (before any module that calls fetch).
 *
 *  • Keep-alive connection pool (undici Agent): sockets to Gemini/Groq/… stay open for
 *    60 s idle (Node's default is only 4 s), so most requests skip DNS + TCP + TLS.
 *  • Strict connect timeout (CONNECT_TIMEOUT_MS, default 4 s): an unreachable endpoint
 *    fails fast and the fallback engine moves on immediately.
 *  • DNS cache (5 min) so lookups don't add latency to every new socket.
 *  • Warm-up pings: every WARM_INTERVAL_MS (45 s) a tiny HEAD request to each provider
 *    that has keys keeps a connection hot and feeds providerHealth (unreachable → skipped).
 *
 * Every existing fetch() call in the app automatically uses this pool.
 * If the `undici` package is missing, the app still runs on Node's default fetch.
 */
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 4000);
const WARM_INTERVAL_MS = Number(process.env.WARM_INTERVAL_MS || 45000);

let undici = null;
try {
  undici = require('undici');
} catch {
  console.warn('[http] "undici" not installed — using default fetch (run npm install in backend/ for keep-alive pooling).');
}

let agent = null;
if (undici) {
  const { Agent, fetch: undiciFetch, setGlobalDispatcher, interceptors } = undici;
  const base = new Agent({
    connect: { timeout: CONNECT_TIMEOUT_MS, keepAlive: true, keepAliveInitialDelay: 10000 },
    keepAliveTimeout: 60000, // keep idle sockets 60 s (default 4 s)
    keepAliveMaxTimeout: 10 * 60000,
    connections: Number(process.env.HTTP_MAX_SOCKETS_PER_HOST || 128), // concurrent users per provider
    pipelining: 1,
    headersTimeout: 120000, // safety nets only — real phase timeouts live in fallbackService
    bodyTimeout: 120000,
  });
  agent = typeof base.compose === 'function' && interceptors?.dns
    ? base.compose(interceptors.dns({ maxTTL: 5 * 60000 }))
    : base;
  setGlobalDispatcher(agent);
  // route the global fetch through the pooled agent (same API, so no other code changes)
  globalThis.fetch = (input, init = {}) => undiciFetch(input, { dispatcher: agent, ...init });
  console.log(`[http] keep-alive pool on · connect timeout ${CONNECT_TIMEOUT_MS} ms · DNS cache ${interceptors?.dns ? 'on' : 'off'}`);
}

/** Turns low-level network failures into a short, readable reason. */
function describeNetworkError(err) {
  const code = err?.cause?.code || err?.code || '';
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'connect timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection reset';
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return 'timed out';
  return code ? `network error (${code})` : err?.message || 'network error';
}

/* ───────────────────────── warm-up / reachability ───────────────────────── */
const ORIGINS = {
  gemini: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai',
  mistral: 'https://api.mistral.ai',
  cloudflare: 'https://api.cloudflare.com',
  huggingface: 'https://router.huggingface.co',
};

async function warmOnce(names, health) {
  await Promise.allSettled(names.map(async (name) => {
    const origin = ORIGINS[name];
    if (!origin) return;
    const t0 = Date.now();
    try {
      const res = await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS + 2000) });
      res.body?.cancel?.().catch?.(() => {});
      health?.recordPing(name, Date.now() - t0, true); // any HTTP status = reachable
    } catch (err) {
      health?.recordPing(name, null, false, describeNetworkError(err));
    }
  }));
}

/** Starts periodic warm-up pings for providers that have keys. */
function startWarmup(names, health) {
  if (!names.length || WARM_INTERVAL_MS <= 0) return;
  warmOnce(names, health);
  const t = setInterval(() => warmOnce(names, health), WARM_INTERVAL_MS);
  t.unref();
}

module.exports = { agent, describeNetworkError, startWarmup, CONNECT_TIMEOUT_MS, pooled: Boolean(agent) };
