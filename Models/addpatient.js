// models/addpatient.js
const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema({
  url: { type: String, default: null },
  driveId: { type: String, default: null },
  filename: { type: String, default: null },
  amount: { type: Number, default: null }, // stored in paise (integer)
  currency: { type: String, default: "INR" },
  generatedByName: { type: String, default: null },
  generatedAt: { type: Date, default: null }
}, { _id: false });

const ClinicPatientSchema = new mongoose.Schema({
  clinic: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
  clinic_name: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true, index: true },

  // NEW fields
  age: { type: Number, default: null }, // integer age in years
  email: { type: String, trim: true, default: null },

  
  dob: { type: Date, default: null }, // you may keep for backwards compatibility if needed
  gender: { type: String, default: null },
  address: { type: String, trim: true, default: null },
  notes: { type: String, trim: true, default: null },
  
  primaryConcern: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Concern",
    default: null,
  },

  
  treatment: { type: String, trim: true, default: null },
  treatmentDate: { type: Date, default: null },
  treatmentTime: { type: String, trim: true, default: null },

  transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: "ZeromedixineClinic", default: null },

  invoice: { type: InvoiceSchema, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ClinicPatientSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

ClinicPatientSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    clinic: this.clinic,
    clinic_name: this.clinic_name,
    name: this.name,
    mobile: this.mobile,
    age: this.age,
    email: this.email,
    dob: this.dob,
    gender: this.gender,
    address: this.address,
    notes: this.notes,
    treatment: this.treatment,
    treatmentDate: this.treatmentDate,
    treatmentTime: this.treatmentTime,
    invoice: this.invoice || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("ClinicPatient", ClinicPatientSchema);
