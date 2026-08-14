// const mongoose = require("mongoose");

// const appointmentSchema = new mongoose.Schema(
//   {
//     name: { type: String, required: true },
//     age: { type: Number, required: true },
//     gender: { type: String, required: true },
//     phone: { type: String, required: true },
//     email: { type: String, required: true },
//     primaryConcern: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Concern",
//       required: true,
//     },
//     appointment_date: { type: String, required: true },
//     appointment_time: { type: String, required: true },
//     cdate: { type: String },
//     ctime: { type: String },
    

//     language: { type: String, default: null },
//     // add this field inside the schema object
//     couponCode: { type: String, default: null },



//     // ✅ New WhatsApp opt-in fields
//     whatsAppOptIn: { type: Boolean, default: false },
//     whatsAppOptInMethod: {
//       type: String,
//       enum: ["website", "wa_click", "other", null],
//       default: null,
//     },
//     whatsAppOptInTs: { type: Date, default: null },
//     whatsAppOptOut: { type: Boolean, default: false },
//     whatsAppOptOutTs: { type: Date, default: null },

//      // NEW FIELDS:
//   status: { type: String, default: "pending" },     // e.g. "pending" | "confirmed" | "cancelled"
// // Models/Appointment.js (snippet)
// doctorAssigned: { 
//   type: mongoose.Schema.Types.ObjectId, 
//   ref: "login_credentials", // name of the model/collection — keep consistent with your DB
//   default: null 
// },


//   confirmedAt: { type: Date, default: null },


//       // ✅ ADD THIS: Twilio Video room fields
//       twilioRoom: {
//         roomName: { type: String, default: null },
//         roomSid: { type: String, default: null },
//         createdAt: { type: Date, default: null }
//       },

// chiefComplaint: { type: String, default: null },

// // Free-form notes from the enquiry modal
// enquiryNotes: { type: String, default: null },
//   },
//   { collection: "Appointments", timestamps: true } // 👈 also adds createdAt/updatedAt
// );

// module.exports =
//   mongoose.models.Appointment ||
//   mongoose.model("Appointment", appointmentSchema);


// Models/Appointment.js (snippet)
const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: { type: Number },
    gender: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    primaryConcern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Concern",
    },
    appointment_date: { type: String, required: true },
    appointment_time: { type: String, required: true },
    cdate: { type: String },
    ctime: { type: String },
    reminder30PatientSent: { type: Boolean, default: false },
    reminder30DoctorSent: { type: Boolean, default: false },
    language: { type: String, default: null },
    couponCode: { type: String, default: null },

    whatsAppOptIn: { type: Boolean, default: false },
    whatsAppOptInMethod: { type: String, enum: ["website","wa_click","other", null], default: null },
    whatsAppOptInTs: { type: Date, default: null },
    whatsAppOptOut: { type: Boolean, default: false },
    whatsAppOptOutTs: { type: Date, default: null },

    status: { type: String, default: "pending" },

    // keep doctorAssigned as ObjectId reference
    doctorAssigned: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "login_credentials",
      default: null 
    },

    confirmedAt: { type: Date, default: null },

    // legacy single field (optional, keep for compatibility)
    twilioRoom: {
      roomName: { type: String, default: null },
      roomSid: { type: String, default: null },
      createdAt: { type: Date, default: null }
    },

    // NEW — per-appointment patient/doctor room objects (same shape as AddSession)
    twilioRoomPatient: {
      roomName: { type: String, default: null },
      roomSid: { type: String, default: null },
      link: { type: String, default: null },
      createdAt: { type: Date, default: null }
    },
    twilioRoomDoctor: {
      roomName: { type: String, default: null },
      roomSid: { type: String, default: null },
      link: { type: String, default: null },
      createdAt: { type: Date, default: null }
    },
    transcript: {
      type: String,
      default: ""
    },    

    chiefComplaint: { type: String, default: null },
    enquiryNotes: { type: String, default: null },
      // Add these transfer-related fields:
      transferredFrom: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Clinic",
        default: null 
      },
      transferredTo: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "ZeromedixineClinic",
        default: null 
      },
      sourcePatientId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "ClinicPatient",
        default: null 
      },
      transferNotes: { 
        type: String, 
        default: null 
      },
      transferredAt: { 
        type: Date, 
        default: null 
      },

      
  },

  
  { collection: "Appointments", timestamps: true }
);

module.exports = mongoose.models.Appointment || mongoose.model("Appointment", appointmentSchema);


