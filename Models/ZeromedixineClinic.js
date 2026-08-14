// models/ZeromedixineClinic.js
const mongoose = require("mongoose");

const ZeromedixineClinicSchema = new mongoose.Schema({
  clinicName: { type: String, required: true, trim: true },
  registrationNumber: { type: String, default: null },
  clinicNumber: { type: String, default: null },
  ownerNumber: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
}, { collection: "Zeromedixine_clinic_details" });

module.exports = mongoose.models.ZeromedixineClinic || mongoose.model("ZeromedixineClinic", ZeromedixineClinicSchema);
