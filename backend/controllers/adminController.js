const mongoose = require('mongoose');
const User = require('../models/User');
const ChatHistory = require('../models/ChatHistory');
const PromptTemplate = require('../models/PromptTemplate');
const { getPoolStatus } = require('../services/keyRotationService');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/admin/stats
exports.stats = async (req, res) => {
  const now = new Date();
  const [total, active, suspended, blocked, expired, chats] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'suspended' }),
    User.countDocuments({ status: 'blocked' }),
    User.countDocuments({ role: 'user', expiryDate: { $ne: null, $lt: now } }),
    ChatHistory.estimatedDocumentCount(),
  ]);
  res.json({ users: { total, active, suspended, blocked, expired }, chats, providers: getPoolStatus() });
};

// GET /api/admin/users?search=&status=&page=1
exports.listUsers = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  if (['active', 'suspended', 'blocked'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.status === 'expired') filter.expiryDate = { $ne: null, $lt: new Date() };

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ users: users.map((u) => u.toSafeJSON()), total, page, pages: Math.ceil(total / limit) || 1 });
};

/**
 * PATCH /api/admin/users/:id
 * Body (all optional):
 *  status: 'active'|'suspended'|'blocked'
 *  expiryDate: '2026-12-31' | null (null = lifetime)
 *  extendDays: 30 (positive extends, negative reduces; from max(now, current expiry))
 *  limits: { daily, hourly }  (0 = unlimited)
 *  role: 'user'|'admin'
 *  resetUsage: true
 */
exports.updateUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const b = req.body;
  const isSelf = String(user._id) === String(req.user._id);

  if (b.status !== undefined) {
    if (!['active', 'suspended', 'blocked'].includes(b.status)) return res.status(400).json({ message: 'Invalid status' });
    if (isSelf && b.status !== 'active') return res.status(400).json({ message: 'You cannot suspend or block yourself' });
    user.status = b.status;
  }

  if (b.expiryDate !== undefined) {
    if (b.expiryDate === null || b.expiryDate === '') user.expiryDate = null;
    else {
      const d = new Date(b.expiryDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid date' });
      // a bare date means "valid through the end of that day"
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.expiryDate))) d.setUTCHours(23, 59, 59, 999);
      user.expiryDate = d;
    }
  }

  if (b.extendDays !== undefined) {
    const days = Number(b.extendDays);
    if (!Number.isFinite(days)) return res.status(400).json({ message: 'Invalid extendDays' });
    const base = days > 0 ? Math.max(Date.now(), user.expiryDate?.getTime() || Date.now()) : (user.expiryDate?.getTime() || Date.now());
    user.expiryDate = new Date(base + days * 86400000);
  }

  if (b.limits) {
    if (b.limits.daily !== undefined) user.limits.daily = Math.max(0, Number(b.limits.daily) || 0);
    if (b.limits.hourly !== undefined) user.limits.hourly = Math.max(0, Number(b.limits.hourly) || 0);
  }

  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) return res.status(400).json({ message: 'Invalid role' });
    if (isSelf && b.role !== 'admin') return res.status(400).json({ message: 'You cannot remove your own admin role' });
    user.role = b.role;
  }

  if (b.resetUsage) {
    user.usage.hourCount = 0;
    user.usage.dayCount = 0;
  }

  await user.save();
  res.json({ user: user.toSafeJSON() });
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
  if (String(req.params.id) === String(req.user._id)) return res.status(400).json({ message: 'You cannot delete yourself' });
  await Promise.all([User.deleteOne({ _id: req.params.id }), ChatHistory.deleteMany({ user: req.params.id })]);
  res.json({ ok: true });
};

/* ───── Prompt templates ───── */
exports.createTemplate = async (req, res) => {
  const { title, prompt, mode = 'general', category = 'General' } = req.body;
  if (!title || !prompt) return res.status(400).json({ message: 'Title and prompt are required' });
  const t = await PromptTemplate.create({ title, prompt, mode, category });
  res.status(201).json({ template: t });
};

exports.deleteTemplate = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  await PromptTemplate.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
};
