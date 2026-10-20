/**
 * config/apiKeys.js — providers, key pools and FEATURE-SPECIFIC FALLBACK CHAINS
 * ─────────────────────────────────────────────────────────────────────────────
 * KEYS — any format works (free and paid keys can be mixed in one pool):
 *   GEMINI_API_KEYS=k1,k2,k3     GEMINI_API_KEY=k1     GEMINI_API_KEY_1=k1, GEMINI_API_KEY_2=k2 …
 *   Same pattern for GROQ, DEEPSEEK, OPENROUTER, MISTRAL, HUGGINGFACE (or HF), CLOUDFLARE.
 *   Cloudflare keys: "ACCOUNT_ID:API_TOKEN" pairs, or plain tokens + CLOUDFLARE_ACCOUNT_ID.
 *
 * CHAINS — one per feature, tried left → right. Entry = "provider" or "provider:model".
 *   CHAIN_TEXT   general chat, writing, web-search answers, router, prompt enhancement
 *   CHAIN_CODE   Code Expert (strongest coding models first)
 *   CHAIN_VISION images / scanned PDFs (Gemini only can read them)
 *   CHAIN_IMAGE  image generation
 * Example: CHAIN_CODE=deepseek:deepseek-v4-pro,gemini:gemini-3.8-flash,groq
 * A provider without keys is skipped automatically.
 *
 * Retired model names (gemini-1.5-*, llama-3.3-70b-versatile …) are replaced with
 * current defaults at startup. ALLOW_LEGACY_MODELS=true disables that guard.
 */

/* ───────────────────────── Defaults (Oct 2026) ───────────────────────── */
const DEFAULT_MODELS = {
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  deepseek: 'deepseek-flash',
  openrouter: 'openrouter/free',
  mistral: 'mistral-small-latest',
};

const DEFAULT_CHAINS = {
  text: 'gemini,groq,deepseek,openrouter,mistral',
  code: [
    'deepseek:deepseek-v4-pro',
    'gemini:gemini-3.8-flash',
    'groq:openai/gpt-oss-120b',
    'groq:qwen/qwen3.6-27b',
    'openrouter:qwen/qwen3-coder:free',
    'mistral:codestral-latest',
    'openrouter:openrouter/free',
  ].join(','),
  vision: 'gemini:gemini-3.8-flash,gemini:gemini-3.6-flash',
  image: [
    'gemini:gemini-3.1-flash-image',          // Nano Banana 2 — up to 4K
    'gemini:gemini-3.1-flash-lite-image',     // Nano Banana 2 Lite — 1K, cheaper/faster
    'cloudflare:@cf/black-forest-labs/flux-1-schnell',
    'huggingface:black-forest-labs/FLUX.1-schnell',
    'pollinations:flux',                      // keyless last resort
  ].join(','),
};

const RETIRED = {
  gemini: [/^gemini-1\./, /^gemini-2\.0/, /^gemini-2\.5/, /^gemini-pro(-vision)?$/, /^gemini-3-pro-preview$/, /^gemini-3\.1-flash-lite-preview$/, /^gemini-exp/, /^imagen-/],
  groq: [/^llama-3\.3-70b-versatile$/, /^llama-3\.1-8b-instant$/, /^llama3-/, /^mixtral-8x7b/, /^gemma2?-/, /^deepseek-r1-distill/, /^qwen\/qwen3-32b$/, /^meta-llama\/llama-4-(scout|maverick)/, /^meta-llama\/llama-guard/, /^moonshotai\/kimi-k2-instruct-0905$/],
  deepseek: [/^deepseek-chat$/, /^deepseek-reasoner$/, /^deepseek-coder/, /^deepseek-v3/],
  openrouter: [],
  mistral: [/^open-mistral-7b$/, /^open-mixtral-/, /^mistral-tiny$/],
};
const REPLACEMENT = { ...DEFAULT_MODELS, deepseekCode: 'deepseek-v4-pro' };

const allowLegacy = String(process.env.ALLOW_LEGACY_MODELS || '').toLowerCase() === 'true';
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');

/* ───────────────────────── Keys ───────────────────────── */
function collectKeys(...prefixes) {
  const raw = [];
  for (const prefix of prefixes) {
    raw.push(process.env[`${prefix}_API_KEYS`], process.env[`${prefix}_API_KEY`], process.env[`${prefix}_API_TOKENS`], process.env[`${prefix}_API_TOKEN`]);
    for (const [name, value] of Object.entries(process.env)) {
      if (new RegExp(`^${prefix}_API_(KEY|TOKEN)_\\d+$`).test(name)) raw.push(value);
    }
  }
  const keys = raw
    .filter(Boolean)
    .flatMap((v) => v.split(/[,\n\r]+/))
    .map(clean)
    .filter((k) => k && !/^(your|key|xxx|change_me|sk_\.\.\.)/i.test(k));
  return [...new Set(keys)];
}

function cloudflareKeys() {
  const defaultAccount = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
  return collectKeys('CLOUDFLARE')
    .map((k) => (k.includes(':') ? k : defaultAccount ? `${defaultAccount}:${k}` : null))
    .filter(Boolean);
}

/* ───────────────────────── Model guard ───────────────────────── */
function guardModel(provider, model, label) {
  let m = clean(model);
  if (provider === 'gemini') m = m.replace(/^models\//, '');
  if (!m) return null;
  if (!allowLegacy && (RETIRED[provider] || []).some((rx) => rx.test(m))) {
    const fallback = provider === 'deepseek' && /coder/.test(m) ? REPLACEMENT.deepseekCode : DEFAULT_MODELS[provider];
    console.warn(`[apiKeys] ${label}: "${m}" is retired/unavailable → using "${fallback}"`);
    return fallback;
  }
  return m;
}

/* ───────────────────────── Providers ─────────────────────────
   type "openai" = OpenAI-compatible chat (streaming supported)
   type "gemini" = Google generateContent (text, vision, image)
   type "image"  = image-only providers                                   */
const providers = {
  gemini: {
    name: 'gemini',
    label: 'Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: guardModel('gemini', process.env.GEMINI_MODEL, 'GEMINI_MODEL') || DEFAULT_MODELS.gemini,
    keys: collectKeys('GEMINI', 'GOOGLE'),
  },
  groq: {
    name: 'groq',
    label: 'Groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: guardModel('groq', process.env.GROQ_MODEL, 'GROQ_MODEL') || DEFAULT_MODELS.groq,
    keys: collectKeys('GROQ'),
  },
  deepseek: {
    name: 'deepseek',
    label: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: guardModel('deepseek', process.env.DEEPSEEK_MODEL, 'DEEPSEEK_MODEL') || DEFAULT_MODELS.deepseek,
    keys: collectKeys('DEEPSEEK'),
  },
  openrouter: {
    name: 'openrouter',
    label: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: guardModel('openrouter', process.env.OPENROUTER_MODEL, 'OPENROUTER_MODEL') || DEFAULT_MODELS.openrouter,
    keys: collectKeys('OPENROUTER'),
    extraHeaders: { 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost', 'X-Title': 'Custom AI Suite' },
  },
  mistral: {
    name: 'mistral',
    label: 'Mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    model: guardModel('mistral', process.env.MISTRAL_MODEL, 'MISTRAL_MODEL') || DEFAULT_MODELS.mistral,
    keys: collectKeys('MISTRAL'),
  },
  cloudflare: {
    name: 'cloudflare',
    label: 'Cloudflare FLUX',
    type: 'image',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts',
    model: '@cf/black-forest-labs/flux-1-schnell',
    keys: cloudflareKeys(),
  },
  huggingface: {
    name: 'huggingface',
    label: 'Hugging Face',
    type: 'image',
    baseUrl: 'https://router.huggingface.co/hf-inference/models',
    model: 'black-forest-labs/FLUX.1-schnell',
    keys: collectKeys('HUGGINGFACE', 'HF'),
  },
  pollinations: {
    name: 'pollinations',
    label: 'Pollinations',
    type: 'image',
    model: process.env.POLLINATIONS_MODEL || 'flux',
    keys: ['keyless'], // always available; the optional POLLINATIONS_API_KEY is used by pollinationsService
  },
};

const PROVIDER_LABEL = Object.fromEntries(Object.values(providers).map((p) => [p.name, p.label]));

const IMAGE_MODEL_LABEL = {
  'gemini-nano-banana-2.1': 'Nano Banana 2.1',
  'gemini-3.1-flash-image': 'Nano Banana 2',
  'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
  'gemini-3-pro-image': 'Nano Banana Pro',
  'gemini-2.5-flash-image': 'Nano Banana',
};
/** Human label for a chain entry, e.g. "Nano Banana 2" or "Cloudflare FLUX". */
const labelOf = (provider, model) => IMAGE_MODEL_LABEL[model] || PROVIDER_LABEL[provider] || provider;

/* ───────────────────────── Chains ───────────────────────── */
function parseChain(feature, spec) {
  const entries = [];
  for (const raw of String(spec || '').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const i = item.indexOf(':');
    const provider = (i === -1 ? item : item.slice(0, i)).trim().toLowerCase();
    const p = providers[provider];
    if (!p) {
      console.warn(`[apiKeys] CHAIN_${feature.toUpperCase()}: unknown provider "${provider}" ignored`);
      continue;
    }
    const isImage = feature === 'image';
    if (isImage && p.type === 'openai') continue; // text-only providers can't draw
    if (!isImage && p.type === 'image') continue;

    let model = i === -1 ? '' : item.slice(i + 1).trim();
    if (!isImage && p.type !== 'image') model = guardModel(provider, model, `CHAIN_${feature.toUpperCase()}`) || p.model;
    if (isImage && !model) model = provider === 'gemini' ? 'gemini-3.1-flash-image' : p.model;
    if (!entries.some((e) => e.provider === provider && e.model === model)) entries.push({ provider, model });
  }
  return entries;
}

if (process.env.PROVIDER_ORDER && !process.env.CHAIN_TEXT) {
  console.warn('[apiKeys] PROVIDER_ORDER is no longer used — set CHAIN_TEXT instead (default: Gemini first). You can delete PROVIDER_ORDER.');
}
const chains = {
  text: parseChain('text', process.env.CHAIN_TEXT || DEFAULT_CHAINS.text),
  code: parseChain('code', process.env.CHAIN_CODE || DEFAULT_CHAINS.code),
  vision: parseChain('vision', process.env.CHAIN_VISION || DEFAULT_CHAINS.vision).filter((e) => e.provider === 'gemini'),
  image: parseChain('image', process.env.CHAIN_IMAGE || DEFAULT_CHAINS.image),
};
if (!chains.vision.length) chains.vision = [{ provider: 'gemini', model: providers.gemini.model }];

/** Which chain a mode/feature uses. Only entries whose provider has keys are returned. */
function chainFor(feature) {
  const key = { code: 'code', vision: 'vision', image: 'image' }[feature] || 'text';
  return chains[key].filter((e) => providers[e.provider]?.keys.length);
}

const poolFor = (name) => providers[name]?.keys || [];

/* ───────────────────────── Startup summary (never prints keys) ───────────────────────── */
const fmt = (list) => list.map((e) => `${e.provider}${providers[e.provider].keys.length ? '' : '(no keys)'}:${e.model}`).join(' → ');
console.log(`[chains] TEXT   ${fmt(chains.text)}`);
console.log(`[chains] CODE   ${fmt(chains.code)}`);
console.log(`[chains] VISION ${fmt(chains.vision)}`);
console.log(`[chains] IMAGE  ${fmt(chains.image)}`);
console.log(`[keys] ${Object.values(providers).filter((p) => p.name !== 'pollinations').map((p) => `${p.name}:${p.keys.length}`).join(' ')}`);

module.exports = { providers, chains, chainFor, poolFor, PROVIDER_LABEL, labelOf, DEFAULT_MODELS };
