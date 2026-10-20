const { verifyRenderRequest, fetchCleanImage } = require('../services/pollinationsService');
const { generateImages, SIZE_SPECS } = require('../services/imageService');
const { generate } = require('../services/fallbackService');
const { getMode } = require('../services/modes');
const GeneratedImage = require('../models/GeneratedImage');

/** Rewrites a short idea (any language) into a rich English image prompt — uses CHAIN_TEXT. */
async function enhancePrompt(idea, { signal, onEvent } = {}) {
  try {
    const m = getMode('image');
    const out = await generate({
      feature: 'text',
      system: `${m.system}\nAlways write the prompt in English, even if the idea is in another language.`,
      messages: [{ role: 'user', content: idea }],
      temperature: m.temperature,
      maxTokens: 800,
      signal,
      onEvent,
    });
    return out.text.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    if (err.aborted) throw err;
    return idea; // never block image generation because the text chain is busy
  }
}
exports.enhancePrompt = enhancePrompt;

// POST /api/images/generate  { prompt, size, quality, count, enhance }   (non-streaming API)
exports.generate = async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ message: 'Prompt is required' });
  const size = SIZE_SPECS[req.body.size] ? req.body.size : 'landscape';
  const quality = ['standard', 'hd', '4k'].includes(req.body.quality) ? req.body.quality : 'standard';
  const finalPrompt = req.body.enhance === false ? prompt : await enhancePrompt(prompt);
  const images = await generateImages({ prompt: finalPrompt, size, quality, count: req.body.count || 1, userId: req.user._id });
  res.json({ prompt: finalPrompt, images: images.map((i) => i.url), details: images });
};

// GET /api/images/file/:key   — stored images (public: <img> can't send auth headers; key is random)
exports.file = async (req, res) => {
  const key = String(req.params.key || '');
  if (!/^[\w-]{20,40}$/.test(key)) return res.status(404).end();
  const img = await GeneratedImage.findOne({ key }).select('data mimeType').lean();
  if (!img) return res.status(404).json({ message: 'Image not found or expired' });
  res.set({
    'Content-Type': img.mimeType || 'image/png',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Disposition': 'inline; filename="ai-image.png"',
  });
  res.send(Buffer.from(img.data.buffer || img.data));
};

// GET /api/images/render?...&sig=   — Pollinations proxy (clean images with POLLINATIONS_API_KEY)
exports.render = async (req, res) => {
  const params = verifyRenderRequest(req.query);
  if (!params) return res.status(403).json({ message: 'Invalid image link' });
  try {
    const { buffer, contentType } = await fetchCleanImage(params);
    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline; filename="ai-image.jpg"',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(buffer);
  } catch (err) {
    console.warn('[images] render failed:', err.message);
    res.status(err.status || 502).json({ message: 'Image generation failed, please try again' });
  }
};
