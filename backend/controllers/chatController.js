/**
 * controllers/chatController.js
 *
 * Main "Chat" mode now auto-routes every message:
 *   image → Pollinations images   code → Code Expert prompt   search → live web research
 *   url → page scraping           document → file/vision analysis   writer → content writer
 *   general → normal chat
 * When the user picks a specific sidebar mode, that mode is respected (no routing).
 * The assistant message stores `routedMode` so the UI can show which tool answered.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const PromptTemplate = require('../models/PromptTemplate');
const { generate } = require('../services/fallbackService');
const { getMode, modes } = require('../services/modes');
const { processFiles } = require('../services/documentService');
const { scrape, extractUrls } = require('../services/webScraperService');
const { generateImages, SIZES } = require('../services/pollinationsService');
const { routeIntent, detectImageSize, detectImageCount } = require('../services/intentRouter');
const { webSearch } = require('../services/webSearchService');
const { enhancePrompt } = require('./imageController');

const HISTORY_TURNS = 20;
const validId = (id) => mongoose.isValidObjectId(id);
const makeTitle = (s) => (s || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';

/* ───────────────────────── Tool handlers ───────────────────────── */

async function handleImage({ message, route, imageSize, imageCount }) {
  const prompt = route?.imagePrompt || (await enhancePrompt(message));
  const size = SIZES[imageSize] ? imageSize : route?.imageSize || detectImageSize(message);
  const count = Number(imageCount) || route?.imageCount || detectImageCount(message);
  const images = generateImages(prompt, { size, count });
  return {
    content: `**Prompt used:**\n\n> ${prompt}\n\nClick an image to open it full size, or use the download button.`,
    images,
    provider: 'pollinations',
  };
}

async function handleSearch({ message, route, history }) {
  const system = getMode('url').system.replace('web pages whose extracted text is provided to you', 'questions using live web search results');
  const result = await webSearch(route?.searchQuery || message, { system, history });
  if (result) return { content: result.text, provider: result.provider, model: result.model };

  // no search backend available → answer from model knowledge, clearly labelled
  const out = await generate({
    system: `${getMode('general').system}\nLive web search is unavailable right now. Answer from your knowledge, and say clearly that the information may be out of date.`,
    messages: [...history, { role: 'user', content: message }],
  });
  return { content: out.text, provider: out.provider, model: out.model };
}

async function handleText({ modeKey, message, doc, history }) {
  const mode = getMode(modeKey);
  let context = '';

  if (doc.text) context += `\n\nThe user attached these files:\n${doc.text}`;

  // read any links in the message (Web Analyzer behaviour works in every text mode)
  for (const u of extractUrls(message)) {
    try {
      const page = await scrape(u);
      context += `\n\n--- WEB PAGE: ${page.title} (${page.url}) ---\n${page.description}\n${page.text}`;
    } catch (err) {
      context += `\n\n[Could not read ${u}: ${err.message}]`;
    }
  }

  const current = { role: 'user', content: (message || 'Analyse the attached file(s).') + context, images: doc.images };
  const out = await generate({
    system: mode.system,
    messages: [...history, current],
    temperature: mode.temperature,
    vision: doc.images.length > 0,
  });
  return { content: out.text, provider: out.provider, model: out.model };
}

/* ───────────────────────── POST /api/chat/send ─────────────────────────
   multipart/form-data: message, mode, chatId?, imageSize?, imageCount?, files[] */
exports.sendMessage = async (req, res) => {
  const message = String(req.body.message || '').trim();
  const selectedMode = modes[req.body.mode] ? req.body.mode : 'general';
  const files = req.files || [];
  if (!message && !files.length) return res.status(400).json({ message: 'Message is empty' });

  // load or create the conversation
  let chat;
  if (req.body.chatId && validId(req.body.chatId)) {
    chat = await ChatHistory.findOne({ _id: req.body.chatId, user: req.user._id });
  }
  if (!chat) chat = new ChatHistory({ user: req.user._id, mode: selectedMode, title: makeTitle(message || files[0]?.originalname) });

  const history = chat.messages
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content || '', routedMode: m.routedMode }));

  try {
    /* 1. decide which tool handles this message */
    let route = null;
    let target = selectedMode;
    if (selectedMode === 'general') {
      route = await routeIntent({ message, files, history });
      target = route.intent;
      console.log(`[router] "${message.slice(0, 60)}" → ${target} (${route.source})`);
    }

    /* 2. run it */
    const doc = await processFiles(files);
    const llmHistory = history.map(({ role, content }) => ({ role, content }));
    let result;

    if (target === 'image' && !files.length) {
      result = await handleImage({ message, route, imageSize: req.body.imageSize, imageCount: req.body.imageCount });
    } else if (target === 'search' && !files.length) {
      result = await handleSearch({ message, route, history: llmHistory });
    } else {
      const modeKey = target === 'image' || target === 'search' ? 'document' : target; // files present → analyse them
      result = await handleText({ modeKey, message, doc, history: llmHistory });
      target = modeKey;
    }

    /* 3. save + respond */
    chat.messages.push(
      { role: 'user', content: message, attachments: doc.meta },
      { role: 'assistant', routedMode: target, ...result }
    );
    await chat.save();
    const saved = chat.messages[chat.messages.length - 1];

    res.json({ chatId: chat._id, title: chat.title, mode: chat.mode, routedMode: target, message: saved });
  } catch (err) {
    // refund the quota for a request that produced nothing
    req.user.usage.hourCount = Math.max(0, req.user.usage.hourCount - 1);
    req.user.usage.dayCount = Math.max(0, req.user.usage.dayCount - 1);
    await req.user.save().catch(() => {});
    res.status(err.status || 500).json({ message: err.message || 'Something went wrong' });
  }
};

/* ───────────────────────── History endpoints (unchanged) ───────────────────────── */

// GET /api/chats
exports.listChats = async (req, res) => {
  const chats = await ChatHistory.find({ user: req.user._id })
    .select('title mode updatedAt isPublic')
    .sort({ updatedAt: -1 })
    .limit(200);
  res.json({ chats });
};

// GET /api/chats/:id
exports.getChat = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  const chat = await ChatHistory.findOne({ _id: req.params.id, user: req.user._id });
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  res.json({ chat });
};

// PATCH /api/chats/:id   { title }
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

// DELETE /api/chats/:id
exports.deleteChat = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  await ChatHistory.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
};

// POST /api/chats/:id/share   { enabled: true|false }
exports.toggleShare = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Chat not found' });
  const chat = await ChatHistory.findOne({ _id: req.params.id, user: req.user._id });
  if (!chat) return res.status(404).json({ message: 'Chat not found' });

  chat.isPublic = req.body.enabled !== false;
  if (chat.isPublic && !chat.shareId) chat.shareId = crypto.randomBytes(12).toString('base64url');
  await chat.save();
  res.json({ isPublic: chat.isPublic, shareId: chat.shareId });
};

// GET /api/share/:shareId   (public, read-only)
exports.getShared = async (req, res) => {
  const chat = await ChatHistory.findOne({ shareId: String(req.params.shareId), isPublic: true })
    .select('title mode messages.role messages.content messages.images messages.routedMode messages.createdAt createdAt')
    .populate('user', 'name');
  if (!chat) return res.status(404).json({ message: 'This shared chat does not exist or is no longer public' });
  res.json({ chat: { title: chat.title, mode: chat.mode, author: chat.user?.name, messages: chat.messages, createdAt: chat.createdAt } });
};

// GET /api/templates
exports.listTemplates = async (req, res) => {
  const templates = await PromptTemplate.find().sort({ category: 1, title: 1 });
  res.json({ templates });
};
