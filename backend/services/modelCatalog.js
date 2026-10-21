/**
 * services/modelCatalog.js — everything the Model Switcher can offer.
 *
 * Groups (only providers that have keys are shown):
 *   Recommended   ⚡ Groq GPT-OSS (fastest, default) · Gemini · DeepSeek · Mistral …
 *   OpenRouter    "Free models (auto)" + the currently FREE models, fetched live
 *   Hugging Face  chat models available through HF Inference Providers, fetched live
 *   Auto          smart routing by feature chain
 *
 * Live lists refresh every MODEL_LIST_TTL_MS (1 h). If a fetch fails, the last good list
 * (or a small built-in list) is used, so the menu never breaks.
 *
 * Only ids present in this catalog are accepted from the browser (no model-name injection).
 * The picked model is tried FIRST; on rate limit / error the normal chain continues.
 *
 * Env: DEFAULT_MODEL (default "groq:openai/gpt-oss-120b"), MODEL_MENU (override the
 *      Recommended list), FREE_MODELS_PER_PROVIDER (default 15).
 */
const { providers, chains, PROVIDER_LABEL } = require('../config/apiKeys');

const TTL = Number(process.env.MODEL_LIST_TTL_MS || 60 * 60 * 1000);
const PER_PROVIDER = Number(process.env.FREE_MODELS_PER_PROVIDER || 15);
const DEFAULT_ID = process.env.DEFAULT_MODEL || 'groq:openai/gpt-oss-120b';

const LABEL = {
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'qwen/qwen3.6-27b': 'Qwen 3.6 27B',
  'gemini-4-argon': 'Gemini 4 Argon',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (preview)',
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'openrouter/free': 'Free models (auto-pick)',
  'qwen/qwen3-coder:free': 'Qwen3 Coder',
  'mistral-small-latest': 'Mistral Small',
  'mistral-medium-latest': 'Mistral Medium',
  'codestral-latest': 'Codestral',
};
const HINT = {
  'groq:openai/gpt-oss-120b': 'Fastest — default',
  'gemini:gemini-3.8-flash': 'Multimodal, reads images & PDFs',
  'gemini:gemini-3.6-flash': 'Replacement for Gemini 2.0 Flash',
  'deepseek:deepseek-flash': 'Quick and cheap',
  'deepseek:deepseek-v4-pro': 'Strongest for complex code',
  'mistral:codestral-latest': 'Code-specialised',
  'openrouter:openrouter/free': 'Routes to any available free model',
};
const ICON = { groq: '⚡', gemini: '🤖', deepseek: '🧠', openrouter: '🌐', hfchat: '🤗', mistral: '🌀' };

// used when the live lists can't be fetched
const FALLBACK_LIVE = {
  openrouter: ['qwen/qwen3-coder:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3.1:free', 'google/gemma-3-27b-it:free', 'mistralai/mistral-small-3.2-24b-instruct:free'],
  hfchat: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.1'],
};

const pretty = (model) => LABEL[model] || model
  .replace(/:free$/, '')
  .split('/').pop()
  .replace(/[-_]/g, ' ')
  .replace(/\b(\d+)b\b/gi, '$1B')
  .replace(/\b([a-z])/g, (c) => c.toUpperCase());

const has = (p) => providers[p]?.keys.length > 0;
const item = (provider, model, group, extra = {}) => ({
  id: `${provider}:${model}`,
  provider,
  model,
  label: pretty(model),
  icon: ICON[provider] || '•',
  providerLabel: PROVIDER_LABEL[provider],
  group,
  hint: HINT[`${provider}:${model}`] || '',
  code: chains.code.some((c) => c.provider === provider && c.model === model),
  vision: provider === 'gemini',
  ...extra,
});

/* ───────────────────────── live free-model lists ───────────────────────── */
const live = { openrouter: null, hfchat: null, fetchedAt: 0, loading: null };

async function getJson(url, key) {
  const res = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchOpenRouterFree() {
  const j = await getJson('https://openrouter.ai/api/v1/models', providers.openrouter.keys[0]);
  return (j.data || [])
    .filter((m) => m.id?.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0))
    .filter((m) => !/(embed|whisper|tts|image|vision-only)/i.test(m.id))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .slice(0, PER_PROVIDER)
    .map((m) => ({ id: m.id, name: m.name?.replace(/\s*\(free\)\s*$/i, '').replace(/^[^:]+:\s*/, ''), context: m.context_length }));
}

const HF_PREFER = /(gpt-oss|llama|qwen|deepseek|mistral|gemma|phi|kimi|glm)/i;
async function fetchHuggingFace() {
  const j = await getJson('https://router.huggingface.co/v1/models', providers.hfchat.keys[0]);
  return (j.data || [])
    .map((m) => ({ id: m.id, name: null, context: m.providers?.[0]?.context_length }))
    .filter((m) => m.id && !/(embed|rerank|whisper|tts|diffusion|flux|sdxl)/i.test(m.id))
    .sort((a, b) => (HF_PREFER.test(b.id) - HF_PREFER.test(a.id)) || a.id.localeCompare(b.id))
    .slice(0, PER_PROVIDER);
}

async function refreshLive(force = false) {
  if (!force && Date.now() - live.fetchedAt < TTL) return;
  if (live.loading) return live.loading;
  live.loading = (async () => {
    const [or, hf] = await Promise.allSettled([
      has('openrouter') ? fetchOpenRouterFree() : Promise.resolve(null),
      has('hfchat') ? fetchHuggingFace() : Promise.resolve(null),
    ]);
    if (or.status === 'fulfilled' && or.value?.length) live.openrouter = or.value;
    else if (or.status === 'rejected') console.warn('[models] OpenRouter list unavailable:', or.reason.message);
    if (hf.status === 'fulfilled' && hf.value?.length) live.hfchat = hf.value;
    else if (hf.status === 'rejected') console.warn('[models] Hugging Face list unavailable:', hf.reason.message);
    live.fetchedAt = Date.now();
    cache = null;
  })().finally(() => { live.loading = null; });
  return live.loading;
}

/* ───────────────────────── catalog ───────────────────────── */
let cache = null;

function build() {
  const list = [];
  const seen = new Set();
  const push = (it) => { if (!seen.has(it.id)) { seen.add(it.id); list.push(it); } };

  // Recommended: Groq first (default), then the user-facing providers, then chain extras
  const featured = process.env.MODEL_MENU
    ? process.env.MODEL_MENU.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf(':'); return { provider: s.slice(0, i), model: s.slice(i + 1) }; })
    : [
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
      { provider: 'deepseek', model: 'deepseek-flash' },
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      ...chains.text.filter((e) => !['openrouter', 'hfchat'].includes(e.provider)),
      ...chains.code.filter((e) => !['openrouter', 'hfchat'].includes(e.provider)),
    ];
  for (const e of featured) {
    if (!providers[e.provider] || providers[e.provider].type === 'image' || !has(e.provider)) continue;
    push(item(e.provider, e.model || providers[e.provider].model, 'Recommended', e.provider === 'groq' && e.model === 'openai/gpt-oss-120b' ? { badge: 'Fastest' } : {}));
  }

  if (has('openrouter')) {
    push(item('openrouter', 'openrouter/free', 'OpenRouter · free'));
    for (const m of live.openrouter || FALLBACK_LIVE.openrouter.map((id) => ({ id }))) {
      push(item('openrouter', m.id, 'OpenRouter · free', { label: m.name || pretty(m.id), free: true, context: m.context }));
    }
  }
  if (has('hfchat')) {
    for (const m of live.hfchat || FALLBACK_LIVE.hfchat.map((id) => ({ id }))) {
      push(item('hfchat', m.id, 'Hugging Face', { label: pretty(m.id), context: m.context }));
    }
  }

  const auto = { id: 'auto', label: 'Auto (smart routing)', icon: '✨', group: 'Auto', hint: 'Best chain per task (chat, code, vision) with fallback', auto: true };
  const defaultId = list.some((m) => m.id === DEFAULT_ID) ? DEFAULT_ID : list[0]?.id || 'auto';
  return { models: [...list, auto], defaultId };
}

/** Full catalog for the Model Switcher (refreshes live lists in the background). */
async function getCatalog() {
  const stale = Date.now() - live.fetchedAt >= TTL;
  if (!live.fetchedAt) await refreshLive().catch(() => {}); // first call waits (≤ 8 s)
  else if (stale) refreshLive().catch(() => {}); // later: refresh without blocking
  if (!cache) cache = build();
  return cache;
}

/** Validates a browser-supplied id → { provider, model, label } or null (auto / unknown). */
async function resolveModel(id) {
  if (!id || id === 'auto') return null;
  const { models } = await getCatalog();
  const m = models.find((x) => x.id === id && !x.auto);
  return m ? { provider: m.provider, model: m.model, label: m.label } : null;
}

// warm the live lists at startup so the first user doesn't wait
setTimeout(() => refreshLive().catch(() => {}), 2000).unref?.();

module.exports = { getCatalog, resolveModel, prettyModel: pretty };
