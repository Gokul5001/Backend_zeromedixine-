// Models/ClinicBooking.js
const mongoose = require("mongoose");

const clinicBookingSchema = new mongoose.Schema(
  {
    // ── Clinic / Doctor ──────────────────────────────────────────
    clinicId: { type: String, required: true }, // may be a Mongo _id or a doctor_id like "doc_018"
    doctorName: { type: String, trim: true },
    clinicName: { type: String, trim: true },

    // ── Session details ──────────────────────────────────────────
    sessionType: {
      type: String,
      enum: ["In-clinic", "Online (Video)", "Home visit"],
      default: "In-clinic",
    },
    date: { type: String },   // ISO string — "2026-06-05T..."
    time: { type: String },   // "9:00 AM"

    // ── Patient ──────────────────────────────────────────────────
    patientName:  { type: String, required: true, trim: true },
    patientPhone: { type: String, required: true, trim: true },
    patientEmail: { type: String, trim: true, default: "" },
    patientAge:   { type: String, default: "" },
    concern:      { type: String, default: "" },
    notes:        { type: String, default: "" },

    // ── Booking status ───────────────────────────────────────────
    status: {
      type: String,
      enum: ["pending", "payment_initiated", "confirmed", "cancelled", "no_show"],
      default: "pending",
    },

    // ── Payment (set after Razorpay link is created) ─────────────
    payment: {
      paymentDocId:  { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
      linkId:        String,   // Razorpay plink_xxx
      shortUrl:      String,
      referenceId:   String,
      amount:        Number,   // in paise
      currency:      { type: String, default: "INR" },
      status:        { type: String, default: "created" }, // created | paid | expired
      paidAt:        Date,
    },
  },
  {
    timestamps: true,   // createdAt, updatedAt
    collection: "clinicbookings",
  }
);

// Indexes for quick lookups
clinicBookingSchema.index({ clinicId: 1, createdAt: -1 });
clinicBookingSchema.index({ patientPhone: 1 });
clinicBookingSchema.index({ "payment.linkId": 1 });
clinicBookingSchema.index({ status: 1 });

module.exports =
  mongoose.models.ClinicBooking ||
  mongoose.model("ClinicBooking", clinicBookingSchema);
