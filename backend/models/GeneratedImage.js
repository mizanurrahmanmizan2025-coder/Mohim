const mongoose = require('mongoose');

/**
 * Generated images from Gemini / Cloudflare / Hugging Face are stored here, so links keep
 * working after a redeploy (Render/Hostinger disks are temporary).
 * Served at /api/images/file/:key — `key` is random, so URLs can't be guessed.
 * IMAGE_TTL_DAYS=30 auto-deletes old images (MongoDB Atlas free tier = 512 MB).
 */
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    data: { type: Buffer, required: true },
    mimeType: { type: String, default: 'image/png' },
    prompt: { type: String, maxlength: 2000 },
    provider: String,
    model: String,
    width: Number,
    height: Number,
  },
  { timestamps: true }
);

const ttlDays = Number(process.env.IMAGE_TTL_DAYS || 0);
if (ttlDays > 0) schema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 86400 });

module.exports = mongoose.model('GeneratedImage', schema);
