// ============================================================
// models/OtpVerification.js
// Stores hashed OTP per phone — never plain text
// ============================================================

const mongoose = require("mongoose");

const otpVerificationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true          // fast lookup by phone
  },
  otp_hash: {
    type: String,
    required: true       // bcrypt hash of the OTP
  },
  expires_at: {
    type: Date,
    required: true,
    index: { expires: 0 } // MongoDB TTL — auto-deletes expired docs
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("OtpVerification", otpVerificationSchema, "otp_verifications");