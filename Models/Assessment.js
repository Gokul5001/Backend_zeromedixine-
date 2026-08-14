// ============================================================
// Models/Assessment.js
// Stores each Pain Chat Assistant run: raw intake, the chat
// transcript (for history replay), and Gemini's structured
// triage output. Always linked to a logged-in patient.
// ============================================================

const mongoose = require("mongoose");

// One line of the chat, in order, so the frontend can replay
// "Hi! I'm Zero AI..." style history for a past assessment.
const ConversationEntrySchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ["bot", "patient"], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AssessmentSchema = new mongoose.Schema(
  {
    // Required — Pain Chat Assistant is login-gated, so every assessment
    // that reaches "complete" status has an owner.
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    patientPhone: { type: String, index: true }, // denormalized for quick lookup/debug

    // Client-generated id for this chat session (groups the conversation
    // even before it's persisted, and lets you dedupe retries).
    sessionId: { type: String, required: true, index: true },

    // Raw structured intake collected by the button-based chat UI
    intake: {
      condition: {
        type: String,
        required: true,
        enum: ["back", "neck", "shoulder", "hip", "knee", "other"],
      },
      painScore: { type: Number, min: 0, max: 10, required: true },
      durationBucket: {
        type: String,
        required: true,
        enum: ["<1w", "1-2w", "2-4w", "1-3m", "3m+"],
      },
      age: { type: Number, required: true, min: 0, max: 120 },
      previousInjury: { type: Boolean, required: true },
      numbness: { type: Boolean, required: true },
      swelling: { type: Boolean, required: true },
      freeTextNote: { type: String, default: "" },
    },

    // Full chat transcript, for "previous chat history"
    conversation: [ConversationEntrySchema],

    // ── Gemini's structured triage output ──
    conditionCategory: { type: String },
    severity: { type: String, enum: ["mild", "moderate", "severe"] },
    description: { type: String, default: "" }, // plain-language explanation shown to patient
    redFlag: { type: Boolean, default: false },
    redFlagReason: { type: String, default: "" },
    summaryForPhysio: { type: String }, // clinical-style note for the treating physio
    patientSummary: { type: String, default: "" }, // friendly recap shown in the chat
    recommendedSpecialist: { type: String, default: "" }, // e.g. "Orthopedic Physiotherapist"
    nextQuestions: [{ type: String }], // optional follow-ups a physio may want to ask

    // Audit trail
    modelUsed: { type: String, default: "gemini-2.5-flash" },
    rawModelResponse: { type: String },
// add to AssessmentSchema, alongside status/timestamps
booking: {
  physioAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "PhysioAppointment", default: null },
  clinicBookingId:     { type: mongoose.Schema.Types.ObjectId, ref: "ClinicBooking", default: null },
  doctorId:            { type: String, default: null },   // "doc_003"
  doctorName:          { type: String, default: null },
  sessionType:         { type: String, enum: ["single", "package", null], default: null },
  packageSessions:     { type: Number, default: 1 },
  amount:              { type: Number, default: null },   // smallest currency unit
  currency:            { type: String, default: null },
  status:              { type: String, enum: ["pending", "confirmed"], default: "pending" },
  bookedAt:            { type: Date, default: null },
},

    status: {
      type: String,
      enum: ["pending_review", "reviewed", "complete"],
      default: "pending_review",
    },
  },
  { timestamps: true }
);

// Fast "my past assessments" queries
AssessmentSchema.index({ patientId: 1, createdAt: -1 });

module.exports = mongoose.model("Assessment", AssessmentSchema);