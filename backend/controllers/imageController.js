const { generateImages, SIZES } = require('../services/pollinationsService');
const { generate } = require('../services/fallbackService');
const { getMode } = require('../services/modes');

/** Optionally rewrites a short idea into a rich image prompt via the LLM cascade. */
async function enhancePrompt(idea) {
  try {
    const m = getMode('image');
    const out = await generate({ system: m.system, messages: [{ role: 'user', content: idea }], temperature: m.temperature, maxTokens: 300 });
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
