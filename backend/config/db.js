const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('[db] MongoDB connected');
}

module.exports = connectDB;
