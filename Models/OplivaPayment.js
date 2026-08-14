const mongoose = require("mongoose");

const oplivaPaymentSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OplivaAppointment",
      required: true
    },

    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OplivaPlan",
      required: true
    },

    planName: String,

    amount: Number,

    currency: {
      type: String,
      enum: ["INR", "USD"],
      default: "INR"
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending"
    },

    paymentMethod: {
      type: String,
      default: "razorpay"
    },

    paymentLink: String,

    transactionId: String,

    notes: String
  },
  {
    collection: "opliva_payments",
    timestamps: true
  }
);

module.exports =
  mongoose.models.OplivaPayment ||
  mongoose.model("OplivaPayment", oplivaPaymentSchema);