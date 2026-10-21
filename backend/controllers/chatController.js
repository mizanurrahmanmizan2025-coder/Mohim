/**
 * controllers/chatController.js — live, step-by-step chat pipeline.
 *
 * POST /api/chat/stream  (multipart) → Server-Sent Events:
 *   meta          { chatId, title, mode }
 *   step          { id, label, status: active|done|warn|error, detail? }   progress log
 *   route         { mode, label }                                         which tool was picked
 *   thinking      { text }                                                reasoning tokens
 *   delta         { text }                                                answer tokens
 *   reset         {}                                                      provider switched mid-answer
 *   image_plan    { count, size, aspect, quality, prompt }
 *   image_progress{ index, percent, label, provider }
 *   image         { index, url, provider, model, width, height, pending? }
 *   done          { chatId, title, routedMode, message }
 *   error         { message, code? }
 *
 * POST /api/chat/send runs the same pipeline without streaming (returns JSON).
 * Chains: code → CHAIN_CODE, files with images → CHAIN_VISION, images → CHAIN_IMAGE,
 *         everything else (chat, writing, search answers, router, prompts) → CHAIN_TEXT.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const PromptTemplate = require('../models/PromptTemplate');
const { stream } = require('../services/fallbackService');
const { getMode, modes } = require('../services/modes');
const { processFiles } = require('../services/documentService');
const { scrape, extractUrls } = require('../services/webScraperService');
const { generateImages, SIZE_SPECS } = require('../services/imageService');
const { routeIntent, detectImageSize, detectImageCount, detectImageQuality } = require('../services/intentRouter');
const { webSearch } = require('../services/webSearchService');
const { PROVIDER_LABEL, labelOf } = require('../config/apiKeys');
const { enhancePrompt } = require('./imageController');

const HISTORY_TURNS = 20;
const validId = (id) => mongoose.isValidObjectId(id);
const makeTitle = (s) => (s || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const MODE_LABEL = {
  general: 'Chat', code: 'Code Expert', image: 'Image Generator', document: 'Document Analyzer',
  url: 'Web Analyzer', search: 'Web Search', writer: 'Content Writer',
};
const GENERATE_LABEL = {
  general: 'Writing the answer', code: 'Generating code', document: 'Analyzing your file',
  url: 'Analyzing the page', writer: 'Writing the content', search: 'Writing the answer',
};
const RES_LABEL = { standard: '1K', hd: '2K HD', '4k': '4K' };

/* ───────────────────────── progress helpers ───────────────────────── */
function tracker(ctx, emit) {
  return (id, label, status = 'active', detail) => {
    let s = ctx.steps.find((x) => x.id === id);
    if (!s) {
      s = { id, label, status, ...(detail !== undefined && { detail }) };
      ctx.steps.push(s);
    } else {
      if (label) s.label = label;
      s.status = status;
      if (detail !== undefined) s.detail = detail;
    }
    emit('step', { ...s });
  };
}

/** Converts fallbackService / webSearch events into SSE events + step updates. */
function adapter(ctx, emit, step, stepId) {
  let n = 0;
  return (ev) => {
    switch (ev.type) {
      case 'attempt':
        step(stepId, undefined, 'active', `${ev.label} · ${ev.model}${ev.won ? ' (fastest)' : ''}`);
        break;
      case 'thinking':
        emit('thinking', { text: ev.text });
        break;
      case 'delta':
        ctx.text += ev.text;
        emit('delta', { text: ev.text });
        break;
      case 'reset':
        ctx.text = '';
        emit('reset', {});
        break;
      case 'fallback':
        n += 1;
        step(`${stepId}-fb${n}`, ev.toLabel ? `${ev.fromLabel}: ${ev.reason} → switching to ${ev.toLabel}` : `${ev.fromLabel}: ${ev.reason}`, 'warn');
        break;
      case 'hedge':
        n += 1;
        step(`${stepId}-hedge${n}`, ev.label, 'warn');
        break;
      case 'waiting':
        n += 1;
        step(`${stepId}-wait${n}`, ev.label, 'warn');
        break;
      case 'search_status':
        step(stepId, ev.label, 'active');
        break;
      default:
    }
  };
}

/* ───────────────────────── the pipeline ───────────────────────── */
async function runPipeline({ req, chat, message, selectedMode, files, emit, signal, ctx, regen }) {
  const step = tracker(ctx, emit);
  const history = chat.messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content || '', routedMode: m.routedMode }));
  const llmHistory = history.map(({ role, content }) => ({ role, content }));

  // file parsing starts immediately and runs while the router decides (saves a round-trip)
  const filesPromise = files.length ? processFiles(files) : null;
  filesPromise?.catch(() => {}); // error surfaces below when awaited

  /* 1. understand */
  step('understand', regen ? 'Regenerating the response' : 'Understanding your request');
  let route = null;
  let target = selectedMode;
  const prevTool = regen?.previous?.routedMode;
  if (prevTool && (modes[prevTool] || prevTool === 'search')) {
    target = prevTool; // regenerate with the same tool as the original answer
  } else if (selectedMode === 'general') {
    route = await routeIntent({ message, files, history });
    target = route.intent;
    console.log(`[router] "${message.slice(0, 60)}" → ${target} (${route.source})`);
  }
  if (files.length && (target === 'image' || target === 'search')) target = 'document';
  ctx.target = target;
  step('understand', regen ? 'Regenerating the response' : 'Understanding your request', 'done', `→ ${MODE_LABEL[target]}`);
  emit('route', { mode: target, label: MODE_LABEL[target] });

  /* 2. files */
  let doc = { text: '', images: [], meta: [] };
  if (files.length) {
    step('files', `Reading ${files.length} attached file${files.length > 1 ? 's' : ''}`);
    doc = await filesPromise;
    step('files', undefined, 'done', doc.meta.map((m) => m.name).join(', '));
    ctx.fileText = doc.text.slice(0, 60000); // kept so the answer can be regenerated later
  } else if (regen?.user?.attachments?.length) {
    // regenerate: reuse the text extracted from the original files (images can't be re-sent)
    doc = { text: regen.user.fileText || '', images: [], meta: regen.user.attachments };
    const hadVisual = regen.user.attachments.some((a) => /^image\//.test(a.mimeType || '') || a.mimeType === 'application/pdf');
    if (hadVisual && !doc.text) doc.text = '[The original attached image/scan is not available when regenerating — answer from the conversation.]';
    step('files', 'Reusing the attached file content', 'done', regen.user.attachments.map((a) => a.name).join(', '));
  }
  ctx.attachments = doc.meta;

  /* 3a. image generation */
  if (target === 'image') {
    let prompt = route?.imagePrompt;
    if (!prompt) {
      step('prompt', 'Writing a detailed image prompt');
      prompt = await enhancePrompt(message, { signal });
      step('prompt', undefined, 'done', prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt);
    }
    const size = SIZE_SPECS[req.body.imageSize] ? req.body.imageSize : route?.imageSize || detectImageSize(message);
    const quality = ['hd', '4k'].includes(req.body.imageQuality) ? req.body.imageQuality : route?.imageQuality || detectImageQuality(message);
    const count = Math.min(Math.max(Number(req.body.imageCount) || route?.imageCount || detectImageCount(message), 1), 4);
    const { aspect } = SIZE_SPECS[size];

    const intro = `**Prompt used:**\n\n> ${prompt}\n`;
    ctx.text = intro;
    emit('delta', { text: intro });
    emit('image_plan', { count, size, aspect, quality, prompt });
    step('render', `Generating ${count} image${count > 1 ? 's' : ''} · ${aspect} · ${RES_LABEL[quality]}`);

    let fb = 0;
    const imgs = await generateImages({
      prompt, size, quality, count, userId: req.user._id, signal,
      onEvent: (ev) => {
        if (ev.type === 'image_progress') emit('image_progress', ev);
        else if (ev.type === 'image') { ctx.images[ev.index] = ev.url; emit('image', ev); }
        else if (ev.type === 'fallback') {
          fb += 1;
          step(`render-fb${fb}`, `Image ${ev.index + 1}: ${ev.fromLabel} ${ev.reason}${ev.toLabel ? ` → trying ${ev.toLabel}` : ''}`, 'warn');
        }
      },
    });
    const used = [...new Set(imgs.map((i) => labelOf(i.provider, i.model)))].join(', ');
    step('render', undefined, 'done', `${imgs.length}/${count} ready · ${used}`);
    return { content: intro, images: imgs.map((i) => i.url), provider: imgs[0].provider, model: imgs[0].model };
  }

  /* 3b. web research */
  if (target === 'search') {
    step('search', 'Searching the web');
    const system = `${getMode('general').system}\nYou answer questions using live web search results. Be accurate, structured and concise.`;
    const res = await webSearch(route?.searchQuery || message, { system, history: llmHistory, signal, onEvent: adapter(ctx, emit, step, 'search') });
    if (res) {
      step('search', 'Researched the web', 'done', `${res.sources.length} source${res.sources.length === 1 ? '' : 's'} · ${PROVIDER_LABEL[res.provider]}`);
      return { content: res.text, provider: res.provider, model: res.model };
    }
    step('search', 'Live search unavailable — answering from knowledge', 'warn');
    step('generate', GENERATE_LABEL.general);
    const out = await stream({
      feature: 'text',
      system: `${getMode('general').system}\nLive web search is unavailable. Answer from your knowledge and say clearly it may be out of date.`,
      messages: [...llmHistory, { role: 'user', content: message }],
      signal,
    }, adapter(ctx, emit, step, 'generate'));
    step('generate', undefined, 'done', `${PROVIDER_LABEL[out.provider]} · ${out.model}`);
    return { content: out.text, provider: out.provider, model: out.model };
  }

  /* 3c. text / code / document / url / writer */
  const mode = getMode(target);
  let context = doc.text ? `\n\nThe user attached these files:\n${doc.text}` : '';
  const urls = extractUrls(message);
  urls.forEach((u, i) => step(`url${i}`, `Reading ${hostOf(u)}`));
  const pages = await Promise.all(urls.map((u, i) => scrape(u).then(
    (page) => { step(`url${i}`, undefined, 'done', page.title || `${page.text.length} characters`); return `\n\n--- WEB PAGE: ${page.title} (${page.url}) ---\n${page.description}\n${page.text}`; },
    (err) => { step(`url${i}`, `Couldn't read ${hostOf(u)}`, 'warn', err.message); return `\n\n[Could not read ${u}: ${err.message}]`; }
  )));
  context += pages.join('');

  const vision = doc.images.length > 0;
  step('generate', GENERATE_LABEL[target] || GENERATE_LABEL.general);
  const out = await stream({
    feature: target === 'code' ? 'code' : 'text',
    vision,
    system: mode.system,
    messages: [...llmHistory, { role: 'user', content: (message || 'Analyse the attached file(s).') + context, images: doc.images }],
    temperature: mode.temperature,
    signal,
  }, adapter(ctx, emit, step, 'generate'));
  step('generate', undefined, 'done', `${PROVIDER_LABEL[out.provider]} · ${out.model}`);
  return { content: out.text, provider: out.provider, model: out.model };
}

/* ───────────────────────── shared setup / save ───────────────────────── */
async function prepare(req) {
  let message = String(req.body.message || '').trim();
  const selectedMode = modes[req.body.mode] ? req.body.mode : 'general';
  const files = req.files || [];
  let chat = null;
  if (req.body.chatId && validId(req.body.chatId)) chat = await ChatHistory.findOne({ _id: req.body.chatId, user: req.user._id });

  /* Regenerate: take the last user → assistant pair out of the conversation (in memory only;
     nothing changes in the database unless the new answer is saved). */
  let regen = null;
  if (String(req.body.regenerate) === 'true') {
    const n = chat?.messages.length || 0;
    const previous = chat?.messages[n - 1];
    const user = chat?.messages[n - 2];
    if (!previous || previous.role !== 'assistant' || user?.role !== 'user') {
      return { error: 'Nothing to regenerate in this chat' };
    }
    regen = { previous: previous.toObject ? previous.toObject() : previous, user: user.toObject ? user.toObject() : user };
    chat.messages.splice(n - 2, 2);
    message = regen.user.content || '';
  }

  if (!chat) chat = new ChatHistory({ user: req.user._id, mode: selectedMode, title: makeTitle(message || files[0]?.originalname) });
  return { message, selectedMode, files, chat, regen };
}

const MAX_VARIANTS = Number(process.env.MAX_REGENERATE_VERSIONS || 5);
const snapshot = (m) => ({
  content: m.content, images: m.images, provider: m.provider, model: m.model,
  routedMode: m.routedMode, steps: m.steps, createdAt: m.createdAt,
});
/** Never send stored file text to the browser. */
const publicMsg = (m) => {
  const o = m?.toObject ? m.toObject() : { ...m };
  delete o.fileText;
  return o;
};

async function persist(chat, message, ctx, result, stopped = false, regen = null) {
  const userMsg = regen
    ? { role: 'user', content: regen.user.content, attachments: regen.user.attachments, fileText: regen.user.fileText, createdAt: regen.user.createdAt }
    : { role: 'user', content: message, attachments: ctx.attachments || [], fileText: ctx.fileText };
  const variants = regen ? [...(regen.previous.variants || []), snapshot(regen.previous)].slice(-MAX_VARIANTS) : undefined;
  chat.messages.push(
    userMsg,
    {
      role: 'assistant',
      routedMode: ctx.target,
      content: result?.content ?? ctx.text,
      images: result?.images ?? ctx.images.filter(Boolean),
      provider: result?.provider,
      model: result?.model,
      steps: ctx.steps.map((s) => (s.status === 'active' ? { ...s, status: stopped ? 'error' : 'done' } : s)),
      stopped,
      ...(variants && { variants }),
    }
  );
  await chat.save();
  return publicMsg(chat.messages[chat.messages.length - 1]);
}

async function refund(user) {
  user.usage.hourCount = Math.max(0, user.usage.hourCount - 1);
  user.usage.dayCount = Math.max(0, user.usage.dayCount - 1);
  await user.save().catch(() => {});
}

/* ───────────────────────── POST /api/chat/stream ───────────────────────── */
exports.streamMessage = async (req, res) => {
  const { message, selectedMode, files, chat, regen, error } = await prepare(req);
  if (error) return res.status(400).json({ message: error });
  if (!message && !files.length && !regen) return res.status(400).json({ message: 'Message is empty' });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', // no-transform also stops gzip from buffering the stream
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx/proxy buffering
  });
  res.flushHeaders();
  // 2 KB padding: some proxies/CDNs hold back the first bytes of a response — this pushes
  // the stream past their buffer so the first words reach the browser immediately.
  res.write(`:${' '.repeat(2048)}\n\n`);
  res.flush?.();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
  };
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const heartbeat = setInterval(() => { if (!res.writableEnded) { res.write(': ping\n\n'); res.flush?.(); } }, 15000);

  const ctx = { steps: [], text: '', images: [], target: selectedMode, attachments: [] };
  send('meta', { chatId: chat._id, title: chat.title, mode: chat.mode, regenerate: Boolean(regen) });

  try {
    const result = await runPipeline({ req, chat, message, selectedMode, files, emit: send, signal: ac.signal, ctx, regen });
    const saved = await persist(chat, message, ctx, result, false, regen);
    send('done', { chatId: chat._id, title: chat.title, routedMode: ctx.target, message: saved });
  } catch (err) {
    if (ac.signal.aborted || err.aborted) {
      // user pressed Stop / closed the tab — keep whatever was produced
      if (ctx.text.trim() || ctx.images.some(Boolean)) await persist(chat, message, ctx, null, true, regen).catch(() => {});
      else await refund(req.user);
    } else {
      console.error('[chat/stream]', err.message);
      await refund(req.user);
      send('error', { message: err.message || 'Something went wrong', code: err.code });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};

/* ───────────────────────── POST /api/chat/send (non-streaming) ───────────────────────── */
exports.sendMessage = async (req, res) => {
  const { message, selectedMode, files, chat, regen, error } = await prepare(req);
  if (error) return res.status(400).json({ message: error });
  if (!message && !files.length && !regen) return res.status(400).json({ message: 'Message is empty' });
  const ctx = { steps: [], text: '', images: [], target: selectedMode, attachments: [] };
  try {
    const result = await runPipeline({ req, chat, message, selectedMode, files, emit: () => {}, ctx, regen });
    const saved = await persist(chat, message, ctx, result, false, regen);
    res.json({ chatId: chat._id, title: chat.title, mode: chat.mode, routedMode: ctx.target, message: saved });
  } catch (err) {
    await refund(req.user);
    res.status(err.status || 500).json({ message: err.message || 'Something went wrong' });
  }
};

/* ───────────────────────── history endpoints ───────────────────────── */
exports.listChats = async (req, res) => {
  const chats = await ChatHistory.find({ user: req.user._id }).select('title mode updatedAt isPublic').sort({ updatedAt: -1 }).limit(200);
  res.json({ chats });
};

exports.getChat = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  const chat = await ChatHistory.findOne({ _id: req.params.id, user: req.user._id });
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  const out = chat.toObject();
  out.messages = out.messages.map(publicMsg);
  res.json({ chat: out });
};

exports.renameChat = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  const chat = await ChatHistory.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { title: makeTitle(String(req.body.title || '')) },
    { new: true }
  ).select('title mode updatedAt isPublic');
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  res.json({ chat });
};

exports.deleteChat = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  await ChatHistory.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
};

exports.toggleShare = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  const chat = await ChatHistory.findOne({ _id: req.params.id, user: req.user._id });
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  chat.isPublic = req.body.enabled !== false;
  if (chat.isPublic && !chat.shareId) chat.shareId = crypto.randomBytes(12).toString('base64url');
  await chat.save();
  res.json({ isPublic: chat.isPublic, shareId: chat.shareId });
};

exports.getShared = async (req, res) => {
  const chat = await ChatHistory.findOne({ shareId: String(req.params.shareId), isPublic: true })
    .select('title mode messages.role messages.content messages.images messages.routedMode messages.steps messages.createdAt createdAt')
    .populate('user', 'name');
  if (!chat) return res.status(404).json({ message: 'This shared chat does not exist or is no longer public' });
  res.json({ chat: { title: chat.title, mode: chat.mode, author: chat.user?.name, messages: chat.messages, createdAt: chat.createdAt } });
};

exports.listTemplates = async (req, res) => {
  const templates = await PromptTemplate.find().sort({ category: 1, title: 1 });
  res.json({ templates });
};
