// models/Clinic.js
const mongoose = require('mongoose');

const ClinicAccountSchema = new mongoose.Schema({
  accountHolder: { type: String, default: null, trim: true },
  bankName: { type: String, default: null, trim: true },
  accountNumber: { type: String, default: null, trim: true },
  ifsc: { type: String, default: null, trim: true }
}, { _id: false });

// Re-usable sub-schema for uploaded consent/concern PDF
const ConcernFormSchema = new mongoose.Schema({
  url: { type: String, default: null },            // public Drive webViewLink or URL
  driveId: { type: String, default: null },        // drive file id
  filename: { type: String, default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null }, // optional
  uploadedAt: { type: Date, default: null }
}, { _id: false });

// small schema for signature link
const SignatureSchema = new mongoose.Schema({
  url: { type: String, default: null },
  driveId: { type: String, default: null },
  filename: { type: String, default: null },
  uploadedAt: { type: Date, default: null }
}, { _id: false });

// Structured other_details to hold extra files/links
const OtherDetailsSchema = new mongoose.Schema({
  signature: { type: SignatureSchema, default: null },
  concernForm: { type: ConcernFormSchema, default: null },
  // keep flexibility for future: store arbitrary extras but discourage heavy nesting
  extras: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const allowedSpecialisations = [
  "Physio",
  "Orthopedic",
  "Neuro",
  "Cardio",
  "General Practice",
  "Gynecology",
  "ENT",
  "Dermatology",
  "Nutrition",
  "Other"
];

const ClinicSchema = new mongoose.Schema({
  clinicName: { type: String, required: true, trim: true },
  registrationNumber: { type: String, required: true, trim: true, index: true },
  clinicNumber: { type: String, required: true, trim: true, index: true },
  ownerNumber: { type: String, required: true, trim: true },
  pincode: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },  
  state: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "State",
    required: true,
    index: true
  },

  district: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "District",
    index: true
  },



  
  
  
  gstNumber: { type: String, default: null, trim: true },
  specialisation: { type: String, enum: allowedSpecialisations, default: 'Physio' },
  clinicAccountDetails: { type: ClinicAccountSchema, default: () => ({}) },
  other_details: { type: OtherDetailsSchema, default: () => ({}) },



  status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'active' },

  
  // optional fields you might want later
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null },
  isActive: { type: Boolean, default: true },

  Chief_doctor: { type: String, trim: true, default: "" },
Role: { type: String, trim: true, default: "" },
consult_fee: { type: Number, default: 0 },


clinic_timing: { type: String, trim: true, default: "" }, // ✅ Add this line
about_doctor: { type: String, trim: true, default: "" },
redirect_path: { type: String, trim: true, lowercase: true, default: "" },



profile_img: { type: String, default: null }, // Drive URL


  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// touch updatedAt
ClinicSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// simple compound index to enforce uniqueness more strongly if desired
ClinicSchema.index({ registrationNumber: 1, clinicNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Clinic', ClinicSchema);
