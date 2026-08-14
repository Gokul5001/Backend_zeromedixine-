const mongoose = require("mongoose");

const forParentsAppointmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    age: { type: Number, required: true },
    message: { type: String, required: true },

    source: { type: String, default: "zeromedixine_for_parents" },

    status: {
      type: String,
      enum: ["new", "contacted", "converted"],
      default: "new"
    },

    contactedAt: { type: Date, default: null }
  },
  {
    collection: "for_parents_Appointments", // ✅ IMPORTANT CHANGE
    timestamps: true
  }
);

module.exports =
  mongoose.models.ForParentsAppointment ||
  mongoose.model("ForParentsAppointment", forParentsAppointmentSchema);