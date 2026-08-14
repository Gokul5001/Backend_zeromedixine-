const mongoose = require("mongoose");

const oplivaConsentSchema = new mongoose.Schema({
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "OplivaAppointment",
    required: true
  },

  name: String,
  email: String,
  dob: String,
  contact: String,
  address: String,

  testSelected: String,
  selfTest: String,

  agreeMain: Boolean,
  agreeFinal: Boolean,

  driveUrl: String

}, { timestamps: true });

module.exports = mongoose.model("OplivaConsentForm", oplivaConsentSchema, "Opliva_consent_form");