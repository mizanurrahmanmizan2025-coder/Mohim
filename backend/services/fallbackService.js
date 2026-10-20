/**
 * services/fallbackService.js — feature-aware, streaming fallback engine.
 *
 *   generate({ feature, system, messages, ... })            → { text, provider, model }
 *   stream({ feature, system, messages, ... }, onEvent)     → same, while emitting:
 *       { type: 'attempt',  provider, model, label }       trying a provider
 *       { type: 'thinking', text }                         reasoning tokens (gpt-oss, DeepSeek, …)
 *       { type: 'delta',    text }                         answer tokens
 *       { type: 'reset' }                                  provider died mid-answer → discard partial text
 *       { type: 'fallback', from, to?, reason }            switching provider
 *
 * feature: 'text' (default) | 'code' | 'vision'   — chains come from config/apiKeys.js
 * Messages: { role: 'user'|'assistant', content, images?: [{ mimeType, data(base64) }] }
 */
const { providers, chainFor, PROVIDER_LABEL } = require('../config/apiKeys');
const keys = require('./keyRotationService');

const FIRST_TOKEN_TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS || 45000);
const IDLE_TIMEOUT = Number(process.env.STREAM_IDLE_TIMEOUT_MS || 60000);
const KEYS_PER_PROVIDER = Number(process.env.KEYS_PER_PROVIDER || 2);

class ProviderError extends Error {
  constructor(message, status = 0, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/* ───────────────────────── HTTP helpers ───────────────────────── */

/** fetch with a resettable inactivity timer, linked to the caller's abort signal */
function timedFetch(url, options, outerSignal) {
  const ctrl = new AbortController();
  let timer;
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms); };
  const onOuter = () => ctrl.abort(new Error('client aborted'));
  if (outerSignal) {
    if (outerSignal.aborted) onOuter();
    else outerSignal.addEventListener('abort', onOuter, { once: true });
  }
  arm(FIRST_TOKEN_TIMEOUT);
  const done = () => { clearTimeout(timer); outerSignal?.removeEventListener('abort', onOuter); };
  const promise = fetch(url, { ...options, signal: ctrl.signal }).catch((err) => {
    done();
    if (outerSignal?.aborted) throw Object.assign(new ProviderError('aborted', 499), { aborted: true });
    throw new ProviderError(ctrl.signal.aborted ? 'timeout' : err.message, 0);
  });
  return { promise, keepAlive: () => arm(IDLE_TIMEOUT), done };
}

async function readError(res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  let msg = text;
  try { msg = JSON.parse(text)?.error?.message || text; } catch { /* not json */ }
  return new ProviderError(`HTTP ${res.status}: ${String(msg).slice(0, 240)}`, res.status, Number(res.headers.get('retry-after')) || undefined);
}

/** Yields the `data:` payload of each Server-Sent Event in a fetch body */
async function* sseData(body, keepAlive) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    keepAlive?.();
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

/* ───────────────────────── Request builders ───────────────────────── */

function openAIBody(model, { system, messages, temperature, maxTokens }, streamMode) {
  return {
    model,
    temperature,
    max_tokens: maxTokens,
    stream: streamMode,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: String(m.content || '') })),
    ],
  };
}

function geminiBody({ system, messages, temperature, maxTokens }) {
  return {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.images || []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
        { text: String(m.content || ' ') },
      ],
    })),
    generationConfig: { temperature, maxOutputTokens: maxTokens },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

/* ───────────────────────── One provider call (streaming) ───────────────────────── */
async function streamOnce(p, model, key, payload, emit, signal) {
  let url;
  let headers;
  let body;
  if (p.type === 'gemini') {
    url = `${p.baseUrl}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    body = geminiBody(payload);
  } else {
    url = p.baseUrl;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.extraHeaders || {}) };
    body = openAIBody(model, payload, true);
  }

  const req = timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
  const res = await req.promise;
  if (!res.ok) { req.done(); throw await readError(res); }

  let text = '';
  let emitted = false;
  try {
    for await (const data of sseData(res.body, req.keepAlive)) {
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new ProviderError(j.error.message || 'stream error', j.error.code === 429 ? 429 : 502);

      if (p.type === 'gemini') {
        for (const part of j.candidates?.[0]?.content?.parts || []) {
          if (!part.text) continue;
          if (part.thought) emit({ type: 'thinking', text: part.text });
          else { text += part.text; emitted = true; emit({ type: 'delta', text: part.text }); }
        }
        const reason = j.candidates?.[0]?.finishReason;
        if (reason && !['STOP', 'MAX_TOKENS'].includes(reason) && !text) throw new ProviderError(`blocked (${reason})`, 502);
      } else {
        const d = j.choices?.[0]?.delta || {};
        const thought = d.reasoning || d.reasoning_content;
        if (thought) emit({ type: 'thinking', text: thought });
        if (d.content) { text += d.content; emitted = true; emit({ type: 'delta', text: d.content }); }
      }
    }
  } catch (err) {
    req.done();
    if (signal?.aborted) throw Object.assign(new ProviderError('aborted', 499), { aborted: true, partial: text });
    throw Object.assign(err instanceof ProviderError ? err : new ProviderError(err.message, 0), { emitted });
  }
  req.done();
  if (!text.trim()) throw Object.assign(new ProviderError('empty response', 502), { emitted });
  return { text, model };
}

/* ───────────────────────── One provider call (non-streaming) ───────────────────────── */
async function callOnce(p, model, key, payload, signal) {
  let url;
  let headers;
  let body;
  if (p.type === 'gemini') {
    url = `${p.baseUrl}/${encodeURIComponent(model)}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    body = geminiBody(payload);
  } else {
    url = p.baseUrl;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.extraHeaders || {}) };
    body = openAIBody(model, payload, false);
  }
  const req = timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
  const res = await req.promise;
  try {
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    const text = p.type === 'gemini'
      ? (data?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('')
      : data?.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('empty response', 502);
    return { text, model };
  } finally {
    req.done();
  }
}

/* ───────────────────────── Chain runner ───────────────────────── */
const shortReason = (err) => {
  if (err.status === 429) return 'rate limit reached';
  if (err.status === 401 || err.status === 403) return 'key rejected';
  if (err.status === 404) return 'model not available';
  if (err.message === 'timeout') return 'timed out';
  if (err.status >= 500) return 'server busy';
  return 'request failed';
};

async function run(opts, onEvent, streaming) {
  const {
    feature = 'text', system, messages, temperature = 0.7, maxTokens = 8192, vision = false, signal,
  } = opts;
  const emit = onEvent || (() => {});
  const chain = chainFor(vision ? 'vision' : feature);
  const payload = { system, messages, temperature, maxTokens };
  const errors = [];

  for (let c = 0; c < chain.length; c += 1) {
    const { provider, model } = chain[c];
    const p = providers[provider];
    const tried = new Set();
    let skipProvider = false;

    for (let attempt = 0; attempt < Math.min(KEYS_PER_PROVIDER, p.keys.length) && !skipProvider; attempt += 1) {
      const key = keys.nextKey(provider, tried);
      if (!key) break;
      tried.add(key);
      emit({ type: 'attempt', provider, model, label: PROVIDER_LABEL[provider], attempt });

      try {
        const out = streaming
          ? await streamOnce(p, model, key, payload, emit, signal)
          : await callOnce(p, model, key, payload, signal);
        keys.markSuccess(provider);
        return { ...out, provider };
      } catch (err) {
        if (err.aborted || signal?.aborted) throw Object.assign(new Error('Request cancelled'), { status: 499, aborted: true, partial: err.partial });
        errors.push(`${provider}/${model}: ${err.message}`);
        if (err.status === 429) keys.markRateLimited(provider, key, err.retryAfter);
        else if (err.status === 401 || err.status === 403) keys.markInvalid(provider, key);
        else keys.markFailed(provider);

        if (err.emitted) emit({ type: 'reset' });
        if (err.status === 400 || err.status === 404) skipProvider = true; // bad model/request → next provider

        const next = attempt + 1 < Math.min(KEYS_PER_PROVIDER, p.keys.length) && !skipProvider
          ? { provider, label: `${PROVIDER_LABEL[provider]} (another key)` }
          : chain[c + 1] && { provider: chain[c + 1].provider, label: PROVIDER_LABEL[chain[c + 1].provider] };
        emit({ type: 'fallback', from: provider, fromLabel: PROVIDER_LABEL[provider], to: next?.provider, toLabel: next?.label, reason: shortReason(err) });
      }
    }
  }

  console.error(`[fallback:${vision ? 'vision' : feature}] all providers failed:`, errors.join(' | ') || 'no providers with keys');
  const e = new Error(
    vision
      ? 'Image/PDF analysis is unavailable right now. Make sure GEMINI_API_KEYS is set and try again.'
      : chain.length
        ? 'All AI providers are busy right now. Please try again in a moment.'
        : 'No AI provider keys are configured on the server.'
  );
  e.status = 503;
  throw e;
}

const generate = (opts) => run(opts, opts.onEvent, false);
const stream = (opts, onEvent) => run(opts, onEvent, true);

module.exports = { generate, stream, ProviderError, sseData };
