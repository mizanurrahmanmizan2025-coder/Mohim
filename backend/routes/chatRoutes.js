const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const a = require('../middleware/asyncHandler');
const { protect } = require('../middleware/authMiddleware');
const { expiryCheck } = require('../middleware/expiryCheck');
const { usageLimit } = require('../middleware/usageLimit');
const { uploadGuard } = require('../middleware/uploadGuard');
const chat = require('../controllers/chatController');
const image = require('../controllers/imageController');

const MAX_FILE_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true, // keep "my-app/src/index.js" paths for folder uploads
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024, // per file (zip archives can be up to this size)
    files: Number(process.env.MAX_UPLOAD_FILES || 500), // folder uploads send many files
    fields: 30,
  },
});

const gated = [a(protect), expiryCheck, a(usageLimit)];
const sendGate = [a(protect), expiryCheck, uploadGuard, upload.array('files', Number(process.env.MAX_UPLOAD_FILES || 500)), a(usageLimit)];

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
router.get('/models', a(protect), a(chat.listModels));

module.exports = router;
