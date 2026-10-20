/**
 * services/imageService.js — image generation through CHAIN_IMAGE with live progress.
 *
 * Default chain:  Gemini Nano Banana 2 (up to 4K) → Nano Banana 2 Lite → Cloudflare FLUX
 *                 → Hugging Face FLUX → Pollinations (keyless last resort)
 *
 * generateImages({ prompt, size, quality, count, userId, onEvent, signal })
 *   size:    square | landscape | portrait | wide
 *   quality: standard (1K) | hd (2K) | 4k (4K, Gemini only)
 *   onEvent: { type:'image_progress', index, percent, label, provider }
 *            { type:'image', index, url, provider, model, width, height }
 *            { type:'fallback', index, fromLabel, toLabel, reason }
 * Percentages are estimates — providers don't report real progress — but every
 * stage label (provider switch, saving, …) is a real event.
 */
const crypto = require('crypto');
const { providers, chainFor, PROVIDER_LABEL, labelOf } = require('../config/apiKeys');
const keys = require('./keyRotationService');
const GeneratedImage = require('../models/GeneratedImage');
const pollinations = require('./pollinationsService');

const TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 90000);
const KEYS_PER_PROVIDER = Number(process.env.KEYS_PER_PROVIDER || 2);

const SIZE_SPECS = {
  square: { aspect: '1:1', w: 1024, h: 1024 },
  landscape: { aspect: '16:9', w: 1344, h: 768 },
  portrait: { aspect: '9:16', w: 768, h: 1344 },
  wide: { aspect: '21:9', w: 1536, h: 640 },
};
const GEMINI_SIZE = { standard: '1K', hd: '2K', '4k': '4K' };
const RES_LABEL = { standard: '1K', hd: '2K HD', '4k': '4K' };

class ImgError extends Error {
  constructor(message, status = 0, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

/* ───────────────────────── helpers ───────────────────────── */
async function post(url, { headers, body, signal }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    throw new ImgError(signal?.aborted ? 'aborted' : ctrl.signal.aborted ? 'timeout' : err.message, signal?.aborted ? 499 : 0);
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function errorFrom(res) {
  const text = await res.text().catch(() => '');
  let msg = text;
  try { msg = JSON.parse(text)?.error?.message || JSON.parse(text)?.errors?.[0]?.message || text; } catch { /* not json */ }
  return new ImgError(`HTTP ${res.status}: ${String(msg).slice(0, 200)}`, res.status, Number(res.headers.get('retry-after')) || undefined);
}

/** Finds the first base64 image anywhere in a JSON response (works for every Gemini API shape). */
function findImage(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  const mime = obj.mimeType || obj.mime_type;
  if (typeof obj.data === 'string' && obj.data.length > 500 && (!mime || /^image\//.test(mime))) {
    return { buffer: Buffer.from(obj.data, 'base64'), mimeType: mime || 'image/png' };
  }
  if (typeof obj.image === 'string' && obj.image.length > 500) return { buffer: Buffer.from(obj.image, 'base64'), mimeType: 'image/png' };
  for (const v of Object.values(obj)) {
    const found = findImage(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function save({ buffer, mimeType }, meta) {
  const key = crypto.randomBytes(18).toString('base64url');
  await GeneratedImage.create({ key, data: buffer, mimeType, ...meta });
  const base = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  return `${base}/api/images/file/${key}`;
}

/* ───────────────────────── providers ───────────────────────── */
async function geminiImage({ model, key, prompt, spec, quality, signal }) {
  const base = providers.gemini.baseUrl;
  const imageSize = /lite/.test(model) ? '1K' : GEMINI_SIZE[quality] || '1K';
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  // 1) generateContent with explicit aspect ratio + resolution
  let res = await post(`${base}/${encodeURIComponent(model)}:generateContent`, {
    headers, signal,
    body: { contents, generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: spec.aspect, imageSize } } },
  });
  // 2) older field set rejected → retry without imageConfig
  if (res.status === 400) {
    res = await post(`${base}/${encodeURIComponent(model)}:generateContent`, {
      headers, signal, body: { contents, generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
    });
  }
  // 3) model only served by the newer Interactions API
  if (res.status === 400 || res.status === 404) {
    res = await post(base.replace(/\/models$/, '/interactions'), {
      headers, signal,
      body: { model, input: prompt, response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: spec.aspect, image_size: imageSize } },
    });
  }
  if (!res.ok) throw await errorFrom(res);
  const img = findImage(await res.json());
  if (!img) throw new ImgError('no image returned (prompt may have been blocked)', 502);
  return img;
}

async function cloudflareImage({ model, key, prompt, quality, signal }) {
  const [account, token] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const res = await post(`${providers.cloudflare.baseUrl}/${account}/ai/run/${model}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: { prompt: prompt.slice(0, 2048), steps: quality === 'standard' ? 4 : 8, seed: Math.floor(Math.random() * 1e9) },
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  if ((res.headers.get('content-type') || '').startsWith('image/')) {
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') };
  }
  const img = findImage(await res.json());
  if (!img) throw new ImgError('no image returned', 502);
  return { ...img, mimeType: 'image/jpeg' };
}

async function huggingfaceImage({ model, key, prompt, spec, signal }) {
  const res = await post(`${providers.huggingface.baseUrl}/${model}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Accept: 'image/png' },
    body: { inputs: prompt, parameters: { width: spec.w, height: spec.h } },
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) {
    const img = findImage(await res.json().catch(() => null));
    if (!img) throw new ImgError('no image returned', 502);
    return img;
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: type };
}

const HANDLERS = { gemini: geminiImage, cloudflare: cloudflareImage, huggingface: huggingfaceImage };

/* ───────────────────────── progress ticker ───────────────────────── */
function ticker(index, emit) {
  let pct = 0;
  let provider = '';
  let fixedLabel = '';
  const stageLabel = (p) => (p < 30 ? 'Preparing canvas' : p < 50 ? 'Rendering composition' : p < 68 ? 'Adding details & lighting' : p < 84 ? 'Refining textures' : 'Finishing up');
  const send = () => emit({ type: 'image_progress', index, percent: Math.round(pct), label: fixedLabel || stageLabel(pct), provider });
  const timer = setInterval(() => {
    if (pct >= 90) return;
    pct = Math.min(90, pct + Math.max(0.7, (90 - pct) * 0.05));
    fixedLabel = '';
    send();
  }, 900);
  return {
    set(p, label, prov) { pct = p; fixedLabel = label || ''; if (prov) provider = prov; send(); },
    stop() { clearInterval(timer); },
  };
}

/* ───────────────────────── one image through the chain ───────────────────────── */
async function generateOne({ index, prompt, spec, quality, userId, emit, signal }) {
  const chain = chainFor('image');
  const t = ticker(index, emit);
  t.set(3, 'Preparing canvas');

  try {
    for (let c = 0; c < chain.length; c += 1) {
      const { provider, model } = chain[c];
      const label = labelOf(provider, model);
      // next entry that still has a usable key (checked after cooldowns are applied)
      const nextLabelNow = () => {
        const next = chain.slice(c + 1).find((e) => e.provider === 'pollinations' || keys.nextKeyAvailable(e.provider));
        return next && labelOf(next.provider, next.model);
      };

      if (provider === 'pollinations') {
        const hd = quality === 'standard' ? 1 : 1.5;
        const width = Math.min(2048, Math.round((spec.w * hd) / 16) * 16);
        const height = Math.min(2048, Math.round((spec.h * hd) / 16) * 16);
        const url = pollinations.buildImageUrl(prompt, { model, width, height });
        t.set(92, 'Rendering on Pollinations…', label);
        return { url, provider, model, width, height, pending: true };
      }

      const handler = HANDLERS[provider];
      if (!handler) continue;
      const tried = new Set();
      let skip = false;

      for (let attempt = 0; attempt < Math.min(KEYS_PER_PROVIDER, providers[provider].keys.length) && !skip; attempt += 1) {
        const key = keys.nextKey(provider, tried);
        if (!key) break;
        tried.add(key);
        const res = provider === 'gemini' ? (/lite/.test(model) ? '1K' : RES_LABEL[quality] || '1K') : `${spec.w}×${spec.h}`;
        t.set(Math.max(12, Math.min(25, 12 + c * 4)), `Sending to ${label} · ${provider === 'cloudflare' ? '1024px' : res}`, label);

        try {
          const img = await handler({ model, key, prompt, spec, quality, signal });
          keys.markSuccess(provider);
          t.set(95, 'Saving image', label);
          const url = await save(img, { user: userId, prompt, provider, model, width: spec.w, height: spec.h });
          return { url, provider, model, width: spec.w, height: spec.h };
        } catch (err) {
          if (signal?.aborted || err.status === 499) throw Object.assign(new Error('Request cancelled'), { status: 499, aborted: true });
          console.warn(`[image] ${provider}/${model} failed: ${err.message}`);
          if (err.status === 429) keys.markRateLimited(provider, key, err.retryAfter);
          else if (err.status === 401 || err.status === 403) keys.markInvalid(provider, key);
          else keys.markFailed(provider);
          if ([400, 402, 404].includes(err.status)) skip = true;

          const reason = err.status === 429 ? 'limit reached' : err.status === 402 || err.status === 403 ? 'not available on this key' : 'failed';
          const more = attempt + 1 < Math.min(KEYS_PER_PROVIDER, providers[provider].keys.length) && !skip;
          const toLabel = more ? `${label} (another key)` : nextLabelNow();
          emit({ type: 'fallback', index, fromLabel: label, toLabel, reason });
          t.set(18, toLabel ? `${label} ${reason} — switching to ${toLabel}` : `${label} ${reason}`, label);
        }
      }
    }
    throw Object.assign(new Error('All image providers are unavailable right now. Please try again later.'), { status: 503 });
  } finally {
    t.stop();
  }
}

/* ───────────────────────── public ───────────────────────── */
async function generateImages({ prompt, size = 'landscape', quality = 'standard', count = 1, userId, onEvent, signal }) {
  const emit = onEvent || (() => {});
  const spec = SIZE_SPECS[size] || SIZE_SPECS.landscape;
  const n = Math.max(1, Math.min(Number(count) || 1, 4));

  const results = await Promise.allSettled(
    Array.from({ length: n }, (_, index) =>
      generateOne({ index, prompt, spec, quality, userId, emit, signal }).then((r) => {
        emit({ type: 'image_progress', index, percent: r.pending ? 92 : 100, label: r.pending ? 'Rendering on Pollinations…' : 'Done', provider: labelOf(r.provider, r.model) });
        emit({ type: 'image', index, ...r });
        return r;
      })
    )
  );

  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    const first = results.find((r) => r.status === 'rejected')?.reason;
    throw first || new Error('Image generation failed');
  }
  results.forEach((r, index) => {
    if (r.status === 'rejected' && !r.reason?.aborted) emit({ type: 'image_progress', index, percent: 0, label: 'Failed', error: true });
  });
  return ok;
}

module.exports = { generateImages, SIZE_SPECS };
