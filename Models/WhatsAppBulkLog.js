// Models/WhatsAppBulkLog.js
const mongoose = require("mongoose");

const contactResultSchema = new mongoose.Schema({
  name:   { type: String, default: "Ma'am/Sir" },
  phone:  { type: String, required: true },
  pain:   { type: String, default: "" },
  status: { type: String, enum: ["sent", "failed"], required: true },
  error:  { type: String, default: null },
}, { _id: false });

const whatsAppBulkLogSchema = new mongoose.Schema(
  {
    templateName:  { type: String, required: true },
    templateLabel: { type: String, default: "" },
    language:      { type: String, default: "en" },
    imageUrl:      { type: String, default: null },

    totalContacts: { type: Number, required: true },
    sentCount:     { type: Number, default: 0 },
    failedCount:   { type: Number, default: 0 },

    contacts: [contactResultSchema],

    sentAt: { type: Date, default: Date.now },   // campaign timestamp
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppBulkLog", whatsAppBulkLogSchema);