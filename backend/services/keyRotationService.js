/**
 * services/keyRotationService.js — load-aware key selection for every feature chain.
 *
 * Built for many simultaneous users:
 *  • Least-loaded pick: each request gets the key with the fewest requests in the last
 *    60 s (ties → least recently used), so concurrent users spread across ALL keys
 *    instead of piling onto the next one in a round-robin.
 *  • Optional proactive throttle: KEY_RPM_GEMINI=10 (etc.) keeps a key from being picked
 *    once it hit N requests in the last minute — avoids most 429s before they happen.
 *  • Smart cooldowns: 429 → uses Retry-After / Gemini "retryDelay" when given, else
 *    KEY_COOLDOWN_MS; "per day" quota errors → KEY_DAILY_COOLDOWN_MS; 401/403 → 1 hour.
 *  • waitTimeMs(): how long until some key frees up — the fallback engine waits that
 *    long (bounded) instead of failing when every key is momentarily busy.
 */
const { providers, poolFor, chains, keyWarnings } = require('../config/apiKeys');

const COOLDOWN_MS = Number(process.env.KEY_COOLDOWN_MS || 30000);
const DAILY_COOLDOWN_MS = Number(process.env.KEY_DAILY_COOLDOWN_MS || 60 * 60 * 1000);
const WINDOW_MS = 60000;
const rpmCap = (name) => Number(process.env[`KEY_RPM_${name.toUpperCase()}`] || 0); // 0 = no cap

const state = {};
function s(name) {
  if (!state[name]) state[name] = { cooldownUntil: {}, recent: {}, lastUsed: {}, stats: { success: 0, failed: 0, rateLimited: 0 } };
  return state[name];
}

function recentCount(st, key, now) {
  const list = (st.recent[key] || []).filter((t) => now - t < WINDOW_MS);
  st.recent[key] = list;
  return list.length;
}

/** Picks the least-loaded usable key and records the use. Returns null if none is usable now. */
function nextKey(name, exclude = new Set()) {
  const pool = poolFor(name);
  if (!pool.length) return null;
  const st = s(name);
  const now = Date.now();
  const cap = rpmCap(name);

  let best = null;
  let bestScore = Infinity;
  for (const key of pool) {
    if (exclude.has(key) || (st.cooldownUntil[key] || 0) > now) continue;
    const used = recentCount(st, key, now);
    if (cap && used >= cap) continue;
    const score = used * 1e13 + (st.lastUsed[key] || 0); // fewest recent uses, then least recently used
    if (score < bestScore) { best = key; bestScore = score; }
  }
  if (best) {
    (st.recent[best] = st.recent[best] || []).push(now);
    st.lastUsed[best] = now;
  }
  return best;
}

/** true if at least one key could be used right now (doesn't record a use). */
function nextKeyAvailable(name) {
  const st = s(name);
  const now = Date.now();
  const cap = rpmCap(name);
  return poolFor(name).some((k) => (st.cooldownUntil[k] || 0) <= now && (!cap || recentCount(st, k, now) < cap));
}

/** ms until the soonest key of this provider becomes usable (0 = now, Infinity = no keys). */
function waitTimeMs(name) {
  const pool = poolFor(name);
  if (!pool.length) return Infinity;
  const st = s(name);
  const now = Date.now();
  const cap = rpmCap(name);
  let min = Infinity;
  for (const k of pool) {
    let free = Math.max(0, (st.cooldownUntil[k] || 0) - now);
    if (cap && recentCount(st, k, now) >= cap) free = Math.max(free, WINDOW_MS - (now - st.recent[k][0]));
    min = Math.min(min, free);
  }
  return min;
}

function markRateLimited(name, key, retryAfterSec, message = '') {
  const daily = /per[ _-]?day|daily|RequestsPerDay|quota.*day/i.test(message);
  let ms = retryAfterSec ? Math.min(retryAfterSec * 1000 + 500, 10 * 60 * 1000) : COOLDOWN_MS;
  if (daily) ms = Math.max(ms, DAILY_COOLDOWN_MS);
  s(name).cooldownUntil[key] = Date.now() + ms;
  s(name).stats.rateLimited += 1;
}
function markInvalid(name, key) {
  s(name).cooldownUntil[key] = Date.now() + 60 * 60 * 1000;
  s(name).stats.failed += 1;
}
const markFailed = (name) => { s(name).stats.failed += 1; };
const markSuccess = (name) => { s(name).stats.success += 1; };

/** For the admin dashboard — counts and stats, never the keys. */
function getPoolStatus() {
  const now = Date.now();
  return Object.values(providers)
    .filter((p) => p.name !== 'pollinations' || chains.image.some((e) => e.provider === 'pollinations'))
    .map((p) => {
      const st = s(p.name);
      return {
        provider: p.name,
        label: p.label,
        model: p.model,
        totalKeys: p.name === 'pollinations' ? p.apiKeys.length : p.keys.length,
        note: keyWarnings[p.name] || (p.name === 'pollinations' && !p.apiKeys.length ? 'Keyless mode — images may carry a logo' : undefined),
        coolingDown: p.keys.filter((k) => (st.cooldownUntil[k] || 0) > now).length,
        requestsLastMinute: p.keys.reduce((n, k) => n + recentCount(st, k, now), 0),
        stats: st.stats,
      };
    });
}

function getChains() {
  const view = (list) => list.map((e) => ({ provider: e.provider, model: e.model, hasKeys: providers[e.provider].keys.length > 0 }));
  return { text: view(chains.text), code: view(chains.code), vision: view(chains.vision), image: view(chains.image) };
}

module.exports = { nextKey, nextKeyAvailable, waitTimeMs, markRateLimited, markInvalid, markFailed, markSuccess, getPoolStatus, getChains };
