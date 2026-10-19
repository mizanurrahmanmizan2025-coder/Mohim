/**
 * Per-user hourly + daily request quotas set by the admin.
 * Counts are stored on the user document (rolling windows reset lazily).
 * Must run after protect() and expiryCheck().
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function usageLimit(req, res, next) {
  const u = req.user;
  if (u.role === 'admin') return next();

  const now = Date.now();
  if (now - new Date(u.usage.hourStart).getTime() >= HOUR) {
    u.usage.hourStart = new Date(now);
    u.usage.hourCount = 0;
  }
  if (now - new Date(u.usage.dayStart).getTime() >= DAY) {
    u.usage.dayStart = new Date(now);
    u.usage.dayCount = 0;
  }

  if (u.limits.hourly > 0 && u.usage.hourCount >= u.limits.hourly) {
    const mins = Math.ceil((HOUR - (now - new Date(u.usage.hourStart).getTime())) / 60000);
    return res.status(429).json({ code: 'HOURLY_LIMIT', message: `Hourly limit reached (${u.limits.hourly}). Try again in ${mins} min.` });
  }
  if (u.limits.daily > 0 && u.usage.dayCount >= u.limits.daily) {
    return res.status(429).json({ code: 'DAILY_LIMIT', message: `Daily limit reached (${u.limits.daily}). It resets within 24 hours.` });
  }

  u.usage.hourCount += 1;
  u.usage.dayCount += 1;
  u.usage.total += 1;
  await u.save();
  next();
}

module.exports = { usageLimit };
