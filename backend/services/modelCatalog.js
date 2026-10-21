/**
 * services/modelCatalog.js — the models users can pick in the Model Switcher.
 *
 * Built from your chains (CHAIN_TEXT + CHAIN_CODE) for providers that have keys, or set it
 * explicitly:  MODEL_MENU=gemini:gemini-3.8-flash,groq:openai/gpt-oss-120b,deepseek:deepseek-flash
 *
 * Only ids from this catalog are accepted from the browser (users can't inject model names).
 * A picked model is tried FIRST; if it fails or is rate-limited, normal auto-fallback continues.
 */
const { providers, chains, PROVIDER_LABEL } = require('../config/apiKeys');

const MODEL_LABEL = {
  'gemini-4-argon': 'Gemini 4 Argon',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (preview)',
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'qwen/qwen3.6-27b': 'Qwen 3.6 27B',
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'openrouter/free': 'Free models (auto)',
  'qwen/qwen3-coder:free': 'Qwen3 Coder (free)',
  'mistral-small-latest': 'Mistral Small',
  'mistral-medium-latest': 'Mistral Medium',
  'codestral-latest': 'Codestral',
};
const HINT = {
  'gemini-3.8-flash': 'Fast, multimodal, great all-rounder',
  'openai/gpt-oss-120b': 'Very fast on Groq, shows reasoning',
  'deepseek-v4-pro': 'Strongest for complex code',
  'deepseek-flash': 'Quick and cheap',
  'codestral-latest': 'Code-specialised',
  'openrouter/free': 'Routes to any available free model',
};

const pretty = (model) => MODEL_LABEL[model] || model.split('/').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function parseMenu(spec) {
  return String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const i = item.indexOf(':');
    return { provider: (i === -1 ? item : item.slice(0, i)).toLowerCase(), model: i === -1 ? '' : item.slice(i + 1) };
  });
}

let cache = null;
function catalog() {
  if (cache) return cache;
  const source = process.env.MODEL_MENU ? parseMenu(process.env.MODEL_MENU) : [...chains.text, ...chains.code];
  const seen = new Set();
  const list = [];
  for (const e of source) {
    const p = providers[e.provider];
    if (!p || p.type === 'image' || !p.keys.length) continue;
    const model = e.model || p.model;
    const id = `${e.provider}:${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      provider: e.provider,
      model,
      label: pretty(model),
      providerLabel: PROVIDER_LABEL[e.provider],
      hint: HINT[model] || '',
      code: chains.code.some((c) => c.provider === e.provider && c.model === model),
      vision: e.provider === 'gemini',
    });
  }
  cache = [{ id: 'auto', label: 'Auto', providerLabel: 'Best model for each task', hint: 'Picks the right chain (text, code, vision) with automatic fallback', auto: true }, ...list];
  return cache;
}

/** Validates a browser-supplied id → { provider, model } or null (auto / unknown). */
function resolveModel(id) {
  if (!id || id === 'auto') return null;
  const m = catalog().find((x) => x.id === id && !x.auto);
  return m ? { provider: m.provider, model: m.model, label: m.label } : null;
}

module.exports = { catalog, resolveModel, prettyModel: pretty };
