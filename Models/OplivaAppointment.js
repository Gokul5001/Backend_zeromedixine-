const mongoose = require("mongoose");

const oplivaAppointmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    age: { type: Number, required: true },
    message: { type: String, required: true },

    promoCode: { type: String, default: null }, // ✅ NEW FIELD
    clinic_code: { type: String, default: null },
    clinic_name: { type: String, default: null },

    source: { type: String, default: "opliva_website" },

    status: { 
      type: String, 
      enum: ["new", "contacted", "converted"], 
      default: "new" 
    },

    contactedAt: { type: Date, default: null }
  },
  { 
    collection: "opliva_appointments",
    timestamps: true 
  }
);

module.exports =
  mongoose.models.OplivaAppointment ||
  mongoose.model("OplivaAppointment", oplivaAppointmentSchema);