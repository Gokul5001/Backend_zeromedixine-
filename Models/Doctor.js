// ============================================================
// models/Doctor.js
// One document per real doctor — phone is permanent identity
// doctor_id is generated ONCE on first login, never again
// ============================================================

const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema({
  doctor_id: {
    type: String,
    unique: true,
    required: true       // e.g. "doc_001", generated once on first login
  },
  phone_number: {
    type: String,
    unique: true,
    required: true       // 10 digits — permanent identity key
  },
  name: {
    type: String,
    default: null
  },
  role: {
    type: String,
    default: null        // e.g. "Physiotherapist"
  },
  conditions_treated: {
    type: [String],
    default: []
  },
  languages: {
    type: [String],
    default: []
  },
  availability: {
    days: { type: [String], default: [] },
    start_time: { type: String, default: null },
    end_time: { type: String, default: null }
  },
  session_pricing: {
    type: String,
    default: null
  },

  years_of_experience: {
    type: String,
    default: null
  },
  profile_image: {
    type: String,   // stores Google Drive URL
    default: null
  },

  voice_note: {
    type: String,   // stores Google Drive URL
    default: null
  },

  session_pricing: {
    type: String,
    default: null
  },
  single_session_price: {
    type: String,
    default: null
  },
  single_session_price_usd: {
    type: String,
    default: null
  },
  packages: {
    type: [{
      sessions:          { type: Number, required: true },
      discount_percent:  { type: Number, default: 0 },
      price_per_session: { type: Number, required: true },
      total_price:        { type: Number, required: true },
      _id: false
    }],
    default: []
  },
  packages_usd: {
    type: [{
      sessions:          { type: Number, required: true },
      discount_percent:  { type: Number, default: 0 },
      price_per_session: { type: Number, required: true },
      total_price:        { type: Number, required: true },
      _id: false
    }],
    default: []
  },

  profile_complete: {
    type: Boolean,
    default: false
  },
  verified_profile: {
    type: Boolean,
    default: false
  },
  sessions_completed: {
    type: Number,
    default: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  last_login: {
    type: Date,
    default: null
  }
});

doctorSchema.index({ verified_profile: 1, created_at: -1 });


module.exports = mongoose.model("Doctor", doctorSchema, "doctors");