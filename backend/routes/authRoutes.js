const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const a = require('../middleware/asyncHandler');
const { protect } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/authController');

// brute-force protection on credentials endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts, try again later' } });

router.post('/register', authLimiter, a(ctrl.register));
router.post('/login', authLimiter, a(ctrl.login));
router.get('/me', a(protect), a(ctrl.me));

module.exports = router;
