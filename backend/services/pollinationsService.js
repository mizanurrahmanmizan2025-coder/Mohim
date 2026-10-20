/**
 * services/pollinationsService.js — image generation via Pollinations.ai
 *
 * CLEAN IMAGES (no logo / watermark)
 * Pollinations only removes its watermark for authenticated requests. The key must
 * stay secret, so with POLLINATIONS_API_KEY set we DON'T give the browser a
 * Pollinations URL. We give it a signed URL on our own server:
 *
 *     /api/images/render?p=<prompt>&w=1280&h=720&s=<seed>&m=flux&sig=<hmac>
 *
 * The server checks the signature (only URLs we generated work, so nobody can
 * burn your key), fetches the image from gen.pollinations.ai with
 * "Authorization: Bearer <key>" + nologo=true, and streams it back.
 * Bonus: images become same-origin, so the Download button always works.
 *
 * Without a key → legacy anonymous endpoint with nologo/private flags
 * (best effort; Pollinations may still brand anonymous images).
 *
 * Env:
 *   POLLINATIONS_API_KEY   sk_... from enter.pollinations.ai  (enables clean images)
 *   POLLINATIONS_MODEL     default "flux"
 *   POLLINATIONS_GEN_URL   default https://gen.pollinations.ai/image/
 *   POLLINATIONS_BASE_URL  legacy anonymous endpoint, default https://image.pollinations.ai/prompt/
 */
const crypto = require('crypto');

const API_KEY = (process.env.POLLINATIONS_API_KEY || '').trim();
const GEN_URL = process.env.POLLINATIONS_GEN_URL || 'https://gen.pollinations.ai/image/';
const LEGACY_URL = process.env.POLLINATIONS_BASE_URL || 'https://image.pollinations.ai/prompt/';
const DEFAULT_MODEL = process.env.POLLINATIONS_MODEL || 'flux';
const MAX_PROMPT = 1500;

const SIZES = {
  square: [1024, 1024],
  landscape: [1280, 720], // YouTube thumbnail 16:9
  portrait: [720, 1280],  // stories / reels 9:16
  wide: [1500, 500],      // banners 3:1
};

// Flags that strip branding and keep generations out of the public feed
const CLEAN_FLAGS = { nologo: 'true', private: 'true', safe: 'true', enhance: 'false' };

const secret = () => process.env.JWT_SECRET || 'dev-only-secret';
const sign = (p, w, h, s, m) =>
  crypto.createHmac('sha256', secret()).update(`${p}|${w}|${h}|${s}|${m}`).digest('base64url').slice(0, 32);

/** Builds the browser-facing URL for one image. */
function buildImageUrl(prompt, { size = 'landscape', model = DEFAULT_MODEL, seed } = {}) {
  const [w, h] = SIZES[size] || SIZES.landscape;
  const p = String(prompt).replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);
  const s = String(seed ?? Math.floor(Math.random() * 1e9));

  if (API_KEY) {
    const q = new URLSearchParams({ p, w: String(w), h: String(h), s, m: model, sig: sign(p, w, h, s, model) });
    // PUBLIC_API_URL only matters when the frontend lives on a different domain than the API
    const base = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
    return `${base}/api/images/render?${q.toString()}`;
  }

  const q = new URLSearchParams({ width: String(w), height: String(h), model, seed: s, ...CLEAN_FLAGS });
  return `${LEGACY_URL}${encodeURIComponent(p)}?${q.toString()}`;
}

function generateImages(prompt, { count = 2, ...opts } = {}) {
  const n = Math.max(1, Math.min(Number(count) || 1, 4));
  return Array.from({ length: n }, () => buildImageUrl(prompt, opts));
}

/** Validates a signed render request. Returns clean params or null. */
function verifyRenderRequest(query) {
  const p = String(query.p || '').slice(0, MAX_PROMPT);
  const w = Number(query.w);
  const h = Number(query.h);
  const s = String(query.s || '');
  const m = String(query.m || '');
  const sig = String(query.sig || '');
  if (!p || !w || !h || !s || !m || sig.length !== 32) return null;
  const expected = sign(p, w, h, s, m);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { p, w, h, s, m };
}

/** Fetches a clean image from Pollinations with the secret key. */
async function fetchCleanImage({ p, w, h, s, m }) {
  const q = new URLSearchParams({ model: m, width: String(w), height: String(h), seed: s, ...CLEAN_FLAGS });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000); // generation can take a while
  try {
    const res = await fetch(`${GEN_URL}${encodeURIComponent(p)}?${q.toString()}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Pollinations HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status === 429 ? 429 : 502;
      throw err;
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  } finally {
    clearTimeout(t);
  }
}

if (!API_KEY) {
  console.warn('[images] POLLINATIONS_API_KEY not set — using anonymous endpoint; images may carry a Pollinations logo.');
}

module.exports = { generateImages, buildImageUrl, verifyRenderRequest, fetchCleanImage, SIZES, hasKey: Boolean(API_KEY) };
