/**
 * config/apiKeys.js — AI provider registry (keys + models)
 * ─────────────────────────────────────────────────────────
 * Drop-in replacement. fallbackService.js and keyRotationService.js use it unchanged.
 *
 * KEYS — any of these formats work (free and paid keys mix freely in one pool):
 *   GEMINI_API_KEYS=key1,key2,key3        ← recommended (comma or new-line separated)
 *   GEMINI_API_KEY=key1                   ← single key
 *   GEMINI_API_KEY_1=key1  GEMINI_API_KEY_2=key2 ...   ← numbered
 *   Duplicates are removed automatically.
 *
 * MODELS — every model is an env variable, so you never edit code when a provider
 * retires one:
 *   GEMINI_MODEL, GEMINI_VISION_MODEL, GROQ_MODEL, DEEPSEEK_MODEL,
 *   OPENROUTER_MODEL, MISTRAL_MODEL
 *
 * RETIRED-MODEL GUARD — if an env variable still names a model the provider has shut
 * down (e.g. gemini-1.5-flash, llama-3.3-70b-versatile), it is replaced with the
 * current default at startup and a warning is logged. This is what stops the
 * "404 NOT_FOUND models/gemini-1.5-flash" error.
 * Set ALLOW_LEGACY_MODELS=true to turn the guard off (e.g. an old paid account that
 * still has access to Gemini 2.5).
 */

/* ───────────────────────── Current defaults (Oct 2026) ───────────────────────── */
const DEFAULTS = {
  gemini: 'gemini-3.8-flash',       // GA, multimodal (text + images + PDF)
  geminiVision: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',      // Groq's recommended Llama-3.3-70B replacement
  deepseek: 'deepseek-flash',
  openrouter: 'openrouter/free',    // OpenRouter auto-picks an available free model
  mistral: 'mistral-small-latest',  // "-latest" alias never goes stale
};

/* Models that are shut down or unavailable to new API keys.
   Matching values are swapped for DEFAULTS at startup. */
const RETIRED = {
  gemini: [
    /^gemini-1\./,              // all 1.0 / 1.5 — shut down
    /^gemini-2\.0/,             // 2.0 Flash / Flash-Lite — shut down
    /^gemini-2\.5/,             // still served, but only to accounts that used it before
    /^gemini-pro(-vision)?$/,   // original names
    /^gemini-3-pro-preview$/,
    /^gemini-3\.1-flash-lite-preview$/,
    /^gemini-exp/,
  ],
  groq: [
    /^llama-3\.3-70b-versatile$/,
    /^llama-3\.1-8b-instant$/,
    /^llama3-/,
    /^mixtral-8x7b/,
    /^gemma2?-/,
    /^deepseek-r1-distill/,
    /^qwen\/qwen3-32b$/,
    /^meta-llama\/llama-4-(scout|maverick)/,
    /^meta-llama\/llama-guard/,
    /^moonshotai\/kimi-k2-instruct-0905$/,
  ],
  deepseek: [/^deepseek-chat$/, /^deepseek-reasoner$/, /^deepseek-coder/, /^deepseek-v3/],
  openrouter: [],
  mistral: [/^open-mistral-7b$/, /^open-mixtral-/, /^mistral-tiny$/],
};

const allowLegacy = String(process.env.ALLOW_LEGACY_MODELS || '').toLowerCase() === 'true';

/* ───────────────────────── Helpers ───────────────────────── */

/** Collects keys from NAME_API_KEYS, NAME_API_KEY and NAME_API_KEY_1..N */
function collectKeys(prefix) {
  const raw = [process.env[`${prefix}_API_KEYS`], process.env[`${prefix}_API_KEY`]];
  for (const [name, value] of Object.entries(process.env)) {
    if (new RegExp(`^${prefix}_API_KEY_\\d+$`).test(name)) raw.push(value);
  }
  const keys = raw
    .filter(Boolean)
    .flatMap((v) => v.split(/[,\n\r]+/))
    .map((k) => k.trim().replace(/^["']|["']$/g, '')) // tolerate quotes pasted into panels
    .filter((k) => k && !/^(your|key|xxx|change_me)/i.test(k)); // skip placeholders
  return [...new Set(keys)];
}

/** Picks the model from env, cleans it, and swaps retired names for the default. */
function resolveModel(provider, envName, fallback) {
  let model = (process.env[envName] || '').trim().replace(/^["']|["']$/g, '');
  if (provider === 'gemini') model = model.replace(/^models\//, ''); // "models/x" → "x"
  if (!model) return fallback;

  if (!allowLegacy && (RETIRED[provider] || []).some((rx) => rx.test(model))) {
    console.warn(
      `[apiKeys] ${envName}="${model}" is retired or unavailable to new keys → using "${fallback}". ` +
        `Update or delete ${envName} in your hosting environment variables.`
    );
    return fallback;
  }
  return model;
}

/* ───────────────────────── Provider registry ─────────────────────────
   type "openai" = OpenAI-compatible /chat/completions (handled by fallbackService)
   type "gemini" = Google generateContent API (supports images + PDF)              */
const providers = {
  groq: {
    name: 'groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: resolveModel('groq', 'GROQ_MODEL', DEFAULTS.groq),
    keys: collectKeys('GROQ'),
  },
  gemini: {
    name: 'gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: resolveModel('gemini', 'GEMINI_MODEL', DEFAULTS.gemini),
    visionModel: resolveModel('gemini', 'GEMINI_VISION_MODEL', DEFAULTS.geminiVision),
    keys: collectKeys('GEMINI'),
  },
  deepseek: {
    name: 'deepseek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: resolveModel('deepseek', 'DEEPSEEK_MODEL', DEFAULTS.deepseek),
    keys: collectKeys('DEEPSEEK'),
  },
  openrouter: {
    name: 'openrouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: resolveModel('openrouter', 'OPENROUTER_MODEL', DEFAULTS.openrouter),
    keys: collectKeys('OPENROUTER'),
    extraHeaders: {
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost',
      'X-Title': 'Custom AI Suite',
    },
  },
  mistral: {
    name: 'mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    model: resolveModel('mistral', 'MISTRAL_MODEL', DEFAULTS.mistral),
    keys: collectKeys('MISTRAL'),
  },
};

/* Fallback order. Unknown names are ignored; providers with no keys are skipped by
   fallbackService, so listing a provider you have no key for is harmless. */
const providerOrder = (process.env.PROVIDER_ORDER || 'groq,gemini,deepseek,openrouter,mistral')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p, i, arr) => providers[p] && arr.indexOf(p) === i);

/* Startup summary — shows key counts and models, never the keys themselves */
console.log(
  '[apiKeys] ' +
    providerOrder
      .map((p) => `${p}: ${providers[p].keys.length} key(s), ${providers[p].model}`)
      .join(' | ')
);
if (!providers.gemini.keys.length) {
  console.warn('[apiKeys] No GEMINI keys — image/PDF analysis (vision) will not work.');
}

module.exports = { providers, providerOrder, DEFAULTS };
