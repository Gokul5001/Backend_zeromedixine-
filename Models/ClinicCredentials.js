// // models/ClinicCredentials.js
// const mongoose = require('mongoose');

// const ClinicCredentialsSchema = new mongoose.Schema({
//   clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
//   username: { type: String, required: true, trim: true, unique: true },
//   passwordHash: { type: String, required: true },
//   createdAt: { type: Date, default: Date.now }
// });

// // Optionally: don't return passwordHash in lean queries by default (for safety)
// ClinicCredentialsSchema.methods.toSafeObject = function() {
//   return {
//     _id: this._id,
//     clinic: this.clinic,
//     username: this.username,
//     createdAt: this.createdAt
//   };
// };

// module.exports = mongoose.model('ClinicCredentials', ClinicCredentialsSchema);
// models/ClinicCredentials.js
// models/ClinicCredentials.js
const mongoose = require("mongoose");

const ClinicCredentialsSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, unique: true },
  passwordHash: { type: String, required: true },

  // SINGLE clinic (old flow)
  clinic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Clinic"
  },

  // MULTIPLE clinics (new flow)
  clinics: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic"
    }
  ],

  role: {
    type: String,
    enum: ["clinic", "clinic_owner"],
    default: "clinic"
  },

  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});


refreshTokens: [
  {
    token: String,
    createdAt: { type: Date, default: Date.now }
  }
]

module.exports = mongoose.model("ClinicCredentials", ClinicCredentialsSchema);
