// models/PhysioAppointment.js
const mongoose = require("mongoose");

const physioAppointmentSchema = new mongoose.Schema({
  doctor_id: { type: String, required: true },       // e.g. "doc_001"
  doctor_ref: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
  patient_id: { type: String, default: null, index: true },  // ← add this, e.g. "pat_001"

  patient_name: { type: String, required: true },
  patient_phone: { type: String, required: true },
  patient_email: { type: String, default: null },
  patient_age: { type: String, default: null },
  concern: { type: String, default: null },
  session_type: { type: String, default: "Online" },
  date: { type: String, default: null },
  time: { type: String, default: null },  
  notes: { type: String, default: null },
  status: { type: String, default: "confirmed" },
  amount_paid: { type: Number, default: 0 },
  currency: { type: String, default: "INR" },
  razorpay_order_id: { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  clinic_booking_id: { type: mongoose.Schema.Types.ObjectId, ref: "ClinicBooking" },
  payment_doc_id: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
  // Add after payment_doc_id field
twilio_room_name: { type: String, default: null },
twilio_room_sid: { type: String, default: null },
patient_link: { type: String, default: null },
doctor_link: { type: String, default: null },
  booked_at: { type: Date, default: Date.now },
  // In Models/PhysioAppointment.js — add these two fields to the schema
reminder_30_patient_sent: { type: Boolean, default: false },
reminder_30_doctor_sent:  { type: Boolean, default: false },
// In Models/PhysioAppointment.js — add these to the schema
session_notes:      { type: String, default: null },
session_voice_note: { type: String, default: null }, // Google Drive URL
session_notes_saved_at: { type: Date, default: null },
// Add to physioAppointmentSchema:
booking_type: { type: String, default: "single", enum: ["single", "package"] },
package_sessions: { type: Number, default: 1 },
package_price_per_session: { type: Number, default: null },
package_discount_percent: { type: Number, default: 0 },
package_total_amount: { type: Number, default: null },
sessions: [
  {
    session_number:  { type: Number },   // 1-indexed
    date:            { type: String, default: null },
    time:            { type: String, default: null },
    patient_link:    { type: String, default: null },
    doctor_link:     { type: String, default: null },
    status:          { type: String, default: "pending" }, // pending | completed | cancelled
    booked_at:       { type: Date,   default: null },
     // NEW — per-session enquiry
     post_session_enquiry: {
      chief_complaints: { type: String, default: null },
      notes:            { type: String, default: null },
      submitted_at:     { type: Date,   default: null },
    },
  }
],
consent_form_url: { type: String, default: null },
consent_form_drive_id: { type: String, default: null },
consent_submitted_at: { type: Date, default: null },
assessment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", default: null },
consent_form: {
  url:          { type: String, default: null },
  driveId:      { type: String, default: null },
  submittedAt:  { type: Date,   default: null },
},

invoice: {
  url: String,
  driveId: String,
  filename: String,
  amount: Number,
  currency: String,
  generatedBy: mongoose.Schema.Types.ObjectId,
  generatedByName: String,
  generatedAt: Date,
  razorpayPaymentLink: String,
},
invoice_description: { type: String, default: null },   // ← NEW: e.g. "Back pain (single session)" / "Back pain (package)"

post_session_enquiry: {
  chief_complaints: { type: String, default: null },
  notes:            { type: String, default: null },
  submitted_at:     { type: Date,   default: null },
},

},
 { timestamps: true });



module.exports = mongoose.model("PhysioAppointment", physioAppointmentSchema, "physio_appointments");