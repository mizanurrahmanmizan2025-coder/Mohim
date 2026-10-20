/**
 * Promote an existing account to admin, or create one.
 * Usage: node scripts/createAdmin.js email@domain.com "StrongPassword123" "Your Name"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  const [email, password, name = 'Admin'] = process.argv.slice(2);
  if (!email) { console.log('Usage: node scripts/createAdmin.js <email> [password] [name]'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    user.role = 'admin'; user.status = 'active'; user.expiryDate = null;
    await user.save();
    console.log(`Promoted ${email} to admin.`);
  } else {
    if (!password || password.length < 8) { console.log('Password (min 8 chars) required to create a new admin.'); process.exit(1); }
    user = await User.create({ email, password, name, role: 'admin', expiryDate: null });
    console.log(`Created admin ${email}.`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
