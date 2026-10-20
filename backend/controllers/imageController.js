const { generateImages, SIZES, verifyRenderRequest, fetchCleanImage } = require('../services/pollinationsService');
const { generate } = require('../services/fallbackService');
const { getMode } = require('../services/modes');

/** Rewrites a short idea (any language) into a rich English image prompt via the LLM cascade. */
async function enhancePrompt(idea) {
  try {
    const m = getMode('image');
    const out = await generate({
      system: `${m.system}\nAlways write the prompt in English, even if the idea is in another language.`,
      messages: [{ role: 'user', content: idea }],
      temperature: m.temperature,
      maxTokens: 600,
    });
    return out.text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return idea; // never block image generation because the LLM is busy
  }
}

exports.enhancePrompt = enhancePrompt;

// POST /api/images/generate  { prompt, size, count, enhance }
exports.generate = async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ message: 'Prompt is required' });
  const size = SIZES[req.body.size] ? req.body.size : 'landscape';
  const finalPrompt = req.body.enhance === false ? prompt : await enhancePrompt(prompt);
  const images = generateImages(finalPrompt, { size, count: req.body.count || 2 });
  res.json({ prompt: finalPrompt, images });
};

// GET /api/images/render?p=&w=&h=&s=&m=&sig=   (public: <img> tags can't send auth headers;
// the HMAC signature means only URLs our server generated are accepted)
exports.render = async (req, res) => {
  const params = verifyRenderRequest(req.query);
  if (!params) return res.status(403).json({ message: 'Invalid image link' });
  try {
    const { buffer, contentType } = await fetchCleanImage(params);
    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      // same URL = same seed = same image, so browsers/CDNs can cache it forever
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline; filename="ai-image.jpg"',
      'Cross-Origin-Resource-Policy': 'cross-origin', // allow display when frontend is on another domain
    });
    res.send(buffer);
  } catch (err) {
    console.warn('[images] render failed:', err.message);
    res.status(err.status || 502).json({ message: 'Image generation failed, please try again' });
  }
};
