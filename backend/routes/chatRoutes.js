const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const a = require('../middleware/asyncHandler');
const { protect } = require('../middleware/authMiddleware');
const { expiryCheck } = require('../middleware/expiryCheck');
const { usageLimit } = require('../middleware/usageLimit');
const chat = require('../controllers/chatController');
const image = require('../controllers/imageController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10 MB per file, 5 files
});

const gated = [a(protect), expiryCheck, a(usageLimit)];

// image proxy: generous per-IP limit (a chat page loads several images at once)
const renderLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

// public (no auth)
router.get('/share/:shareId', a(chat.getShared));
router.get('/images/render', renderLimiter, a(image.render)); // signed URLs only

// AI endpoints (auth + expiry + quota)
router.post('/chat/send', a(protect), expiryCheck, upload.array('files', 5), a(usageLimit), a(chat.sendMessage));
router.post('/images/generate', ...gated, a(image.generate));

// history (auth only — expired users can still read/export their old chats)
router.get('/chats', a(protect), a(chat.listChats));
router.get('/chats/:id', a(protect), a(chat.getChat));
router.patch('/chats/:id', a(protect), a(chat.renameChat));
router.delete('/chats/:id', a(protect), a(chat.deleteChat));
router.post('/chats/:id/share', a(protect), a(chat.toggleShare));
router.get('/templates', a(protect), a(chat.listTemplates));

module.exports = router;
