// ============================================================
// models/Patient.js
// One document per real patient — phone is permanent identity
// OTP is updated (not duplicated) each time patient logs in
// ============================================================

const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema({
  patient_id: {
    type: String,
    unique: true,
    required: true       // e.g. "pat_001", generated once on first login
  },
  phone_number: {
    type: String,
    unique: true,
    required: true       // 10 digits — permanent identity key
  },

  // ── Basic Info (collected after first login) ──
  name: {
    type: String,
    default: null
  },
  email: {
    type: String,
    default: null
  },
  age: {
    type: String,
    default: null
  },
  gender: {
    type: String,
    enum: ["Male", "Female", "Other", null],
    default: null
  },

  // ── OTP state (overwritten on every new OTP request) ──
  otp_hash: {
    type: String,
    default: null
  },
  otp_expires_at: {
    type: Date,
    default: null
  },
  otp_attempts: {
    type: Number,
    default: 0
  },
  otp_last_sent_at: {
    type: Date,
    default: null
  },

  // ── Session & booking history ──
  total_bookings: {
    type: Number,
    default: 0
  },

  profile_complete: {
    type: Boolean,
    default: false
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

// Index for fast phone lookups
patientSchema.index({ phone_number: 1 });

module.exports = mongoose.model("Patient", patientSchema, "patients");