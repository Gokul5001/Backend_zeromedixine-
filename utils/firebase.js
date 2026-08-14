//utils/firebase.js

const admin = require("firebase-admin");
const serviceAccount = require("../secrets/Zeromedixine_firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
