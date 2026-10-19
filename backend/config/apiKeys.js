/**
 * Reads provider key pools + model names from environment variables.
 * Keys are comma-separated: GROQ_API_KEYS=key1,key2,key3
 */
const parseKeys = (v) =>
  (v || '')
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

const providers = {
  groq: {
    name: 'groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    keys: parseKeys(process.env.GROQ_API_KEYS),
  },
  gemini: {
    name: 'gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    visionModel: process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash',
    keys: parseKeys(process.env.GEMINI_API_KEYS),
  },
  openrouter: {
    name: 'openrouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.OPENROUTER_MODEL || 'qwen/qwen3-coder:free',
    keys: parseKeys(process.env.OPENROUTER_API_KEYS),
    extraHeaders: {
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost',
      'X-Title': 'Custom AI Suite',
    },
  },
  mistral: {
    name: 'mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    keys: parseKeys(process.env.MISTRAL_API_KEYS),
  },
};

const providerOrder = (process.env.PROVIDER_ORDER || 'groq,gemini,openrouter,mistral')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p) => providers[p]);

module.exports = { providers, providerOrder };
