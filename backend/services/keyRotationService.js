/**
 * Round-robin key rotation with per-key cooldown, shared by every feature chain.
 * - Each request takes the next key of that provider's pool (across all users).
 * - 429 → key sits out for KEY_COOLDOWN_MS (or the provider's Retry-After).
 * - 401/403 → key parked for an hour (invalid / revoked / no access).
 */
const { providers, poolFor, chains, keyWarnings } = require('../config/apiKeys');

const COOLDOWN_MS = Number(process.env.KEY_COOLDOWN_MS || 60000);
const state = {};

function s(name) {
  if (!state[name]) state[name] = { index: 0, cooldownUntil: {}, stats: { success: 0, failed: 0, rateLimited: 0 } };
  return state[name];
}

function nextKey(name, exclude = new Set()) {
  const pool = poolFor(name);
  if (!pool.length) return null;
  const st = s(name);
  const now = Date.now();
  for (let i = 0; i < pool.length; i += 1) {
    const idx = (st.index + i) % pool.length;
    const key = pool[idx];
    if (exclude.has(key) || (st.cooldownUntil[key] || 0) > now) continue;
    st.index = (idx + 1) % pool.length;
    return key;
  }
  return null;
}

/** true if the provider has at least one key that isn't cooling down (doesn't advance rotation) */
function nextKeyAvailable(name) {
  const now = Date.now();
  return poolFor(name).some((k) => (s(name).cooldownUntil[k] || 0) <= now);
}

function markRateLimited(name, key, retryAfterSec) {
  const ms = retryAfterSec ? Math.min(retryAfterSec * 1000, 10 * 60 * 1000) : COOLDOWN_MS;
  s(name).cooldownUntil[key] = Date.now() + ms;
  s(name).stats.rateLimited += 1;
}
function markInvalid(name, key) {
  s(name).cooldownUntil[key] = Date.now() + 60 * 60 * 1000;
  s(name).stats.failed += 1;
}
const markFailed = (name) => { s(name).stats.failed += 1; };
const markSuccess = (name) => { s(name).stats.success += 1; };

/** For the admin dashboard — key counts and stats, never the keys. */
function getPoolStatus() {
  const now = Date.now();
  return Object.values(providers)
    .filter((p) => p.name !== 'pollinations' || chains.image.some((e) => e.provider === 'pollinations'))
    .map((p) => ({
      provider: p.name,
      label: p.label,
      model: p.model,
      totalKeys: p.name === 'pollinations' ? p.apiKeys.length : p.keys.length,
      note: keyWarnings[p.name] || (p.name === 'pollinations' && !p.apiKeys.length ? 'Keyless mode — images may carry a logo' : undefined),
      coolingDown: p.keys.filter((k) => (s(p.name).cooldownUntil[k] || 0) > now).length,
      stats: s(p.name).stats,
    }));
}

function getChains() {
  const view = (list) => list.map((e) => ({ provider: e.provider, model: e.model, hasKeys: providers[e.provider].keys.length > 0 }));
  return { text: view(chains.text), code: view(chains.code), vision: view(chains.vision), image: view(chains.image) };
}

module.exports = { nextKey, nextKeyAvailable, markRateLimited, markInvalid, markFailed, markSuccess, getPoolStatus, getChains };
