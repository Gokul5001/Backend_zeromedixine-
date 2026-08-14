// Models/AddSession.js
const mongoose = require("mongoose");

const singleSessionSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  date: { type: String, required: true },    // store as YYYY-MM-DD string for simplicity
  time: { type: String, required: true },    // store as HH:mm (24h) or whatever format you use
  scheduledAt: { type: Date, default: null }, // optional: combined Date

   // NEW: per-session Twilio room details for patient & doctor
   twilioRoomPatient: {
    roomName: { type: String, default: null },
    roomSid: { type: String, default: null },
    link: { type: String, default: null }, // frontend-friendly link if you want
    createdAt: { type: Date, default: null }
  },
  
  twilioRoomDoctor: {
    roomName: { type: String, default: null },
    roomSid: { type: String, default: null },
    link: { type: String, default: null },
    createdAt: { type: Date, default: null }
  },

  
  

  
  session_handled: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null }, // doctor who handled this session
  session_handled_display: { type: String, default: null }, // username/name snapshot for UI convenience
  treatment: { type: String, default: null }, // treatment type/name for this session

  // NEW fields for reminders & notification tracking
  sendReminder: { type: Boolean, default: false },             // user toggles -> job will send if true
  sessionNotificationSent: { type: Boolean, default: false },  // job sets to true after successful send
  sessionNotificationSentAt: { type: Date, default: null },    // timestamp when notification was sent

  // the important new reschedule subdoc
  reschedule: {
    newDate: { type: String, default: null },       // YYYY-MM-DD
    newTime: { type: String, default: null },       // HH:mm
    reason: { type: String, default: null },
    status: { type: String, enum: ["none","requested","confirmed","rejected"], default: "none" },
    requestedBy: { type: String, default: null },   // username/id
    requestedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null }
  },
  
  chiefComplaints: { type: String, default: "" },
  enquiryNotes: { type: String, default: "" },
  enquiryUpdatedBy: { type: String, default: null },
  enquiryUpdatedAt: { type: Date, default: null },

  

}, { _id: false });


// Re-usable sub-schema for consentForm
const consentFormSchema = new mongoose.Schema({
  url: { type: String, default: null },            // public Drive webViewLink or URL
  driveId: { type: String, default: null },        // drive file id (optional)
  filename: { type: String, default: null },
  name: { type: String, default: null },           // patient name snapshot
  age: { type: String, default: null },            // store as string to preserve whatever user entered
  concern: { type: String, default: null },
  assessmentLink: { type: String, default: null }, // optional link to assessment PDF used in form
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null }, // which user uploaded (optional)
  submittedAt: { type: Date, default: null },     // timestamp when consent was saved
}, { _id: false });


/** NEW: invoice schema stored under addSession (right below consentForm) */
const invoiceSchema = new mongoose.Schema({
  url: { type: String, default: null },         // google drive webViewLink or direct URL
  driveId: { type: String, default: null },     // drive file id
  filename: { type: String, default: null },
  amount: { type: Number, default: 0 },         // smallest unit (paise) or raw number — keep consistent with Payment model
  currency: { type: String, default: "INR" },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null },
  generatedByName: { type: String, default: null }, // snapshot for UI convenience
  generatedAt: { type: Date, default: null },
  razorpayPaymentLink: { type: mongoose.Schema.Types.Mixed, default: null } // optional: if you attach payment link metadata
}, { _id: false });



const addSessionSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Sessions", required: true },
  doctorAssigned: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", required: true },
  package_snapshot: { type: mongoose.Schema.Types.Mixed, default: {} }, // store package_name, sessions_count, duration_weeks etc
  sessions: { type: [singleSessionSchema], default: [] }, // array of session {index, date, time}
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "login_credentials", default: null },
  notes: { type: String, default: "" },
  status: { type: String, default: "scheduled" } ,// scheduled | completed | cancelled
  consentForm: { type: consentFormSchema, default: () => ({}) },
  invoice: { type: invoiceSchema, default: () => ({}) },

}, { timestamps: true });



addSessionSchema.index({ appointmentId: 1 });
addSessionSchema.index({ doctorAssigned: 1 });

module.exports = mongoose.models.AddSession || mongoose.model("AddSession", addSessionSchema);
