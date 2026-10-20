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
const sendGate = [a(protect), expiryCheck, upload.array('files', 5), a(usageLimit)];

// image endpoints that <img> tags load: generous per-IP limit
const imageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false });

/* public (no auth) */
router.get('/share/:shareId', a(chat.getShared));
router.get('/images/render', imageLimiter, a(image.render)); // signed Pollinations proxy
router.get('/images/file/:key', imageLimiter, a(image.file)); // stored generated images

/* AI endpoints (auth + expiry + quota) */
router.post('/chat/stream', ...sendGate, a(chat.streamMessage)); // live step-by-step (SSE)
router.post('/chat/send', ...sendGate, a(chat.sendMessage)); // same pipeline, single JSON reply
router.post('/images/generate', ...gated, a(image.generate));

/* history (auth only — expired users can still read/export old chats) */
router.get('/chats', a(protect), a(chat.listChats));
router.get('/chats/:id', a(protect), a(chat.getChat));
router.patch('/chats/:id', a(protect), a(chat.renameChat));
router.delete('/chats/:id', a(protect), a(chat.deleteChat));
router.post('/chats/:id/share', a(protect), a(chat.toggleShare));
router.get('/templates', a(protect), a(chat.listTemplates));

module.exports = router;
