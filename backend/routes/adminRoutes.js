const router = require('express').Router();
const a = require('../middleware/asyncHandler');
const { protect } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const ctrl = require('../controllers/adminController');

router.use(a(protect), adminOnly);

router.get('/stats', a(ctrl.stats));
router.get('/users', a(ctrl.listUsers));
router.patch('/users/:id', a(ctrl.updateUser));
router.delete('/users/:id', a(ctrl.deleteUser));
router.post('/templates', a(ctrl.createTemplate));
router.delete('/templates/:id', a(ctrl.deleteTemplate));

module.exports = router;
