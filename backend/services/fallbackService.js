/**
 * services/fallbackService.js — feature-aware streaming fallback engine (multi-user safe).
 *
 *   generate({ feature, system, messages, ... })            → { text, provider, model }
 *   stream({ feature, system, messages, ... }, onEvent)     → same, emitting live events:
 *       attempt  { provider, model, label }      thinking { text }      delta { text }
 *       reset    {}  (provider failed mid-answer → partial text discarded)
 *       fallback { fromLabel, toLabel, reason }  waiting  { seconds, label }
 *
 * On 429 it rotates INSTANTLY to the next least-loaded key, then the next provider.
 * If every key of every provider is cooling down, it waits for the first one to free
 * up (max MAX_QUEUE_WAIT_MS) instead of failing the user's request.
 *
 * feature: 'text' (default) | 'code' | 'vision'   — chains come from config/apiKeys.js
 */
const { providers, chainFor, PROVIDER_LABEL } = require('../config/apiKeys');
const keys = require('./keyRotationService');

const FIRST_TOKEN_TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS || 45000);
const IDLE_TIMEOUT = Number(process.env.STREAM_IDLE_TIMEOUT_MS || 60000);
const MAX_KEYS_PER_PROVIDER = Number(process.env.KEYS_PER_PROVIDER || 5);
const MAX_QUEUE_WAIT_MS = Number(process.env.MAX_QUEUE_WAIT_MS || 25000);

// Gemini 3 thinks silently before the first word. Lower levels = answer starts sooner.
const THINKING = {
  text: process.env.GEMINI_THINKING_TEXT || 'low',
  code: process.env.GEMINI_THINKING_CODE || 'medium',
  vision: process.env.GEMINI_THINKING_VISION || 'low',
};
const noThinkingConfig = new Set(); // models that rejected thinkingConfig

class ProviderError extends Error {
  constructor(message, status = 0, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { aborted: true })); }, { once: true });
});

/* ───────────────────────── HTTP helpers ───────────────────────── */
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
  // Retry-After header (Groq/OpenRouter/Mistral) or Gemini's "retryDelay": "31s"
  let retryAfter = Number(res.headers.get('retry-after')) || undefined;
  const gem = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!retryAfter && gem) retryAfter = Math.ceil(Number(gem[1]));
  const err = new ProviderError(`HTTP ${res.status}: ${String(msg).slice(0, 240)}`, res.status, retryAfter);
  err.raw = text.slice(0, 2000);
  return err;
}

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

function geminiBody(model, { system, messages, temperature, maxTokens, thinking }) {
  const generationConfig = { temperature, maxOutputTokens: maxTokens };
  if (thinking && /^gemini-3/.test(model) && !noThinkingConfig.has(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: thinking, includeThoughts: true };
  }
  return {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.images || []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
        { text: String(m.content || ' ') },
      ],
    })),
    generationConfig,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

function buildRequest(p, model, key, payload, streaming) {
  if (p.type === 'gemini') {
    return {
      url: `${p.baseUrl}/${encodeURIComponent(model)}:${streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: geminiBody(model, payload),
    };
  }
  return {
    url: p.baseUrl,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.extraHeaders || {}) },
    body: openAIBody(model, payload, streaming),
  };
}

/** POST; if Gemini rejects thinkingConfig (400), remember that and retry once without it. */
async function send(p, model, key, payload, streaming, signal) {
  for (let pass = 0; pass < 2; pass += 1) {
    const r = buildRequest(p, model, key, payload, streaming);
    const req = timedFetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body) }, signal);
    const res = await req.promise;
    if (res.ok) return { res, req };
    req.done();
    const err = await readError(res);
    if (p.type === 'gemini' && res.status === 400 && r.body.generationConfig?.thinkingConfig && /thinking/i.test(err.raw || '')) {
      noThinkingConfig.add(model);
      continue;
    }
    throw err;
  }
  throw new ProviderError('request rejected', 400);
}

/* ───────────────────────── One provider call ───────────────────────── */
async function streamOnce(p, model, key, payload, emit, signal) {
  const { res, req } = await send(p, model, key, payload, true, signal);
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

async function callOnce(p, model, key, payload, signal) {
  const { res, req } = await send(p, model, key, payload, false, signal);
  try {
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
  const chainName = vision ? 'vision' : feature;
  const chain = chainFor(chainName);
  const payload = { system, messages, temperature, maxTokens, thinking: THINKING[chainName] || THINKING.text };
  const errors = [];
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
  const deadEntries = new Set(); // provider/model combos that can't work (bad model, no access)

  for (let round = 0; ; round += 1) {

    for (let c = 0; c < chain.length; c += 1) {
      const { provider, model } = chain[c];
      if (deadEntries.has(`${provider}/${model}`)) continue;
      const p = providers[provider];
      const tried = new Set();
      const limit = Math.min(MAX_KEYS_PER_PROVIDER, p.keys.length);

      for (let attempt = 0; attempt < limit; attempt += 1) {
        const key = keys.nextKey(provider, tried);
        if (!key) break; // remaining keys cooling down → next provider instantly
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
          if (err.status === 429) keys.markRateLimited(provider, key, err.retryAfter, err.raw || err.message);
          else if (err.status === 401 || err.status === 403) keys.markInvalid(provider, key);
          else keys.markFailed(provider);
          if (err.emitted) emit({ type: 'reset' });

          const fatalForEntry = err.status === 400 || err.status === 404;
          if (fatalForEntry) deadEntries.add(`${provider}/${model}`);

          const moreKeys = !fatalForEntry && attempt + 1 < limit && keys.nextKeyAvailable(provider);
          const next = moreKeys
            ? `${PROVIDER_LABEL[provider]} (another key)`
            : chain.slice(c + 1).filter((e) => !deadEntries.has(`${e.provider}/${e.model}`) && keys.nextKeyAvailable(e.provider)).map((e) => PROVIDER_LABEL[e.provider])[0];
          emit({ type: 'fallback', from: provider, fromLabel: PROVIDER_LABEL[provider], toLabel: next, reason: shortReason(err) });
          if (fatalForEntry) break;
        }
      }
    }

    // Everything busy right now? Wait for the first key to free up instead of failing.
    const live = chain.filter((e) => !deadEntries.has(`${e.provider}/${e.model}`));
    const wait = Math.min(...live.map((e) => keys.waitTimeMs(e.provider)));
    const remaining = deadline - Date.now();
    if (round >= 3 || !live.length || !Number.isFinite(wait) || wait > remaining) break;
    const ms = Math.max(400, wait);
    emit({ type: 'waiting', seconds: Math.ceil(ms / 1000), label: `All AI keys are busy — retrying in ${Math.ceil(ms / 1000)}s` });
    await sleep(ms, signal).catch(() => { throw Object.assign(new Error('Request cancelled'), { status: 499, aborted: true }); });
  }

  console.error(`[fallback:${chainName}] all providers failed:`, errors.join(' | ') || 'no providers with keys');
  const e = new Error(
    vision
      ? 'Image/PDF analysis is unavailable right now. Make sure GEMINI_API_KEYS is set and try again.'
      : chain.length
        ? 'All AI providers are at their limits right now. Please try again in a minute.'
        : 'No AI provider keys are configured on the server.'
  );
  e.status = 503;
  throw e;
}

const generate = (opts) => run(opts, opts.onEvent, false);
const stream = (opts, onEvent) => run(opts, onEvent, true);

module.exports = { generate, stream, ProviderError, sseData };
