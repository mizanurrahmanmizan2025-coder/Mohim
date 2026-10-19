/**
 * Keyless image generation via Pollinations.ai.
 * The image is rendered by Pollinations when the browser loads the URL,
 * so we only build (and return) the URL — no bytes pass through our server.
 */
const BASE = process.env.POLLINATIONS_BASE_URL || 'https://image.pollinations.ai/prompt/';
const DEFAULT_MODEL = process.env.POLLINATIONS_MODEL || 'flux';

const SIZES = {
  square: [1024, 1024],
  landscape: [1280, 720], // YouTube thumbnail 16:9
  portrait: [720, 1280],
  wide: [1500, 500],
};

function buildImageUrl(prompt, { size = 'landscape', model = DEFAULT_MODEL, seed, enhance = true } = {}) {
  const [width, height] = SIZES[size] || SIZES.landscape;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    seed: String(seed ?? Math.floor(Math.random() * 1e9)),
    nologo: 'true',
    enhance: String(enhance),
  });
  return `${BASE}${encodeURIComponent(prompt.slice(0, 1500))}?${params.toString()}`;
}

function generateImages(prompt, { count = 2, ...opts } = {}) {
  const n = Math.max(1, Math.min(Number(count) || 1, 4));
  return Array.from({ length: n }, () => buildImageUrl(prompt, opts));
}

module.exports = { generateImages, buildImageUrl, SIZES };
