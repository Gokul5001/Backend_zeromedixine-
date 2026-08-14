// models/RegisteredClinic.js
const mongoose = require("mongoose");

const registeredClinicSchema = new mongoose.Schema(
  {
    clinic_name: { type: String, required: true, index: true },
    username: { type: String, index: true }, // helpful to link
    email: { type: String, index: true, sparse: true },
    mobile_no: { type: String, index: true, sparse: true },
    address: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed }, // any extra meta (e.g. plan, pincode)
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "LoginCredential", required: false },
    status: { type: String, default: "active" }, // active/pending/disabled
  },
  { collection: "registered_clinics", timestamps: true }
);

module.exports =
  mongoose.models.RegisteredClinic ||
  mongoose.model("RegisteredClinic", registeredClinicSchema);
