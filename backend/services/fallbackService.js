/**
 * services/fallbackService.js — low-latency, feature-aware fallback engine.
 *
 *   generate({ feature, system, messages, ... })            → { text, provider, model }
 *   stream({ feature, system, messages, ... }, onEvent)     → same, emitting live events:
 *       attempt { provider, model, label, parallel }   thinking { text }   delta { text }
 *       reset {}   fallback { fromLabel, toLabel, reason }   hedge { label }   waiting { seconds, label }
 *
 * SPEED
 *  • Phase timeouts instead of one long timer:
 *      connect  CONNECT_TIMEOUT_MS (4 s, in config/http.js)
 *      headers  HEADERS_TIMEOUT_MS (8 s)   – request sent → provider answered
 *      first    FIRST_TOKEN_TIMEOUT_MS (20 s) – first token (thinking or text)
 *      idle     STREAM_IDLE_TIMEOUT_MS (30 s) – gap between tokens
 *  • Instant failover: 429 / timeout / network error → next key or provider immediately.
 *  • Hedged requests: if no token arrives within HEDGE_AFTER_MS (5 s), a parallel request
 *    starts on the next PROVIDER; the first one to produce a token wins and the other is
 *    cancelled. Set HEDGE_AFTER_MS=0 to disable (saves quota).
 *  • Health-aware order: providers that are down (providerHealth) are tried last.
 *  • Only when EVERY key everywhere is rate-limited does it wait (≤ MAX_QUEUE_WAIT_MS).
 */
const { providers, chainFor, PROVIDER_LABEL } = require('../config/apiKeys');
const { describeNetworkError } = require('../config/http');
const keys = require('./keyRotationService');
const health = require('./providerHealth');

const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS || 8000);
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.FIRST_TOKEN_TIMEOUT_MS || process.env.PROVIDER_TIMEOUT_MS || 20000);
const IDLE_TIMEOUT_MS = Number(process.env.STREAM_IDLE_TIMEOUT_MS || 30000);
const NONSTREAM_TIMEOUT_MS = Number(process.env.NONSTREAM_TIMEOUT_MS || 30000);
const HEDGE_AFTER_MS = Number(process.env.HEDGE_AFTER_MS ?? 5000);
const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL_ATTEMPTS || 2));
const PREFERRED_HEDGE_AFTER_MS = Number(process.env.PREFERRED_HEDGE_AFTER_MS ?? 15000); // 0 = never race a picked model
const MAX_KEYS_PER_PROVIDER = Number(process.env.KEYS_PER_PROVIDER || 5);
const MAX_QUEUE_WAIT_MS = Number(process.env.MAX_QUEUE_WAIT_MS || 10000);

const THINKING = {
  text: process.env.GEMINI_THINKING_TEXT || 'low',
  code: process.env.GEMINI_THINKING_CODE || 'medium',
  vision: process.env.GEMINI_THINKING_VISION || 'low',
};
const noThinkingConfig = new Set();

class ProviderError extends Error {
  constructor(message, status = 0, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const cancelled = (partial) => Object.assign(new Error('Request cancelled'), { status: 499, aborted: true, partial });
const LOST = { lostRace: true };

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(cancelled()); }, { once: true });
});

/* ───────────────────────── per-attempt phase timer ───────────────────────── */
function phaseTimer(ctrl) {
  let t;
  return {
    arm(ms, label) { clearTimeout(t); t = setTimeout(() => ctrl.abort({ timeout: label }), ms); },
    clear() { clearTimeout(t); },
  };
}

/** Converts a thrown fetch/stream error into a ProviderError with a clear reason. */
function toProviderError(err, signal) {
  if (err instanceof ProviderError) return err;
  const reason = signal?.reason;
  if (reason?.timeout) return Object.assign(new ProviderError(reason.timeout, 0), { network: true, timeout: true });
  // only genuine connection problems count against provider health
  const code = err?.cause?.code || err?.code || '';
  const isNetwork = /^(UND_ERR|E[A-Z]{3,})/.test(code)
    || (err?.name === 'TypeError' && /fetch failed|terminated|network|socket/i.test(err.message || ''))
    || err?.name === 'AbortError';
  if (isNetwork) return Object.assign(new ProviderError(describeNetworkError(err), 0), { network: true });
  return new ProviderError(err?.message || 'bad response', 502); // malformed reply etc. → just try the next one
}

async function readError(res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  let msg = text;
  try { msg = JSON.parse(text)?.error?.message || text; } catch { /* not json */ }
  let retryAfter = Number(res.headers.get('retry-after')) || undefined;
  const gem = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!retryAfter && gem) retryAfter = Math.ceil(Number(gem[1]));
  const err = new ProviderError(`HTTP ${res.status}: ${String(msg).slice(0, 240)}`, res.status, retryAfter);
  err.raw = text.slice(0, 2000);
  return err;
}

async function* sseData(body, onChunk) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    onChunk?.();
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

/* ───────────────────────── request builders ───────────────────────── */
function openAIBody(model, { system, messages, temperature, maxTokens }, streaming) {
  return {
    model, temperature, max_tokens: maxTokens, stream: streaming,
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

/** POST with headers timeout; Gemini thinkingConfig rejected (400) → retry once without it. */
async function send(p, model, key, payload, streaming, signal, timer) {
  for (let pass = 0; pass < 2; pass += 1) {
    const r = buildRequest(p, model, key, payload, streaming);
    timer.arm(streaming ? HEADERS_TIMEOUT_MS : NONSTREAM_TIMEOUT_MS, streaming ? 'no response (headers timeout)' : 'timed out');
    let res;
    try {
      res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal });
    } catch (err) {
      throw toProviderError(err, signal);
    }
    if (res.ok) return res;
    const err = await readError(res);
    if (p.type === 'gemini' && res.status === 400 && r.body.generationConfig?.thinkingConfig && /thinking/i.test(err.raw || '')) {
      noThinkingConfig.add(model);
      continue;
    }
    throw err;
  }
  throw new ProviderError('request rejected', 400);
}

/* ───────────────────────── one attempt ───────────────────────── */
async function streamOnce({ provider, model, key }, payload, onToken, signal) {
  const p = providers[provider];
  const timer = phaseTimer(signal.__ctrl);
  const t0 = Date.now();
  let text = '';
  let emitted = false;
  let firstTokenAt = 0;
  try {
    const res = await send(p, model, key, payload, true, signal, timer);
    timer.arm(FIRST_TOKEN_TIMEOUT_MS, 'no first token');
    const token = () => {
      if (!firstTokenAt) firstTokenAt = Date.now();
      timer.arm(IDLE_TIMEOUT_MS, 'stream stalled');
    };
    for await (const data of sseData(res.body, () => firstTokenAt && timer.arm(IDLE_TIMEOUT_MS, 'stream stalled'))) {
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new ProviderError(j.error.message || 'stream error', j.error.code === 429 ? 429 : 502);

      if (p.type === 'gemini') {
        for (const part of j.candidates?.[0]?.content?.parts || []) {
          if (!part.text) continue;
          token();
          if (part.thought) onToken({ type: 'thinking', text: part.text });
          else { text += part.text; emitted = true; onToken({ type: 'delta', text: part.text }); }
        }
        const reason = j.candidates?.[0]?.finishReason;
        if (reason && !['STOP', 'MAX_TOKENS'].includes(reason) && !text) throw new ProviderError(`blocked (${reason})`, 502);
      } else {
        const d = j.choices?.[0]?.delta || {};
        const thought = d.reasoning || d.reasoning_content;
        if (thought) { token(); onToken({ type: 'thinking', text: thought }); }
        if (d.content) { token(); text += d.content; emitted = true; onToken({ type: 'delta', text: d.content }); }
      }
    }
  } catch (err) {
    throw Object.assign(toProviderError(err, signal), { emitted, partial: text });
  } finally {
    timer.clear();
  }
  if (!text.trim()) throw Object.assign(new ProviderError('empty response', 502), { emitted });
  return { text, model, ttfb: (firstTokenAt || Date.now()) - t0 };
}

async function callOnce({ provider, model, key }, payload, signal) {
  const p = providers[provider];
  const timer = phaseTimer(signal.__ctrl);
  const t0 = Date.now();
  try {
    const res = await send(p, model, key, payload, false, signal, timer);
    const data = await res.json();
    const text = p.type === 'gemini'
      ? (data?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('')
      : data?.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('empty response', 502);
    return { text, model, ttfb: Date.now() - t0 };
  } catch (err) {
    throw toProviderError(err, signal);
  } finally {
    timer.clear();
  }
}

/* ───────────────────────── candidate picker ───────────────────────── */
const entryKey = (e) => `${e.provider}/${e.model}`;

function candidatePicker(chain) {
  const dead = new Set();
  const tried = {}; // entryKey → Set(keys)
  const budget = (e) => Math.min(MAX_KEYS_PER_PROVIDER, providers[e.provider].keys.length);
  const usable = (e, excludeProviders) => !dead.has(entryKey(e)) && !excludeProviders.has(e.provider)
    && (tried[entryKey(e)]?.size || 0) < budget(e);
  return {
    /** next {provider, model, key}, preferring chain order; skips providers in excludeProviders */
    next(excludeProviders = new Set()) {
      for (const e of chain) {
        if (!usable(e, excludeProviders)) continue;
        const set = (tried[entryKey(e)] ||= new Set());
        const key = keys.nextKey(e.provider, set);
        if (!key) { dead.add(entryKey(e)); continue; } // every key cooling down
        set.add(key);
        return { ...e, key };
      }
      return null;
    },
    peekLabel(excludeProviders = new Set()) {
      const e = chain.find((x) => usable(x, excludeProviders) && keys.nextKeyAvailable(x.provider));
      return e && PROVIDER_LABEL[e.provider];
    },
    kill(e) { dead.add(entryKey(e)); },
  };
}

const shortReason = (err) => {
  if (err.status === 429) return 'rate limit reached';
  if (err.status === 401 || err.status === 403) return 'key rejected';
  if (err.status === 404) return 'model not available';
  if (err.network) return err.message;
  if (err.status >= 500) return 'server busy';
  return 'request failed';
};

/* ───────────────────────── race: sequential failover + hedging ───────────────────────── */
function race({ chain, payload, emit, signal, streaming, errors, hedgeMs = HEDGE_AFTER_MS }) {
  const picker = candidatePicker(chain);
  return new Promise((resolve, reject) => {
    const active = new Map(); // id → { ctrl, cand }
    let winner = null;
    let settled = false;
    let seq = 0;
    let hedgeTimer = null;

    const abortOthers = (keep) => { for (const [id, a] of active) if (id !== keep) a.ctrl.abort(LOST); };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      abortOthers(winner);
      fn(value);
    };
    const activeProviders = () => new Set([...active.values()].map((a) => a.cand.provider));

    const scheduleHedge = () => {
      clearTimeout(hedgeTimer);
      if (!hedgeMs || settled || winner !== null || active.size >= MAX_PARALLEL) return;
      hedgeTimer = setTimeout(() => {
        if (settled || winner !== null || active.size >= MAX_PARALLEL) return;
        const slow = [...active.values()].map((a) => PROVIDER_LABEL[a.cand.provider]).join(', ');
        if (launch(activeProviders())) emit({ type: 'hedge', label: `${slow} is slow — racing a backup provider` });
        scheduleHedge();
      }, hedgeMs);
    };

    function launch(excludeProviders) {
      const cand = picker.next(excludeProviders);
      if (!cand) return false;
      const id = ++seq;
      const ctrl = new AbortController();
      ctrl.signal.__ctrl = ctrl; // lets the phase timer abort this attempt only
      const onOuter = () => ctrl.abort({ cancelled: true });
      signal?.addEventListener('abort', onOuter, { once: true });
      active.set(id, { ctrl, cand });
      emit({ type: 'attempt', provider: cand.provider, model: cand.model, label: PROVIDER_LABEL[cand.provider], parallel: active.size > 1 });

      const claim = () => {
        if (winner === null) {
          winner = id;
          clearTimeout(hedgeTimer);
          if (active.size > 1) {
            abortOthers(id);
            emit({ type: 'attempt', provider: cand.provider, model: cand.model, label: PROVIDER_LABEL[cand.provider], won: true });
          }
        }
        return winner === id;
      };
      const onToken = (ev) => { if (!settled && claim()) emit(ev); };

      const work = streaming ? streamOnce(cand, payload, onToken, ctrl.signal) : callOnce(cand, payload, ctrl.signal);
      work.then((out) => {
        active.delete(id);
        signal?.removeEventListener('abort', onOuter);
        if (!claim()) return; // another attempt already won
        keys.markSuccess(cand.provider);
        health.recordSuccess(cand.provider, out.ttfb);
        finish(resolve, { text: out.text, model: out.model, provider: cand.provider });
      }).catch((err) => {
        active.delete(id);
        signal?.removeEventListener('abort', onOuter);
        if (signal?.aborted) return finish(reject, cancelled(err.partial));
        if (ctrl.signal.reason?.lostRace || settled) return; // cancelled because another attempt won

        errors.push(`${cand.provider}/${cand.model}: ${err.message}`);
        if (err.status === 429) keys.markRateLimited(cand.provider, cand.key, err.retryAfter, err.raw || err.message);
        else if (err.status === 401 || err.status === 403) keys.markInvalid(cand.provider, cand.key);
        else keys.markFailed(cand.provider);
        if (err.network) {
          health.recordFailure(cand.provider, err.message);
          picker.kill(cand); // provider not responding → don't try its other keys this request
        }
        if (err.status === 400 || err.status === 404) picker.kill(cand);

        const wasWinner = winner === id;
        if (wasWinner) {
          winner = null;
          if (err.emitted) emit({ type: 'reset' });
        }
        emit({
          type: 'fallback', from: cand.provider, fromLabel: PROVIDER_LABEL[cand.provider],
          toLabel: picker.peekLabel(activeProviders()) || (active.size ? 'parallel request' : undefined),
          reason: shortReason(err),
        });

        if (active.size === 0 || wasWinner) {
          if (launch(activeProviders())) scheduleHedge(); // instant failover, no delay
          else if (active.size === 0) finish(reject, Object.assign(new Error('exhausted'), { exhausted: true }));
        }
      });
      return true;
    }

    if (!launch(new Set())) return finish(reject, Object.assign(new Error('exhausted'), { exhausted: true }));
    scheduleHedge();
  });
}

/* ───────────────────────── public runner ───────────────────────── */
async function run(opts, onEvent, streaming) {
  const {
    feature = 'text', system, messages, temperature = 0.7, maxTokens = 8192, vision = false, signal, preferred = null,
  } = opts;
  const emit = onEvent || (() => {});
  const chainName = vision ? 'vision' : feature;
  const payload = { system, messages, temperature, maxTokens, thinking: THINKING[chainName] || THINKING.text };
  const errors = [];
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS;

  for (let round = 0; round < 4; round += 1) {
    let chain = health.order(chainFor(chainName));
    // user picked a model in the switcher → try it first, then continue the normal chain
    const pick = preferred && providers[preferred.provider]?.keys.length && (!vision || preferred.provider === 'gemini') ? preferred : null;
    if (pick) {
      const rest = chain.filter((e) => !(e.provider === pick.provider && e.model === pick.model));
      if (health.isDown(pick.provider) && round === 0) {
        emit({ type: 'fallback', fromLabel: `${PROVIDER_LABEL[pick.provider]} (${pick.label || pick.model})`, toLabel: rest[0] && PROVIDER_LABEL[rest[0].provider], reason: 'not responding right now' });
        chain = [...rest, pick];
      } else {
        chain = [{ provider: pick.provider, model: pick.model }, ...rest];
      }
    }
    if (!chain.length) break;
    try {
      // a manually picked model gets time to answer before a backup is raced against it
      return await race({ chain, payload, emit, signal, streaming, errors, hedgeMs: pick ? PREFERRED_HEDGE_AFTER_MS : HEDGE_AFTER_MS });
    } catch (err) {
      if (err.aborted) throw err;
      if (!err.exhausted) throw err;
    }
    // every key of every provider is rate-limited right now → short wait for the first free key
    const wait = Math.min(...chain.map((e) => keys.waitTimeMs(e.provider)));
    if (!Number.isFinite(wait) || wait > deadline - Date.now()) break;
    const ms = Math.max(300, wait);
    emit({ type: 'waiting', seconds: Math.ceil(ms / 1000), label: `All AI keys are busy — retrying in ${Math.ceil(ms / 1000)}s` });
    await sleep(ms, signal);
  }

  console.error(`[fallback:${chainName}] all providers failed:`, errors.join(' | ') || 'no providers with keys');
  const e = new Error(
    vision
      ? 'Image/PDF analysis is unavailable right now. Make sure GEMINI_API_KEYS is set and try again.'
      : chainFor(chainName).length
        ? 'All AI providers are at their limits right now. Please try again in a minute.'
        : 'No AI provider keys are configured on the server.'
  );
  e.status = 503;
  throw e;
}

const generate = (opts) => run(opts, opts.onEvent, false);
const stream = (opts, onEvent) => run(opts, onEvent, true);

module.exports = { generate, stream, ProviderError, sseData };
