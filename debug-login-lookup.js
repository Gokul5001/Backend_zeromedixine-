// debug-login-lookup.js
require('dotenv').config(); // loads .env in current folder
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/Zeromedixine';
  console.log('Using MONGO URI:', uri.startsWith('mongodb') ? (uri.includes('@') ? 'mongodb+srv://<REDACTED>' : uri) : uri);
  await mongoose.connect(uri);
  const coll = mongoose.connection.collection('login_credentials');
  const docs = await coll.find({}).toArray();
  console.log('Found documents count:', docs.length);
  docs.forEach((d, i) => {
    const raw = String(d.username || d.user || d.user_name || '');
    const chars = Array.from(raw).map(c => `${c}(${c.charCodeAt(0)})`).join(' ');
    console.log('--- doc', i, '---');
    console.log('_id:', d._id && d._id.toString());
    console.log('username (raw):', JSON.stringify(raw));
    console.log('username chars:', chars);
    console.log('mobile fields:', { mobile_no: d.mobile_no, mobile: d.mobile, phone: d.phone });
    console.log('keys:', Object.keys(d));
  });
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
