/**
 * services/webSearchService.js — live web research for auto-routed "search" intents.
 *
 * Strategy (first one that works wins):
 *   1. Tavily  — if TAVILY_API_KEYS is set (free tier: tavily.com). Results are then
 *                summarised by the normal fallback engine with numbered citations.
 *   2. Gemini  — "Grounding with Google Search" using your existing GEMINI_API_KEYS,
 *                rotated through keyRotationService. No extra key needed.
 *   3. null    — caller answers from model knowledge and says so.
 *
 * Returns { text, sources: [{ title, url }], engine } or null.
 */
const { providers } = require('../config/apiKeys');
const keys = require('./keyRotationService');
const { generate } = require('./fallbackService');

const TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 30000);
const tavilyKeys = (process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '')
  .split(/[,\n]+/).map((k) => k.trim()).filter(Boolean);
let tavilyIndex = 0;

const today = () => new Date().toISOString().slice(0, 10);

async function fetchJson(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body, retryAfter: Number(res.headers.get('retry-after')) || undefined };
  } finally {
    clearTimeout(t);
  }
}

function formatSources(sources) {
  if (!sources.length) return '';
  const seen = new Set();
  const list = sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 8);
  return `\n\n---\n**Sources**\n${list.map((s, i) => `${i + 1}. [${(s.title || s.url).replace(/[[\]]/g, '')}](${s.url})`).join('\n')}`;
}

/* ───────────────────────── 1. Tavily ───────────────────────── */
async function tavilySearch(query, { system, history }) {
  if (!tavilyKeys.length) return null;

  for (let attempt = 0; attempt < Math.min(2, tavilyKeys.length); attempt += 1) {
    const key = tavilyKeys[tavilyIndex++ % tavilyKeys.length];
    try {
      const r = await fetchJson('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 6, include_answer: false }),
      });
      if (!r.ok || !Array.isArray(r.body.results)) continue;

      const results = r.body.results.slice(0, 6);
      const block = results.map((x, i) => `[${i + 1}] ${x.title}\nURL: ${x.url}\n${String(x.content || '').slice(0, 1200)}`).join('\n\n');
      const out = await generate({
        system: `${system}\nToday is ${today()}. Answer using ONLY the numbered web results below. Cite claims inline like [1], [2]. If the results don't answer the question, say so.`,
        messages: [...history, { role: 'user', content: `${query}\n\nWEB RESULTS:\n${block}` }],
        temperature: 0.3,
      });
      return {
        text: out.text + formatSources(results.map((x) => ({ title: x.title, url: x.url }))),
        sources: results.map((x) => ({ title: x.title, url: x.url })),
        engine: `tavily+${out.provider}`,
        provider: out.provider,
        model: out.model,
      };
    } catch (err) {
      console.warn('[search] tavily failed:', err.message);
    }
  }
  return null;
}

/* ───────────────────────── 2. Gemini grounding ───────────────────────── */
async function geminiGroundedSearch(query, { system, history }) {
  const p = providers.gemini;
  if (!p?.keys?.length) return null;

  const contents = [...history, { role: 'user', content: query }].map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || ' ') }],
  }));
  const body = {
    contents,
    tools: [{ google_search: {} }],
    systemInstruction: { parts: [{ text: `${system}\nToday is ${today()}. Use Google Search for up-to-date facts and mention dates where relevant.` }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };

  const tried = new Set();
  for (let attempt = 0; attempt < Math.min(3, p.keys.length); attempt += 1) {
    const key = keys.nextKey('gemini', tried);
    if (!key) break;
    tried.add(key);
    try {
      const r = await fetchJson(`${p.baseUrl}/${encodeURIComponent(p.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        if (r.status === 429) keys.markRateLimited('gemini', key, r.retryAfter);
        else if (r.status === 401 || r.status === 403) keys.markInvalid('gemini', key);
        else keys.markFailed('gemini');
        console.warn(`[search] gemini grounding HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        if (r.status === 400 || r.status === 404) break;
        continue;
      }

      const cand = r.body?.candidates?.[0];
      const text = (cand?.content?.parts || []).map((x) => x.text || '').join('').trim();
      if (!text) continue;
      keys.markSuccess('gemini');

      const meta = cand.groundingMetadata || {};
      const sources = (meta.groundingChunks || [])
        .map((c) => c.web && { title: c.web.title, url: c.web.uri })
        .filter(Boolean);
      // Google asks apps to show the search queries that grounded an answer
      const queries = (meta.webSearchQueries || []).slice(0, 3);
      const searchedFor = queries.length
        ? `\n\n_🔎 Searched Google for: ${queries.map((q) => `[${q}](https://www.google.com/search?q=${encodeURIComponent(q)})`).join(' · ')}_`
        : '';

      return { text: text + formatSources(sources) + searchedFor, sources, engine: 'gemini-grounding', provider: 'gemini', model: p.model };
    } catch (err) {
      keys.markFailed('gemini');
      console.warn('[search] gemini grounding error:', err.message);
    }
  }
  return null;
}

/* ───────────────────────── Public API ───────────────────────── */
async function webSearch(query, { system = '', history = [] } = {}) {
  const trimmedHistory = history.slice(-6).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 2000) }));
  return (
    (await tavilySearch(query, { system, history: trimmedHistory })) ||
    (await geminiGroundedSearch(query, { system, history: trimmedHistory })) ||
    null
  );
}

module.exports = { webSearch };
