const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const { providers } = require('./config/apiKeys');
const { seedTemplates } = require('./models/PromptTemplate');

const app = express();
app.set('trust proxy', 1); // Hostinger sits behind a proxy → correct client IPs for rate limiting

/* ───── Security & parsing ───── */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // generated images come from Pollinations
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", 'https://image.pollinations.ai'], // lets the browser download generated images
        mediaSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
const allowed = (process.env.CLIENT_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || !allowed.length || allowed.includes(origin)) }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));

/* ───── API ───── */
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    providers: Object.values(providers).map((p) => ({ name: p.name, keys: p.keys.length, model: p.model })),
  })
);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api', require('./routes/chatRoutes'));
app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found' }));

/* ───── Frontend (React build) ───── */
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '7d', index: false }));
  // SPA fallback: every non-API route returns index.html (React Router handles it)
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('API running. Build the frontend with "npm run build".'));
}

/* ───── Errors ───── */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File too large (max 10 MB)' });
  if (err.name === 'MulterError') return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(err.status || 500).json({ message: err.status ? err.message : 'Internal server error' });
});

/* ───── Boot ───── */
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is missing or too short (min 32 chars). Refusing to start.');
  process.exit(1);
}

connectDB()
  .then(seedTemplates)
  .then(() => app.listen(PORT, () => console.log(`[server] listening on :${PORT}`)))
  .catch((err) => {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  });

module.exports = app;
