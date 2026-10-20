/**
 * services/intentRouter.js — automatic intent detection for the main Chat mode.
 *
 * Two stages:
 *   1. Rules (instant, free): attachments, URLs, code fences/stack traces, and
 *      clear phrases like "generate an image of…" / "ছবি বানাও" / "latest news".
 *   2. AI classifier (only when stage 1 is unsure): a tiny JSON-only call through
 *      the normal key-rotation + fallback engine, with a short timeout.
 *      If it fails or times out we use the best rule guess, never an error.
 *
 * Returns: { intent, confidence, source, imagePrompt?, imageSize?, imageCount?, searchQuery? }
 *   intent ∈ general | code | image | document | url | search | writer
 *
 * Env:
 *   ROUTER_MODE        hybrid (default) | rules | llm   — "llm" classifies every message
 *   ROUTER_TIMEOUT_MS  max wait for the classifier (default 7000)
 */
const { generate } = require('./fallbackService');
const { extractUrls } = require('./webScraperService');

const MODE = (process.env.ROUTER_MODE || 'hybrid').toLowerCase();
const TIMEOUT = Number(process.env.ROUTER_TIMEOUT_MS || 7000);
const INTENTS = ['general', 'code', 'image', 'search', 'writer'];

/* ───────────────────────── Rule patterns (EN + বাংলা + Banglish) ───────────────────────── */
const P = {
  // image generation
  imgVerb: /\b(generate|create|make|draw|design|paint|render|produce|imagine|illustrate|sketch|give me|show me)\b|বানাও|বানিয়ে|তৈরি কর|আঁক|একে দাও|\b(banao|baniye|banai|eke dao|aiko|toiri koro)\b/i,
  imgNoun: /\b(image|images|picture|pictures|photo|photos|pic|pics|illustration|drawing|logo|thumbnail|poster|banner|wallpaper|artwork|art|icon|avatar|sketch|painting|portrait|mockup|cover art|sticker)\b|ছবি|ইমেজ|লোগো|থাম্বনেইল|পোস্টার|ব্যানার|\b(chobi|chhobi|chobi ta|logo ta)\b/i,
  imgDirect: /^(an? )?(image|picture|photo|drawing|illustration|logo|thumbnail|poster) of\b/i,
  imgEditFollowUp: /\b(make it|change (it|the)|more|less|darker|brighter|again|another (one|version)|different (style|color)|add (a|an|some)|remove the|in (anime|cartoon|realistic|3d|pixel) style)\b|আরেকটা|আবার|বদলাও|\b(arekta|abar|change koro)\b/i,
  howTo: /\b(how (do|can|to|should)|tutorial|explain|what is|why)\b|কিভাবে|কীভাবে|\b(kivabe|kibhabe)\b/i,

  // code
  codeFence: /```/,
  stackTrace: /\b(Traceback \(most recent call last\)|TypeError|ReferenceError|SyntaxError|NullPointerException|Uncaught|Segmentation fault|ModuleNotFoundError|ENOENT|npm ERR!|error TS\d+|at [\w.<>]+ \(.+:\d+:\d+\))/,
  codeAction: /\b(write|build|create|fix|debug|refactor|optimi[sz]e|convert|implement|review|explain)\b[^.?!\n]{0,40}\b(code|function|script|program|component|class|api|endpoint|query|regex|algorithm|bug|error|app|website|backend|frontend|cli|bot)\b/i,
  codeLang: /\b(javascript|typescript|python|java|c\+\+|c#|golang|rust|php|ruby|kotlin|swift|react|next\.?js|node\.?js|express|django|flask|laravel|sql|mongodb|html|css|tailwind|bash|docker|git)\b/i,

  // web search / research
  searchExplicit: /\b(search (the )?(web|internet|online|google)|google (it|this|for)|look (it )?up|browse|research|find (me )?(sources|articles|links|news))\b|খুঁজে দেখ|সার্চ কর|\b(search koro|khuje dekho)\b/i,
  timeSensitive: /\b(latest|today|tonight|yesterday|this (week|month|year)|right now|currently|current|recent(ly)?|breaking|news|update[sd]?|live|score|stock price|price of|exchange rate|release date|who won|election|trending|20(2[5-9]|3\d))\b|আজকে|আজ|সর্বশেষ|খবর|বর্তমান|\b(ajke|latest news)\b/i,

  // content writing
  writerAction: /\b(write|draft|compose|create|generate|give me)\b[^.?!\n]{0,40}\b(blog|article|post|caption|captions|tweet|thread|newsletter|essay|email|cover letter|ad copy|product description|seo|landing page copy|youtube script|video script|linkedin|instagram|facebook|story|poem|speech|press release)\b/i,
  writerBn: /(ব্লগ|আর্টিকেল|ক্যাপশন|পোস্ট|প্রবন্ধ|রচনা|ইমেইল).{0,20}(লিখ|লেখ)|\b(likhe dao|likho)\b/i,
};

const CODE_EXT = /\.(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|sql|sh|json|ya?ml|xml|kt|swift|rs|vue|dart)$/i;

/* ───────────────────────── Helpers ───────────────────────── */
function detectImageSize(text) {
  const t = text.toLowerCase();
  if (/(story|reel|tiktok|shorts|portrait|vertical|phone wallpaper|9:16)/.test(t)) return 'portrait';
  if (/(banner|cover photo|header|twitter header|linkedin banner|3:1)/.test(t)) return 'wide';
  if (/(logo|icon|avatar|profile pic|instagram post|square|sticker|1:1)/.test(t)) return 'square';
  return 'landscape'; // thumbnails, scenes, wallpapers (16:9)
}

function detectImageCount(text) {
  const m = text.match(/\b([1-4]|one|two|three|four)\s+(images|pictures|photos|variations|versions|options|logos|thumbnails)\b/i);
  if (!m) return 2;
  const words = { one: 1, two: 2, three: 3, four: 4 };
  return Number(words[m[1].toLowerCase()] || m[1]);
}

function lastAssistant(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) if (history[i].role === 'assistant') return history[i];
  return null;
}

const wrap = (intent, confidence, source, extra = {}) => ({ intent, confidence, source, ...extra });

/* ───────────────────────── Stage 1: rules ───────────────────────── */
function ruleRoute(message, files = [], history = []) {
  const text = message || '';

  // attachments decide first
  if (files.length) {
    const visual = files.some((f) => f.mimetype?.startsWith('image/') || f.mimetype === 'application/pdf');
    if (visual) return wrap('document', 'high', 'rules:file');
    if (files.every((f) => CODE_EXT.test(f.originalname || ''))) return wrap('code', 'high', 'rules:code-file');
    return wrap('document', 'high', 'rules:file');
  }

  if (extractUrls(text).length && !P.codeFence.test(text)) return wrap('url', 'high', 'rules:url');

  if (P.codeFence.test(text) || P.stackTrace.test(text)) return wrap('code', 'high', 'rules:code');

  const isHowTo = P.howTo.test(text);
  const imgVerb = P.imgVerb.test(text);
  const imgNoun = P.imgNoun.test(text);
  if (!isHowTo && ((imgVerb && imgNoun) || P.imgDirect.test(text))) {
    return wrap('image', 'high', 'rules:image', { imageSize: detectImageSize(text), imageCount: detectImageCount(text) });
  }

  if (P.searchExplicit.test(text)) return wrap('search', 'high', 'rules:search', { searchQuery: text });
  if (P.writerAction.test(text) || P.writerBn.test(text)) return wrap('writer', 'high', 'rules:writer');
  if (P.codeAction.test(text)) return wrap('code', 'high', 'rules:code');

  // ── weaker signals → ask the classifier ──
  const prev = lastAssistant(history);
  if (prev?.routedMode === 'image' && P.imgEditFollowUp.test(text) && text.length < 200) {
    return wrap('image', 'medium', 'rules:image-followup', { imageSize: detectImageSize(text), imageCount: detectImageCount(text) });
  }
  if (imgNoun && imgVerb) return wrap('general', 'medium', 'rules:image-howto'); // "how do I make a logo?" → explain, unless classifier says otherwise
  if (P.timeSensitive.test(text)) return wrap('search', 'medium', 'rules:time', { searchQuery: text });
  if (P.codeLang.test(text)) return wrap('code', 'medium', 'rules:lang');
  if (imgNoun) return wrap('general', 'medium', 'rules:image-noun');

  return wrap('general', 'high', 'rules:default');
}

/* ───────────────────────── Stage 2: AI classifier ───────────────────────── */
const CLASSIFIER_SYSTEM = `You are an intent router for an AI assistant. Read the latest user message (and recent context) and choose ONE intent:
- "image": the user wants a NEW picture generated or an existing generated picture changed (logo, thumbnail, illustration, photo, poster, art).
- "code": writing, fixing, explaining or reviewing software code, commands, configs or technical errors.
- "search": needs fresh or factual information from the live web (news, current events, prices, recent releases, "latest", anything after 2024, or the user asks to research/search).
- "writer": long-form or marketing content (blog post, article, captions, emails, scripts, SEO copy).
- "general": everything else (chat, advice, explanations, math, how-to questions — including "how do I create an image in Photoshop").
Reply with ONLY minified JSON, no markdown:
{"intent":"...","image_prompt":"<if image: a detailed English visual prompt, merging changes with the previous image prompt if it is a follow-up; else empty>","image_size":"landscape|square|portrait|wide","image_count":1-4,"search_query":"<if search: a concise English web search query; else empty>"}`;

function parseJson(text) {
  const m = (text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function llmRoute(message, history) {
  const context = history
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 400)}`)
    .join('\n');
  const userText = `${context ? `Recent conversation:\n${context}\n\n` : ''}Latest user message:\n${message.slice(0, 2000)}`;

  const call = generate({
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: 'user', content: userText }],
    temperature: 0,
    maxTokens: 700, // reasoning models spend part of this budget thinking
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('router timeout')), TIMEOUT));
  const out = await Promise.race([call, timeout]);
  const j = parseJson(out.text);
  if (!j || !INTENTS.includes(j.intent)) throw new Error('bad classifier output');

  return wrap(j.intent, 'high', `llm:${out.provider}`, {
    imagePrompt: j.image_prompt || undefined,
    imageSize: ['landscape', 'square', 'portrait', 'wide'].includes(j.image_size) ? j.image_size : detectImageSize(message),
    imageCount: Math.min(Math.max(Number(j.image_count) || 2, 1), 4),
    searchQuery: j.search_query || message,
  });
}

/* ───────────────────────── Public API ───────────────────────── */
async function routeIntent({ message = '', files = [], history = [] }) {
  const rule = ruleRoute(message, files, history);

  // files and URLs are unambiguous — never spend a classifier call on them
  const hardRule = ['rules:file', 'rules:code-file', 'rules:url'].includes(rule.source);
  const useLLM = MODE === 'llm' ? !hardRule && message.trim() : MODE === 'hybrid' && rule.confidence !== 'high';
  if (!useLLM || MODE === 'rules') return rule;

  try {
    return await llmRoute(message, history);
  } catch (err) {
    console.warn(`[router] classifier unavailable (${err.message}) — using rule guess "${rule.intent}"`);
    return { ...rule, source: `${rule.source}+fallback` };
  }
}

module.exports = { routeIntent, ruleRoute, detectImageSize, detectImageCount };
