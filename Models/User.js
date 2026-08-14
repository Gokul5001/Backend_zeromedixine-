const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["clinic_owner", "doctor", "admin"],
      default: "clinic_owner",
    },
    clinics: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "Users" // 👈 EXPLICIT COLLECTION NAME
  }
);

module.exports = mongoose.model("User", userSchema);
