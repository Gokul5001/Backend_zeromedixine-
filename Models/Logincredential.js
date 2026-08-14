// models/LoginCredential.js
const mongoose = require("mongoose");

const loginCredentialSchema = new mongoose.Schema(
  {
    username: { type: String, index: true },
    password: { type: String }, // can be bcrypt hash OR plaintext (legacy)
    mobile_no: { type: String },
    email: { type: String },
    role: { type: String, default: "doctor" },
    // any other fields you keep in login_credentials
  },
  { collection: "login_credentials", timestamps: true }
);

module.exports =
  mongoose.models.LoginCredential ||
  mongoose.model("LoginCredential", loginCredentialSchema);
