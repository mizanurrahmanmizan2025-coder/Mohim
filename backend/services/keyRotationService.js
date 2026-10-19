/**
 * Round-robin API key rotation with per-key cooldown.
 *
 * - Every request takes the next key in the pool (shared across all users).
 * - A key that returns 429 / 401 is "cooled down" and skipped until the
 *   cooldown expires, so traffic spreads over the healthy keys.
 */
const { providers } = require('../config/apiKeys');

const COOLDOWN_MS = Number(process.env.KEY_COOLDOWN_MS || 60000);

// state[provider] = { index, cooldownUntil: { key: timestamp }, stats: {...} }
const state = {};
for (const name of Object.keys(providers)) {
  state[name] = { index: 0, cooldownUntil: {}, stats: { success: 0, failed: 0, rateLimited: 0 } };
}

/** Returns the next usable key for a provider, or null if all are cooling down. */
function nextKey(providerName, exclude = new Set()) {
  const pool = providers[providerName]?.keys || [];
  const s = state[providerName];
  if (!pool.length) return null;

  const now = Date.now();
  for (let i = 0; i < pool.length; i += 1) {
    const idx = (s.index + i) % pool.length;
    const key = pool[idx];
    if (exclude.has(key)) continue;
    if ((s.cooldownUntil[key] || 0) > now) continue;
    s.index = (idx + 1) % pool.length; // advance pointer for the next caller
    return key;
  }
  return null;
}

function markRateLimited(providerName, key, retryAfterSec) {
  const s = state[providerName];
  const ms = retryAfterSec ? Math.min(retryAfterSec * 1000, 10 * 60 * 1000) : COOLDOWN_MS;
  s.cooldownUntil[key] = Date.now() + ms;
  s.stats.rateLimited += 1;
}

function markInvalid(providerName, key) {
  // Bad / revoked key: park it for an hour
  state[providerName].cooldownUntil[key] = Date.now() + 60 * 60 * 1000;
  state[providerName].stats.failed += 1;
}

function markFailed(providerName) {
  state[providerName].stats.failed += 1;
}

function markSuccess(providerName) {
  state[providerName].stats.success += 1;
}

/** Summary for the admin dashboard (never exposes full keys). */
function getPoolStatus() {
  const now = Date.now();
  return Object.values(providers).map((p) => ({
    provider: p.name,
    model: p.model,
    totalKeys: p.keys.length,
    coolingDown: p.keys.filter((k) => (state[p.name].cooldownUntil[k] || 0) > now).length,
    stats: state[p.name].stats,
  }));
}

module.exports = { nextKey, markRateLimited, markInvalid, markFailed, markSuccess, getPoolStatus };
