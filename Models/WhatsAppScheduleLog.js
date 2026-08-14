const mongoose = require("mongoose");

const schedContactSchema = new mongoose.Schema({
  name: { type: String, default: "Ma'am/Sir" },
  phone: { type: String, required: true },
  pain: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "sent", "failed"],
    default: "pending",
  },
  error: { type: String, default: null },
}, { _id: false });

const whatsAppScheduleSchema = new mongoose.Schema({
  templateName: { type: String, required: true },
  language: { type: String, default: "en" },
  imageUrl: { type: String, default: null },

  totalContacts: { type: Number, required: true },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },

  contacts: [schedContactSchema],

  scheduledAt: { type: Date, required: true },
  executedAt: { type: Date, default: null },

  status: {
    type: String,
    enum: ["pending", "running", "sent", "failed", "cancelled"],
    default: "pending",
  },
}, { timestamps: true });

whatsAppScheduleSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model(
  "WhatsAppScheduleLog",
  whatsAppScheduleSchema
);