// Models/Payment.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Sessions", default: null },

  // Razorpay link fields
  linkId: { type: String, default: null },
  linkShortUrl: { type: String, default: null },
  linkLongUrl: { type: String, default: null },

  // amount stored in smallest unit (paise for INR)
  amount: { type: Number, default: 0 },
  currency: { type: String, default: "INR" },

  purpose: { type: String, default: null },
  status: { type: String, default: "created" }, // created | paid | expired | cancelled

  doctorAssigned: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "login_credentials",
    required: false
  },
  

  customer: {
    name: { type: String, default: null },
    email: { type: String, default: null },
    contact: { type: String, default: null },
  },


  // inside paymentSchema definition
invoice: {
  invoiceUrl: { type: String, default: null },
  invoiceDriveId: { type: String, default: null },
  invoiceFilename: { type: String, default: null },
  invoiceCreatedAt: { type: Date, default: null },
},

  // On success
  razorpay_payment_id: { type: String, default: null },
  razorpay_order_id: { type: String, default: null },

  // raw payloads / debug
  raw: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// Indexes for quick lookup
paymentSchema.index({ linkId: 1 });
paymentSchema.index({ appointmentId: 1 });

module.exports = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
