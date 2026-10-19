/**
 * Fail-safe cascading across providers:
 *   groq → gemini → openrouter → mistral   (order from PROVIDER_ORDER)
 *
 * For each provider we try up to KEYS_PER_PROVIDER rotated keys. On a 429,
 * 5xx, timeout or network error we immediately (no backoff delay) move on,
 * so the user just sees an answer from whichever provider responded.
 *
 * Messages use a neutral format:
 *   { role: 'user'|'assistant', content: string, images?: [{ mimeType, data(base64) }] }
 */
const { providers, providerOrder } = require('../config/apiKeys');
const keys = require('./keyRotationService');

const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 45000);
const KEYS_PER_PROVIDER = Number(process.env.KEYS_PER_PROVIDER || 2);

class ProviderError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    throw new ProviderError(err.name === 'AbortError' ? 'timeout' : err.message, 0);
  } finally {
    clearTimeout(t);
  }
}

async function readError(res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  return new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, retryAfter);
}

/* ─────────────── OpenAI-compatible providers (Groq, OpenRouter, Mistral) ─────────────── */
async function callOpenAICompatible(p, key, { system, messages, temperature, maxTokens }) {
  const body = {
    model: p.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  const res = await fetchWithTimeout(p.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.extraHeaders || {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError('empty response', 502);
  return { text, model: p.model };
}

/* ─────────────── Google Gemini (native REST, supports vision + PDF) ─────────────── */
async function callGemini(p, key, { system, messages, temperature, maxTokens, vision }) {
  const model = vision ? p.visionModel : p.model;
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.images || []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
      { text: m.content || ' ' },
    ],
  }));
  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
  const url = `${p.baseUrl}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  if (!text) throw new ProviderError(`empty response (${data?.candidates?.[0]?.finishReason || 'unknown'})`, 502);
  return { text, model };
}

async function callProvider(p, key, payload) {
  return p.type === 'gemini' ? callGemini(p, key, payload) : callOpenAICompatible(p, key, payload);
}

/**
 * Main entry point.
 * @param {object} opts
 * @param {string} opts.system         system instruction
 * @param {Array}  opts.messages       conversation
 * @param {boolean} [opts.vision]      true when images/PDF bytes are attached → Gemini only
 */
async function generate({ system, messages, temperature = 0.7, maxTokens = 4096, vision = false }) {
  // Image / scanned-PDF input can only be handled by Gemini in this stack
  const order = vision ? ['gemini'] : providerOrder;
  const errors = [];

  for (const name of order) {
    const p = providers[name];
    if (!p || !p.keys.length) continue;

    const tried = new Set();
    for (let attempt = 0; attempt < Math.min(KEYS_PER_PROVIDER, p.keys.length); attempt += 1) {
      const key = keys.nextKey(name, tried);
      if (!key) break; // every key cooling down → next provider
      tried.add(key);

      try {
        const out = await callProvider(p, key, { system, messages, temperature, maxTokens, vision });
        keys.markSuccess(name);
        return { ...out, provider: name };
      } catch (err) {
        const status = err.status || 0;
        errors.push(`${name}: ${err.message}`);
        if (status === 429) keys.markRateLimited(name, key, err.retryAfter);
        else if (status === 401 || status === 403) keys.markInvalid(name, key);
        else keys.markFailed(name);

        // 400 = our request is bad for this provider (e.g. model name) → skip provider entirely
        if (status === 400 || status === 404) break;
        // otherwise try the next key / next provider immediately
      }
    }
  }

  console.error('[fallback] all providers failed:', errors.join(' | '));
  const e = new Error(
    vision
      ? 'Vision analysis is temporarily unavailable. Make sure GEMINI_API_KEYS is set and try again.'
      : 'All AI providers are busy right now. Please try again in a moment.'
  );
  e.status = 503;
  throw e;
}

module.exports = { generate };
