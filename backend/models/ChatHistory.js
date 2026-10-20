const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    attachments: [{ name: String, mimeType: String, size: Number }],
    images: [String], // generated image URLs
    provider: String, // which AI provider answered
    model: String,
    routedMode: String, // which tool the auto-router used (image, code, search, ...)
    steps: [{ _id: false, id: String, label: String, status: String, detail: String }], // live-progress log
    stopped: Boolean, // user pressed Stop while it was generating
  },
  { timestamps: true }
);

const chatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New chat', maxlength: 120 },
    mode: { type: String, default: 'general' },
    messages: [messageSchema],
    isPublic: { type: Boolean, default: false },
    shareId: { type: String, index: true, sparse: true, unique: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatHistory', chatSchema);
