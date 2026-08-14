// models/Integration.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const IntegrationSchema = new Schema({
  key: { type: String, required: true, unique: true }, // e.g. 'google_calendar'
  refreshToken: { type: String, default: null }, // encrypt in prod
  clientId: { type: String, default: null },
  clientSecret: { type: String, default: null },
  calendarId: { type: String, default: null },
  lastCheckedAt: { type: Date, default: null },
  status: { type: String, enum: ['ok','invalid','missing'], default: 'missing' },
  lastError: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Integration', IntegrationSchema);


