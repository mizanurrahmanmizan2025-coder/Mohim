/**
 * Blocks AI access for expired, suspended or blocked accounts.
 * Must run after protect().
 */
const EXPIRED_MSG = 'Your account subscription has expired. Please contact the administrator to renew.';

function expiryCheck(req, res, next) {
  const u = req.user;
  if (u.role === 'admin') return next();

  if (u.status === 'blocked') {
    return res.status(403).json({ code: 'ACCOUNT_BLOCKED', message: 'Your account has been blocked. Please contact the administrator.' });
  }
  if (u.status === 'suspended') {
    return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended. Please contact the administrator.' });
  }
  if (u.isExpired()) {
    return res.status(403).json({ code: 'SUBSCRIPTION_EXPIRED', message: EXPIRED_MSG });
  }
  next();
}

module.exports = { expiryCheck, EXPIRED_MSG };
