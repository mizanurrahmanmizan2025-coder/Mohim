const router = require('express').Router();
const multer = require('multer');
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

// public share link (no auth)
router.get('/share/:shareId', a(chat.getShared));

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
