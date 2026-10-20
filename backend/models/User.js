const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'suspended', 'blocked'], default: 'active' },
    expiryDate: { type: Date, default: null }, // null = never expires
    limits: {
      daily: { type: Number, default: 100 },
      hourly: { type: Number, default: 20 },
    },
    usage: {
      hourCount: { type: Number, default: 0 },
      hourStart: { type: Date, default: () => new Date() },
      dayCount: { type: Number, default: 0 },
      dayStart: { type: Date, default: () => new Date() },
      total: { type: Number, default: 0 },
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function hash(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function compare(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isExpired = function isExpired() {
  return this.role !== 'admin' && this.expiryDate && this.expiryDate.getTime() < Date.now();
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    expiryDate: this.expiryDate,
    expired: Boolean(this.isExpired()),
    limits: this.limits,
    usage: this.usage,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports = mongoose.model('User', userSchema);
