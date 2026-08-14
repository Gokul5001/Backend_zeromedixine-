const mongoose = require("mongoose");

const clinicCodeSchema = new mongoose.Schema(
  {
    clinic_code: String,
    clinic_name: String,
    status: String
  },
  { collection: "Opliva_clinic_code" }
);

module.exports =
  mongoose.models.ClinicCode ||
  mongoose.model("ClinicCode", clinicCodeSchema);