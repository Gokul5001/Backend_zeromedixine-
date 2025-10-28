// models/Appointment.js
const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
    {
      name: { type: String, required: true },
      age: { type: Number, required: true },
      gender: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
      primaryConcern: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Concern",
        required: true,
      },
      appointment_date: { type: String, required: true },
      appointment_time: { type: String, required: true },
      cdate: { type: String },
      ctime: { type: String },
    },
    { collection: "Appointments" } // 👈 forces the collection name
  );
  
  module.exports =
    mongoose.models.Appointment ||
    mongoose.model("Appointment", appointmentSchema);
  