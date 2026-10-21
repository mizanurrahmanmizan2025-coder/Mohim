/**
 * services/providerHealth.js — live provider health for fast-path routing.
 *
 *  • Latency: exponential moving average of time-to-first-token per provider.
 *  • Circuit breaker: CIRCUIT_FAILS network failures/timeouts within 60 s (or a failed
 *    warm-up ping) → provider is "down" for CIRCUIT_OPEN_MS. Down providers are moved
 *    to the END of every chain, so requests never wait on a dead socket first; they stay
 *    available as a last resort.
 *  • ROUTE_BY_LATENCY=true → among healthy providers, the fastest goes first
 *    (default false = keep your chain priority, only skip unhealthy ones).
 * Rate limits (429) are NOT health problems — keyRotationService handles those per key.
 */
const OPEN_MS = Number(process.env.CIRCUIT_OPEN_MS || 30000);
const FAILS = Number(process.env.CIRCUIT_FAILS || 2);
const WINDOW_MS = 60000;
const BY_LATENCY = String(process.env.ROUTE_BY_LATENCY || '').toLowerCase() === 'true';

const state = {};
const s = (name) => (state[name] ||= { ttfb: null, samples: 0, fails: [], downUntil: 0, reason: '', ping: null });

function recordSuccess(name, ttfbMs) {
  const st = s(name);
  if (Number.isFinite(ttfbMs)) {
    st.ttfb = st.ttfb == null ? ttfbMs : Math.round(st.ttfb * 0.7 + ttfbMs * 0.3);
    st.samples += 1;
  }
  st.fails = [];
  st.downUntil = 0;
  st.reason = '';
}

function recordFailure(name, reason = 'network error') {
  const st = s(name);
  const now = Date.now();
  st.fails = st.fails.filter((t) => now - t < WINDOW_MS);
  st.fails.push(now);
  if (st.fails.length >= FAILS) {
    st.downUntil = now + OPEN_MS;
    st.reason = reason;
    console.warn(`[health] ${name} marked DOWN for ${OPEN_MS / 1000}s (${reason})`);
  }
}

function recordPing(name, ms, ok, reason) {
  const st = s(name);
  if (ok) {
    st.ping = ms;
    if (st.downUntil && st.reason.startsWith('ping')) { st.downUntil = 0; st.reason = ''; }
  } else {
    st.ping = null;
    st.downUntil = Date.now() + OPEN_MS;
    st.reason = `ping failed: ${reason}`;
  }
}

const isDown = (name) => s(name).downUntil > Date.now();

/** Reorders a chain: healthy entries first (priority or latency order), down ones last. */
function order(chain) {
  const up = chain.filter((e) => !isDown(e.provider));
  const down = chain.filter((e) => isDown(e.provider));
  if (BY_LATENCY) {
    const idx = new Map(chain.map((e, i) => [e, i]));
    up.sort((a, b) => {
      const la = s(a.provider).ttfb;
      const lb = s(b.provider).ttfb;
      if (la == null || lb == null) return idx.get(a) - idx.get(b);
      return la - lb;
    });
  }
  return [...up, ...down];
}

function snapshot() {
  const now = Date.now();
  return Object.fromEntries(Object.entries(state).map(([name, st]) => [name, {
    status: st.downUntil > now ? 'down' : 'up',
    avgFirstTokenMs: st.ttfb,
    pingMs: st.ping,
    reason: st.downUntil > now ? st.reason : undefined,
  }]));
}

module.exports = { recordSuccess, recordFailure, recordPing, isDown, order, snapshot };
