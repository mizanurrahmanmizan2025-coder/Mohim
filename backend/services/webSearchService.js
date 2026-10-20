/**
 * services/webSearchService.js — live web research, streamed.
 *
 *   1. Tavily (if TAVILY_API_KEYS set) → results are summarised by CHAIN_TEXT (streamed, cited).
 *   2. Gemini "Grounding with Google Search" (your GEMINI keys), streamed via SSE.
 *   3. null → caller answers from model knowledge.
 *
 * onEvent receives: { type:'search_status', label } and the normal stream events
 * (delta / thinking / attempt / fallback / reset).
 * Returns { text, sources, engine, provider, model } or null.
 */
const { providers } = require('../config/apiKeys');
const keys = require('./keyRotationService');
const { stream, sseData } = require('./fallbackService');

const TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 45000);
const tavilyKeys = (process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '')
  .split(/[,\n]+/).map((k) => k.trim()).filter(Boolean);
let tavilyIndex = 0;

const today = () => new Date().toISOString().slice(0, 10);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function withTimeout(signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return { signal: ctrl.signal, done: () => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); } };
}

function formatSources(sources) {
  const seen = new Set();
  const list = sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 8);
  if (!list.length) return '';
  return `\n\n---\n**Sources**\n${list.map((s, i) => `${i + 1}. [${String(s.title || hostOf(s.url)).replace(/[[\]]/g, '')}](${s.url})`).join('\n')}`;
}

/* ───────────────────────── 1. Tavily + CHAIN_TEXT ───────────────────────── */
async function tavilySearch(query, { system, history, emit, signal }) {
  if (!tavilyKeys.length) return null;
  for (let attempt = 0; attempt < Math.min(2, tavilyKeys.length); attempt += 1) {
    const key = tavilyKeys[tavilyIndex++ % tavilyKeys.length];
    const to = withTimeout(signal);
    let body;
    try {
      emit({ type: 'search_status', label: `Searching the web for “${query.slice(0, 80)}”` });
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 6, include_answer: false }),
        signal: to.signal,
      });
      body = res.ok ? await res.json() : null;
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('[search] tavily failed:', err.message);
    } finally {
      to.done();
    }
    if (!Array.isArray(body?.results) || !body.results.length) continue;

    const results = body.results.slice(0, 6);
    emit({ type: 'search_status', label: `Reading ${results.length} sources: ${results.slice(0, 3).map((r) => hostOf(r.url)).join(', ')}…` });
    const block = results.map((x, i) => `[${i + 1}] ${x.title}\nURL: ${x.url}\n${String(x.content || '').slice(0, 1200)}`).join('\n\n');

    const out = await stream({
      feature: 'text',
      system: `${system}\nToday is ${today()}. Answer using ONLY the numbered web results. Cite claims inline like [1], [2]. If the results don't answer the question, say so.`,
      messages: [...history, { role: 'user', content: `${query}\n\nWEB RESULTS:\n${block}` }],
      temperature: 0.3,
      signal,
    }, emit);

    const sources = results.map((x) => ({ title: x.title, url: x.url }));
    const tail = formatSources(sources);
    emit({ type: 'delta', text: tail });
    return { text: out.text + tail, sources, engine: 'tavily', provider: out.provider, model: out.model };
  }
  return null;
}

/* ───────────────────────── 2. Gemini grounding (streamed) ───────────────────────── */
async function geminiGroundedSearch(query, { system, history, emit, signal }) {
  const p = providers.gemini;
  if (!p?.keys?.length) return null;

  const body = {
    contents: [...history, { role: 'user', content: query }].map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || ' ') }],
    })),
    tools: [{ google_search: {} }],
    systemInstruction: { parts: [{ text: `${system}\nToday is ${today()}. Use Google Search for up-to-date facts and mention dates where relevant.` }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };

  const tried = new Set();
  for (let attempt = 0; attempt < Math.min(3, p.keys.length); attempt += 1) {
    const key = keys.nextKey('gemini', tried);
    if (!key) break;
    tried.add(key);
    emit({ type: 'search_status', label: 'Searching Google…' });

    const to = withTimeout(signal);
    let text = '';
    const meta = { queries: [], chunks: [] };
    try {
      const res = await fetch(`${p.baseUrl}/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: to.signal,
      });
      if (!res.ok) {
        const status = res.status;
        if (status === 429) keys.markRateLimited('gemini', key, Number(res.headers.get('retry-after')) || undefined);
        else if (status === 401 || status === 403) keys.markInvalid('gemini', key);
        else keys.markFailed('gemini');
        console.warn(`[search] gemini grounding HTTP ${status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        if (status === 400 || status === 404) break;
        continue;
      }

      let announced = false;
      for await (const data of sseData(res.body)) {
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        const cand = j.candidates?.[0];
        const gm = cand?.groundingMetadata;
        if (gm?.webSearchQueries?.length) meta.queries = gm.webSearchQueries;
        if (gm?.groundingChunks?.length) meta.chunks = gm.groundingChunks;
        if (!announced && meta.queries.length) {
          announced = true;
          emit({ type: 'search_status', label: `Searched: ${meta.queries.slice(0, 2).join(' · ')}` });
        }
        for (const part of cand?.content?.parts || []) {
          if (part.text && !part.thought) { text += part.text; emit({ type: 'delta', text: part.text }); }
        }
      }
    } catch (err) {
      if (signal?.aborted) throw Object.assign(new Error('Request cancelled'), { aborted: true, status: 499 });
      keys.markFailed('gemini');
      console.warn('[search] gemini grounding error:', err.message);
      if (text) emit({ type: 'reset' });
      continue;
    } finally {
      to.done();
    }
    if (!text.trim()) continue;
    keys.markSuccess('gemini');

    const sources = meta.chunks.map((c) => c.web && { title: c.web.title, url: c.web.uri }).filter(Boolean);
    const searched = meta.queries.length
      ? `\n\n_🔎 Searched Google for: ${meta.queries.slice(0, 3).map((q) => `[${q}](https://www.google.com/search?q=${encodeURIComponent(q)})`).join(' · ')}_`
      : '';
    const tail = formatSources(sources) + searched;
    emit({ type: 'delta', text: tail });
    return { text: text + tail, sources, engine: 'gemini-grounding', provider: 'gemini', model: p.model };
  }
  return null;
}

/* ───────────────────────── Public ───────────────────────── */
async function webSearch(query, { system = '', history = [], onEvent, signal } = {}) {
  const emit = onEvent || (() => {});
  const h = history.slice(-6).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 2000) }));
  return (
    (await tavilySearch(query, { system, history: h, emit, signal })) ||
    (await geminiGroundedSearch(query, { system, history: h, emit, signal })) ||
    null
  );
}

module.exports = { webSearch };
