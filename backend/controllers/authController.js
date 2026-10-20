const jwt = require('jsonwebtoken');
const User = require('../models/User');

const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.register = async (req, res) => {
  if (String(process.env.ALLOW_REGISTRATION || 'true') === 'false') {
    return res.status(403).json({ message: 'Registration is closed. Please contact the administrator.' });
  }
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'Valid name and email are required' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists' });

  const isAdmin = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase();
  const days = Number(process.env.DEFAULT_VALIDITY_DAYS ?? 7);

  const user = await User.create({
    name,
    email,
    password,
    role: isAdmin ? 'admin' : 'user',
    expiryDate: isAdmin ? null : new Date(Date.now() + days * 86400000),
    limits: {
      daily: Number(process.env.DEFAULT_DAILY_LIMIT || 100),
      hourly: Number(process.env.DEFAULT_HOURLY_LIMIT || 20),
    },
  });

  res.status(201).json({ token: sign(user), user: user.toSafeJSON() });
};

exports.login = async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  if (user.status === 'blocked') {
    return res.status(403).json({ message: 'Your account has been blocked. Please contact the administrator.' });
  }
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: sign(user), user: user.toSafeJSON() });
};

exports.me = async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
};
