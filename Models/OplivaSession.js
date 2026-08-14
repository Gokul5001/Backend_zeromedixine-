const mongoose = require("mongoose");

const OplivaSessionSchema = new mongoose.Schema({

  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "OplivaAppointment",
    required: true
  },

  preferredDate: String,
  preferredTime: String,

  roomName: String,
  roomSid: String,

  patientLink: String,
  doctorLink: String,

  status: {
    type: String,
    default: "scheduled"
  },
  transcript: {
    type: String,
    default: ""
  }, 

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("OplivaSession", OplivaSessionSchema);