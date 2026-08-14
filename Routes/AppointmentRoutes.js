// routes/appointmentRoutes.js
const express = require("express");
const router = express.Router();
const Appointment = require("../Models/Appointment");
const Concern = require("../Models/Concern");
const moment = require("moment-timezone");
// const { sendTemplateMessage } = require("../utils/aisensy");
const { sendTemplateMessage } = require("../utils/superfone");

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const twilio = require("twilio");
const mongoose = require("mongoose");
const Clinic = require("../Models/Clinic");
const ClinicPatient = require("../models/addpatient"); // Adjust path as needed

// Google + FS for calendar
const { google } = require("googleapis");
const fs = require("fs");

// Twilio client initialization
const twilioClient = twilio(
  process.env.TWILIO_API_KEY_SID,
  process.env.TWILIO_API_KEY_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);


// Helper function to create Twilio room
async function createTwilioRoom(roomName) {
  try {
    const room = await twilioClient.video.v1.rooms.create({
      uniqueName: roomName,
      type: 'group',
      recordParticipantsOnConnect: false
    });
    
    return {
      roomName: room.uniqueName,
      roomSid: room.sid
    };
  } catch (error) {
    if (error.code === 53113) {
      // Room already exists - this is fine, we can still use it
      return {
        roomName: roomName,
        roomSid: null, // We don't have the SID for existing rooms
        message: 'Room already exists'
      };
    }
    throw error;
  }
}



// helper at top of the file (add once)
function sanitizeIdParam(raw) {
  if (!raw) return raw;
  // remove surrounding brackets if present
  let s = String(raw).replace(/^\[+/, "").replace(/\]+$/, "");
  // if it's an ObjectId, make sure it's 24 hex chars
  const match = s.match(/[0-9a-fA-F]{24}/);
  if (match) return match[0];
  return s;
}

/**
 * normalizePhone - remove non-digits, prefix 91 if 10 digits
 */
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}


// helpers/phone.js (or top of routes file)
function normalizePhoneLocal(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s; // India default
  return s;
}




// Requires:
// const { google } = require("googleapis");

async function createCalendarEventUsingOAuth(appointment, doctorEmail) {
  try {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN_CAL) {
      console.warn("OAuth credentials or refresh token missing — skipping calendar creation.");
      return null;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN_CAL });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const tz = process.env.GOOGLE_CALENDAR_TZ || "Asia/Kolkata";
    const dateStr = appointment.appointment_date || appointment.date || null;
    const timeStr = appointment.appointment_time || appointment.time || null;
    if (!dateStr || !timeStr) {
      console.warn("Appointment missing date/time, skipping calendar event.");
      return null;
    }

    const moment = require("moment-timezone");
    let start = moment.tz(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz);
    if (!start.isValid()) start = moment.tz(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm", tz);
    if (!start.isValid()) start = moment.tz(`${dateStr}T${timeStr}`, tz);
    if (!start.isValid()) {
      console.warn("Unable to parse appointment datetime:", dateStr, timeStr);
      return null;
    }
    const end = start.clone().add(30, "minutes");

    const event = {
      summary: `Consult — ${appointment.name || "Patient"}${appointment.primaryConcern ? ` (${appointment.primaryConcern})` : ""}`,
      description: `Patient: ${appointment.name || ""}\nPhone: ${appointment.phone || ""}\nNotes: ${appointment.enquiryNotes || ""}`,
      start: { dateTime: start.format(), timeZone: tz },
      end: { dateTime: end.format(), timeZone: tz },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 10 }] }
    };

    // only doctor as attendee (per your requirement)
    if (doctorEmail && String(doctorEmail).includes("@")) event.attendees = [{ email: doctorEmail }];

    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    const res = await calendar.events.insert({
      calendarId,
      resource: event,
      sendUpdates: event.attendees && event.attendees.length ? "all" : "none"
    });

    console.log("Google Calendar (OAuth) event created:", res.data.htmlLink || res.data.id);
    return res.data;
  } catch (err) {
    console.error("Google Calendar (OAuth) create error:", err?.response?.data || err?.message || err);
    return null;
  }
}





// router.post("/", async (req, res) => {
//   try {
//     // DEBUG: log incoming request body and headers
//     console.log(">>> DEBUG /api/appointments received body:", JSON.stringify(req.body));
//     // helpful in case body-parser is missing or payload shape is different
//     const { name, age, gender, phone, email, primaryConcern, date, time, whatsAppOptIn, language, couponCode  } = req.body;
//     console.log(">>> parsed fields:", { name, age, gender, phone, primaryConcern, date, time, whatsAppOptIn, language });

//     // minimal validation
//     if (!name || !phone || !primaryConcern || !date || !time) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     // find concern if you use it
//     const concern = await Concern.findOne({ concern: primaryConcern });

//     const now = moment().tz("Asia/Kolkata");
//     const cdate = now.format("YYYY-MM-DD");
//     const ctime = now.format("HH:mm:ss");

//     // Normalize phone helper
//     function normalizePhone(p) {
//       if (!p) return "";
//       let s = String(p).replace(/\D/g, ""); // remove non-digits
//       // if it already has country code length 12 (eg 91XXXXXXXXXX) keep it
//       // if 10 digits, assume India and prefix 91
//       if (s.length === 10) s = "91" + s;
//       return s;
//     }

//     const normalizedPhone = normalizePhone(phone);
//     console.log(">>> normalizedPhone:", normalizedPhone);

//     const newAppointment = new Appointment({
//       name,
//       age,
//       gender,
//       phone: normalizedPhone,
//       email,
//       primaryConcern: concern ? concern._id : null,
//       appointment_date: date,
//       appointment_time: time,
//       cdate,
//       ctime,
//       whatsAppOptIn: !!whatsAppOptIn,
//       whatsAppOptInMethod: whatsAppOptIn ? "website" : null,
//       whatsAppOptInTs: whatsAppOptIn ? new Date() : null,
//       language: typeof language === "string" && language.trim() !== "" ? language.trim() : null,
//       couponCode: typeof couponCode === "string" && couponCode.trim() !== "" ? couponCode.trim() : null,


//     });

//     await newAppointment.save();
//     console.log(">>> appointment saved:", {
//       id: newAppointment._id,
//       whatsAppOptIn: newAppointment.whatsAppOptIn,
//       whatsAppOptInTs: newAppointment.whatsAppOptInTs,
//       phone: newAppointment.phone,
//       couponCode: newAppointment.couponCode, // helpful debug

//     });

//     // --- Prepare doctor list from env fallback ---
//     let doctorList = (process.env.NOTIFY_DOCTORS || "")
//       .split(",")
//       .map(s => s.trim())
//       .filter(Boolean);

//     if (concern && Array.isArray(concern.doctor_phones) && concern.doctor_phones.length) {
//       concern.doctor_phones.forEach(d => {
//         const cleaned = String(d).replace(/\+/g, "").trim();
//         if (cleaned && !doctorList.includes(cleaned)) doctorList.push(cleaned);
//       });
//     }

//     doctorList = doctorList.map(d => String(d).replace(/\+/g, "").trim()).filter(Boolean);

//     // --- Send to patient ONLY if opted-in ---
//     if (newAppointment.whatsAppOptIn) {
//       const patientPayload = {
//         to: newAppointment.phone,
//         templateName: "appointment_confirmation_new",
//         params: [name, date, time, primaryConcern]
//       };

//       // Log payload for AiSensy
//       console.log(">>> calling AiSensy for patient:", patientPayload);
//       sendTemplateMessage(patientPayload)
//         .then(r => console.log("Patient WhatsApp sent:", { to: newAppointment.phone, r }))
//         .catch(e => console.error("Patient WhatsApp error:", { to: newAppointment.phone, err: e.response?.data || e.message || e }));
//     } else {
//       console.log(`>>> Skipping patient WA send; whatsAppOptIn=${newAppointment.whatsAppOptIn}`);
//     }

//     // --- Send to doctors concurrently (unchanged) ---
//     if (doctorList.length) {
//       const sendPromises = doctorList.map(docPhone => {
//         const payload = {
//           campaignName: process.env.AISENSY_DOCTOR_CAMPAIGN ,
//           to: normalizePhone(docPhone),
//           templateName: "new_patient_notification",
//           params: [ String(name), String(newAppointment._id) ]
//         };

//         console.log(">>> calling AiSensy for doctor:", payload);
//         return sendTemplateMessage(payload)
//           .then(resp => ({ status: "ok", phone: docPhone, resp }))
//           .catch(err => ({ status: "error", phone: docPhone, error: err.response?.data || err.message || String(err) }));
//       });

//       Promise.all(sendPromises)
//         .then(results => {
//           results.forEach(r => {
//             if (r.status === "ok") console.log("Doctor WhatsApp sent:", r.phone);
//             else console.error("Doctor WhatsApp failed:", r.phone, r.error);
//           });
//         })
//         .catch(err => console.error("Bulk notify error:", err));
//     } else {
//       console.warn("No doctor numbers configured in NOTIFY_DOCTORS and no concern.doctor_phones found.");
//     }

//     // Respond — return appointment and opt-in status
//     res.status(201).json({
//       message: "Appointment stored successfully",
//       appointment: newAppointment,
//       whatsAppOptIn: !!newAppointment.whatsAppOptIn
//     });
//   } catch (error) {
//     console.error("Error saving appointment:", error);
//     res.status(500).json({ error: "Server error while saving appointment" });
//   }
// });                  


// replace the existing router.post("/", ...) with this function

// router.post("/", async (req, res) => {
//   try {
//     // DEBUG: log incoming request body and headers
//     console.log(">>> DEBUG /api/appointments received body:", JSON.stringify(req.body));
//     const {
//       name, age, gender, phone, email, primaryConcern, date, time,
//       whatsAppOptIn, language, couponCode, doctorId, doctorUsername
//     } = req.body;

//     console.log(">>> parsed fields:", { name, age, gender, phone, primaryConcern, date, time, whatsAppOptIn, language, doctorId, doctorUsername });

//     // minimal validation
//     if (!name || !phone || !primaryConcern || !date || !time) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     // find concern if you use it
//     const concern = await Concern.findOne({ concern: primaryConcern });

//     const now = moment().tz("Asia/Kolkata");
//     const cdate = now.format("YYYY-MM-DD");
//     const ctime = now.format("HH:mm:ss");

//     // Normalize phone helper (we already defined one earlier; this local ensures availability)
//     function normalizePhoneLocal(p) {
//       if (!p) return "";
//       let s = String(p).replace(/\D/g, "");
//       if (s.length === 10) s = "91" + s;
//       return s;
//     }
//     const normalizedPhone = normalizePhoneLocal(phone);
//     console.log(">>> normalizedPhone:", normalizedPhone);

//     const newAppointment = new Appointment({
//       name,
//       age,
//       gender,
//       phone: normalizedPhone,
//       email,
//       primaryConcern: concern ? concern._id : null,
//       appointment_date: date,
//       appointment_time: time,
//       cdate,
//       ctime,
//       whatsAppOptIn: !!whatsAppOptIn,
//       whatsAppOptInMethod: whatsAppOptIn ? "website" : null,
//       whatsAppOptInTs: whatsAppOptIn ? new Date() : null,
//       language: typeof language === "string" && language.trim() !== "" ? language.trim() : null,
//       couponCode: typeof couponCode === "string" && couponCode.trim() !== "" ? couponCode.trim() : null,
//     });

//     await newAppointment.save();
//     console.log(">>> appointment saved:", {
//       id: newAppointment._id,
//       whatsAppOptIn: newAppointment.whatsAppOptIn,
//       phone: newAppointment.phone,
//       couponCode: newAppointment.couponCode,
//     });

//     // If booking initiated by a doctor (doctorId or doctorUsername present),
//     // confirm and assign directly to that doctor and send links only to patient+that doctor.
//     if ((doctorId && String(doctorId).trim()) || (doctorUsername && String(doctorUsername).trim())) {
//       console.log("Doctor-initiated booking detected - attempting direct confirm for:", { doctorId, doctorUsername });

//       // Find login_credentials collection name dynamically if needed
//       let credCollName = "login_credentials";
//       try {
//         const allCols = await mongoose.connection.db.listCollections().toArray();
//         const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
//         if (found) credCollName = found.name;
//       } catch (e) {
//         console.warn("Could not list collections, using default login_credentials");
//       }
//       const credColl = mongoose.connection.collection(credCollName);

//       // build match query
//       let matchedUser = null;
//       if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
//         try {
//           matchedUser = await credColl.findOne({ _id: new mongoose.Types.ObjectId(String(doctorId)) });
//         } catch (e) {
//           console.warn("doctorId lookup failed:", e);
//         }
//       }
//       if (!matchedUser && doctorUsername) {
//         // exact-ish anchored lookup like confirm route
//         const esc = String(doctorUsername).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//         const anchored = `^\\s*${esc}\\s*$`;
//         matchedUser = await credColl.findOne({
//           $or: [
//             { username: { $regex: anchored, $options: "i" } },
//             { user: { $regex: anchored, $options: "i" } },
//             { user_name: { $regex: anchored, $options: "i" } }
//           ]
//         });
//       }

//       if (!matchedUser) {
//         console.warn("Specified doctor not found; saving appointment but skipping direct confirm. doctorId/doctorUsername:", { doctorId, doctorUsername });
//         // fall through to normal notify-doctors flow below (or just return created)
//         // For safety we return created appointment and indicate doctor lookup failed.
//         return res.status(201).json({
//           message: "Appointment stored successfully — doctor not found for direct confirm",
//           appointment: newAppointment,
//           whatsAppOptIn: !!newAppointment.whatsAppOptIn,
//           doctorResolved: false
//         });
//       }

//       // --- create twilio room (best-effort) ---
//       const roomName = `consult_${uuidv4()}`;
//       let twilioRoomData = null;
//       try {
//         if (typeof createTwilioRoom === "function") {
//           twilioRoomData = await createTwilioRoom(roomName);
//         } else {
//           console.warn("createTwilioRoom util not defined - skipping twilio create");
//         }
//       } catch (err) {
//         console.error("Twilio room create error (non-fatal):", err?.message || err);
//         twilioRoomData = null;
//       }

//       // assign doctor and mark confirmed
//       newAppointment.doctorAssigned = matchedUser._id;
//       newAppointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || String(doctorUsername || "");
//       newAppointment.status = "confirmed";
//       newAppointment.confirmedAt = moment().tz("Asia/Kolkata").toDate();

//       const FRONTEND_URL = process.env.FRONTEND_URL || "";
//       const patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${roomName}` : `/consult/${roomName}`;
//       const doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${roomName}` : `/doctor/join/${roomName}`;

//       const nowDate = new Date();
//       const roomSid = twilioRoomData ? (twilioRoomData.roomSid || twilioRoomData.sid || null) : null;
//       newAppointment.twilioRoom = { roomName: roomName, roomSid: roomSid, createdAt: nowDate };
//       newAppointment.twilioRoomPatient = { roomName: roomName, roomSid: roomSid, link: patientLink, createdAt: nowDate };
//       newAppointment.twilioRoomDoctor = { roomName: roomName, roomSid: roomSid, link: doctorLink, createdAt: nowDate };

//       await newAppointment.save();
//       console.log("Appointment directly confirmed and twilio rooms saved:", { id: newAppointment._id });

//       // --- Send WA to patient (only if they opted-in) ---
//       if (newAppointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
//         try {
//           const patientPayload = {
//             to: normalizePhone(newAppointment.phone),
//             campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME || "",
//             templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "",
//             params: [ String(newAppointment.name || "Patient"), newAppointment.doctorAssignedUsername,patientLink ]
//           };
//           console.log("Sending patient video WA (doctor-booking flow):", patientPayload);
//           await sendTemplateMessage(patientPayload);
//           console.log("Patient WA sent (doctor-booking flow) to", newAppointment.phone);
//         } catch (err) {
//           console.error("Patient WA failed (doctor-booking flow):", err?.response?.data || err.message || err);
//         }
//       } else {
//         console.log("Patient not opted-in for WA or sendTemplateMessage missing — skipping patient WA.");
//       }

//       // --- Send WA to matched doctor only ---
//       try {
//         const docMobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
//         const docNorm = normalizePhoneLocal(docMobileRaw);
//         if (docNorm && typeof sendTemplateMessage === "function") {
//           const docPayload = {
//             campaignName: process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN || "",
//             templateName: process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE || "",
//             params: [ String(newAppointment.name || "Patient"), doctorLink ],
//             to: docNorm
//           };
//           console.log("Sending doctor WA (doctor-booking flow):", docPayload);
//           await sendTemplateMessage(docPayload);
//           console.log("Doctor WA sent (doctor-booking flow) to", docNorm);
//         } else {
//           console.warn("Matched doctor has no mobile or sendTemplateMessage not available — doctor WA skipped.");
//         }
//       } catch (err) {
//         console.error("Doctor WA failed (doctor-booking flow):", err?.response?.data || err.message || err);
//       }

//       // respond with appointment (confirmed)
//       return res.status(201).json({
//         message: "Appointment stored and directly confirmed (doctor booked)",
//         appointment: newAppointment,
//         whatsAppOptIn: !!newAppointment.whatsAppOptIn,
//         doctorResolved: true
//       });
//     } // end doctor-initiated flow

//     // ---------- Normal (patient/booked-from-site) flow ----------

//     // --- Prepare doctor list from env fallback ---
//     let doctorList = (process.env.NOTIFY_DOCTORS || "")
//       .split(",")
//       .map(s => s.trim())
//       .filter(Boolean);

//     if (concern && Array.isArray(concern.doctor_phones) && concern.doctor_phones.length) {
//       concern.doctor_phones.forEach(d => {
//         const cleaned = String(d).replace(/\+/g, "").trim();
//         if (cleaned && !doctorList.includes(cleaned)) doctorList.push(cleaned);
//       });
//     }

//     doctorList = doctorList.map(d => String(d).replace(/\+/g, "").trim()).filter(Boolean);

//     // --- Send to patient ONLY if opted-in ---
//     if (newAppointment.whatsAppOptIn) {
//       const patientPayload = {
//         to: newAppointment.phone,
//         templateName: "appointment_confirmation_new",
//         params: [name, date, time, primaryConcern]
//       };

//       // Log payload for AiSensy
//       console.log(">>> calling AiSensy for patient:", patientPayload);
//       sendTemplateMessage(patientPayload)
//         .then(r => console.log("Patient WhatsApp sent:", { to: newAppointment.phone, r }))
//         .catch(e => console.error("Patient WhatsApp error:", { to: newAppointment.phone, err: e.response?.data || e.message || e }));
//     } else {
//       console.log(`>>> Skipping patient WA send; whatsAppOptIn=${newAppointment.whatsAppOptIn}`);
//     }

//     // --- Send to doctors concurrently (unchanged) ---
//     if (doctorList.length) {
//       const sendPromises = doctorList.map(docPhone => {
//         const payload = {
//           campaignName: process.env.AISENSY_DOCTOR_CAMPAIGN ,
//           to: normalizePhoneLocal(docPhone),
//           templateName: "new_patient_notification",
//           params: [ String(name), String(newAppointment._id) ]
//         };

//         console.log(">>> calling AiSensy for doctor:", payload);
//         return sendTemplateMessage(payload)
//           .then(resp => ({ status: "ok", phone: docPhone, resp }))
//           .catch(err => ({ status: "error", phone: docPhone, error: err.response?.data || err.message || String(err) }));
//       });

//       Promise.all(sendPromises)
//         .then(results => {
//           results.forEach(r => {
//             if (r.status === "ok") console.log("Doctor WhatsApp sent:", r.phone);
//             else console.error("Doctor WhatsApp failed:", r.phone, r.error);
//           });
//         })
//         .catch(err => console.error("Bulk notify error:", err));
//     } else {
//       console.warn("No doctor numbers configured in NOTIFY_DOCTORS and no concern.doctor_phones found.");
//     }

//     // Respond — return appointment and opt-in status
//     res.status(201).json({
//       message: "Appointment stored successfully",
//       appointment: newAppointment,
//       whatsAppOptIn: !!newAppointment.whatsAppOptIn
//     });
//   } catch (error) {
//     console.error("Error saving appointment:", error);
//     res.status(500).json({ error: "Server error while saving appointment" });
//   }
// });


// main POST route: create appointment

  router.post("/", async (req, res) => {
    try {
      // DEBUG: log incoming request body and headers
      console.log(">>> DEBUG /api/appointments received body:", JSON.stringify(req.body));
      const {
          name, age, gender, phone, email, primaryConcern, date, time,
          whatsAppOptIn, language, couponCode, doctorId, doctorUsername
      } = req.body;

      console.log(">>> parsed fields:", { name, age, gender, phone, primaryConcern, date, time, whatsAppOptIn, language, doctorId, doctorUsername });

      // minimal validation
      if (!name || !phone || !primaryConcern || !date || !time) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // find concern if you use it
      const concern = await Concern.findOne({ concern: primaryConcern });

      const now = moment().tz("Asia/Kolkata");
      const cdate = now.format("YYYY-MM-DD");
      const ctime = now.format("HH:mm:ss");

      // Normalize phone helper (we already defined one earlier; this local ensures availability)
      function normalizePhoneLocal(p) {
        if (!p) return "";
        let s = String(p).replace(/\D/g, "");
        if (s.length === 10) s = "91" + s;
        return s;
      }
      const normalizedPhone = normalizePhoneLocal(phone);
      console.log(">>> normalizedPhone:", normalizedPhone);

      const newAppointment = new Appointment({
        name,
        age,
        gender,
        phone: normalizedPhone,
        email,
        primaryConcern: concern ? concern._id : null,
        appointment_date: date,
        appointment_time: time,
        cdate,
        ctime,
        whatsAppOptIn: !!whatsAppOptIn,
        whatsAppOptInMethod: whatsAppOptIn ? "website" : null,
        whatsAppOptInTs: whatsAppOptIn ? new Date() : null,
        language: typeof language === "string" && language.trim() !== "" ? language.trim() : null,
        couponCode: typeof couponCode === "string" && couponCode.trim() !== "" ? couponCode.trim() : null,
      });

      await newAppointment.save();
      console.log(">>> appointment saved:", {
        id: newAppointment._id,
        whatsAppOptIn: newAppointment.whatsAppOptIn,
        phone: newAppointment.phone,
        couponCode: newAppointment.couponCode,
      });

      // If booking initiated by a doctor (doctorId or doctorUsername present),
      // confirm and assign directly to that doctor and send links only to patient+that doctor.
      if ((doctorId && String(doctorId).trim()) || (doctorUsername && String(doctorUsername).trim())) {
        console.log("Doctor-initiated booking detected - attempting direct confirm for:", { doctorId, doctorUsername });

        // Find login_credentials collection name dynamically if needed
        let credCollName = "login_credentials";
        try {
          const allCols = await mongoose.connection.db.listCollections().toArray();
          const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
          if (found) credCollName = found.name;
        } catch (e) {
          console.warn("Could not list collections, using default login_credentials");
        }
        const credColl = mongoose.connection.collection(credCollName);

        // build match query
        let matchedUser = null;
        if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
          try {
            matchedUser = await credColl.findOne({ _id: new mongoose.Types.ObjectId(String(doctorId)) });
          } catch (e) {
            console.warn("doctorId lookup failed:", e);
          }
        }
        if (!matchedUser && doctorUsername) {
          // exact-ish anchored lookup like confirm route
          const esc = String(doctorUsername).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const anchored = `^\\s*${esc}\\s*$`;
          matchedUser = await credColl.findOne({
            $or: [
              { username: { $regex: anchored, $options: "i" } },
              { user: { $regex: anchored, $options: "i" } },
              { user_name: { $regex: anchored, $options: "i" } }
            ]
          });
        }

        if (!matchedUser) {
          console.warn("Specified doctor not found; saving appointment but skipping direct confirm. doctorId/doctorUsername:", { doctorId, doctorUsername });
          // fall through to normal notify-doctors flow below (or just return created)
          return res.status(201).json({
            message: "Appointment stored successfully — doctor not found for direct confirm",
            appointment: newAppointment,
            whatsAppOptIn: !!newAppointment.whatsAppOptIn,
            doctorResolved: false
          });
        }

        // --- create twilio room (best-effort) ---
        const roomName = `consult_${uuidv4()}`;
        let twilioRoomData = null;
        try {
          if (typeof createTwilioRoom === "function") {
            twilioRoomData = await createTwilioRoom(roomName);
          } else {
            console.warn("createTwilioRoom util not defined - skipping twilio create");
          }
        } catch (err) {
          console.error("Twilio room create error (non-fatal):", err?.message || err);
          twilioRoomData = null;
        }

        // assign doctor and mark confirmed
        newAppointment.doctorAssigned = matchedUser._id;
        newAppointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || String(doctorUsername || "");
        newAppointment.status = "confirmed";
        newAppointment.confirmedAt = moment().tz("Asia/Kolkata").toDate();

        const FRONTEND_URL = process.env.FRONTEND_URL || "";
        const patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${roomName}` : `/consult/${roomName}`;
        // const doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${roomName}` : `/doctor/join/${roomName}`;
        const doctorLink = FRONTEND_URL
        ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${matchedUser._id}&doctorUsername=${encodeURIComponent(
            newAppointment.doctorAssignedUsername
          )}`
        : `/doctor/join/${roomName}?doctorId=${matchedUser._id}&doctorUsername=${encodeURIComponent(
            newAppointment.doctorAssignedUsername
          )}`;
      


        const nowDate = new Date();
        const roomSid = twilioRoomData ? (twilioRoomData.roomSid || twilioRoomData.sid || null) : null;
        newAppointment.twilioRoom = { roomName: roomName, roomSid: roomSid, createdAt: nowDate };
        newAppointment.twilioRoomPatient = { roomName: roomName, roomSid: roomSid, link: patientLink, createdAt: nowDate };
        newAppointment.twilioRoomDoctor = { roomName: roomName, roomSid: roomSid, link: doctorLink, createdAt: nowDate };

        await newAppointment.save();
        console.log("Appointment directly confirmed and twilio rooms saved:", { id: newAppointment._id });

        // --- Prepare displayTime for messages ---
        const tz = process.env.GOOGLE_CALENDAR_TZ || "Asia/Kolkata";
        let displayTime = "";
        try {
          let dt = moment.tz(`${newAppointment.appointment_date} ${newAppointment.appointment_time}`, "YYYY-MM-DD HH:mm:ss", tz);
          if (!dt.isValid()) dt = moment.tz(`${newAppointment.appointment_date} ${newAppointment.appointment_time}`, "YYYY-MM-DD HH:mm", tz);
          if (!dt.isValid()) dt = moment.tz(`${newAppointment.appointment_date}T${newAppointment.appointment_time}`, tz);
          displayTime = dt.isValid() ? dt.format("h:mm A [on] DD MMM YYYY") : (newAppointment.appointment_time || "");
        } catch (e) {
          displayTime = newAppointment.appointment_time || "";
        }

        const patientName = String(newAppointment.name || "Patient");
        const doctorNameForMsg = newAppointment.doctorAssignedUsername || (matchedUser.username || matchedUser.user || matchedUser.user_name || "");

        // --- Send WA to patient (only if they opted-in) ---
        // if (newAppointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
        //   try {
        //     // patient template expects: [ patientName, doctorName, time, link ]
        //     const patientPayload = {
        //       to: normalizePhone(newAppointment.phone),
        //       campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME || "",
        //       templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "",
        //       params: [ patientName, doctorNameForMsg, displayTime, patientLink ]
        //     };
        //     console.log("Sending patient video WA (doctor-booking flow):", patientPayload);
        //     await sendTemplateMessage(patientPayload);
        //     console.log("Patient WA sent (doctor-booking flow) to", newAppointment.phone);
        //   } catch (err) {
        //     console.error("Patient WA failed (doctor-booking flow):", err?.response?.data || err.message || err);
        //   }
        // } else {
        //   console.log("Patient not opted-in for WA or sendTemplateMessage missing — skipping patient WA.");
        // }

        if (newAppointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
          try {
            const patientPayload = {
              to: normalizePhone(newAppointment.phone),
              templateName: "patient_appointment_with_time",
              language: "en",
              params: [
                patientName,
                doctorNameForMsg,
                displayTime,
                patientLink
              ]
            };
        
            console.log("Sending Superfone patient WA:", patientPayload);
            await sendTemplateMessage(patientPayload);
            console.log("Patient WA sent (Superfone)");
          } catch (err) {
            console.error("Patient WA failed:", err?.response?.data || err.message || err);
          }
        }

        // --- Send WA to matched doctor only ---
        try {
          const docMobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
          const docNorm = normalizePhoneLocal(docMobileRaw);
          if (docNorm && typeof sendTemplateMessage === "function") {
            // doctor template expects: [ doctorName, patientName, time, link ]
            const docPayload = {
              to: docNorm,
              templateName: "twilio_doctor_with_time_new",
              language: "en",
              params: [
                doctorNameForMsg,
                patientName,
                displayTime,
                doctorLink
              ]
            };
            
            console.log("Sending Superfone doctor WA:", docPayload);
            await sendTemplateMessage(docPayload);
            console.log("Doctor WA sent (doctor-booking flow) to", docNorm);
          } else {
            console.warn("Matched doctor has no mobile or sendTemplateMessage not available — doctor WA skipped.");
          }
        } catch (err) {
          console.error("Doctor WA failed (doctor-booking flow):", err?.response?.data || err.message || err);
        }

          // --- create Google Calendar event with doctor as attendee (non-blocking) ---
          (async () => {
            try {
              // Determine a likely doctor email for the calendar attendee
              const doctorEmailCandidate =
                (matchedUser && (matchedUser.email || matchedUser.user_email)) ||
                (newAppointment.doctorAssignedUsername && String(newAppointment.doctorAssignedUsername).includes("@")
                  ? newAppointment.doctorAssignedUsername
                  : null);
    
              // createCalendarEventUsingOAuth should accept (appointment, doctorEmail) and return calendar event data
              if (typeof createCalendarEventUsingOAuth === "function") {
                const calData = await createCalendarEventUsingOAuth(newAppointment, doctorEmailCandidate);
                if (calData) {
                  // Attach to appointment and persist
                  newAppointment.calendarEventId = calData.id || null;
                  newAppointment.calendarEventLink = calData.htmlLink || calData.htmlLink || null;
                  await newAppointment.save();
                  console.log("Doctor booking: calendar event created and saved on appointment:", {
                    appointmentId: newAppointment._id,
                    calendarEventId: newAppointment.calendarEventId,
                    calendarEventLink: newAppointment.calendarEventLink
                  });
                } else {
                  console.warn("Doctor booking: createCalendarEventUsingOAuth returned no data.");
                }
              } else {
                console.warn("createCalendarEventUsingOAuth util not available - skipping calendar creation for doctor booking.");
              }
            } catch (calErr) {
              console.warn("Doctor booking: background calendar create failed:", calErr?.message || calErr);
            }
          })();

        // respond with appointment (confirmed)
        return res.status(201).json({
          message: "Appointment stored and directly confirmed (doctor booked)",
          appointment: newAppointment,
          whatsAppOptIn: !!newAppointment.whatsAppOptIn,
          doctorResolved: true
        });
      } // end doctor-initiated flow

      // ---------- Normal (patient/booked-from-site) flow ----------

      // --- Prepare doctor list from env fallback ---
      let doctorList = (process.env.NOTIFY_DOCTORS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      if (concern && Array.isArray(concern.doctor_phones) && concern.doctor_phones.length) {
        concern.doctor_phones.forEach(d => {
          const cleaned = String(d).replace(/\+/g, "").trim();
          if (cleaned && !doctorList.includes(cleaned)) doctorList.push(cleaned);
        });
      }

      doctorList = doctorList.map(d => String(d).replace(/\+/g, "").trim()).filter(Boolean);

      // --- Format time for patient message (AM/PM, India) ---
  const tz = "Asia/Kolkata";
  let displayTime = "";

  try {
    let dt = moment.tz(
      `${newAppointment.appointment_date} ${newAppointment.appointment_time}`,
      ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"],
      tz
    );

    displayTime = dt.isValid()
      ? dt.format("h:mm A") // 11:27 PM
      : newAppointment.appointment_time;
  } catch (e) {
    displayTime = newAppointment.appointment_time;
  }



      // --- Send to patient ONLY if opted-in ---
      if (newAppointment.whatsAppOptIn) {
        const patientPayload = {
          to: newAppointment.phone,
          templateName: "appointment_confirmation_news_s",
          language: "en_US",
          params: [name, date, displayTime , primaryConcern]
        };



        // Log payload for AiSensy
        console.log(">>> calling AiSensy for patient:", patientPayload);
        sendTemplateMessage(patientPayload)
          .then(r => console.log("Patient WhatsApp sent:", { to: newAppointment.phone, r }))
          .catch(e => console.error("Patient WhatsApp error:", { to: newAppointment.phone, err: e.response?.data || e.message || e }));
      } else {
        console.log(`>>> Skipping patient WA send; whatsAppOptIn=${newAppointment.whatsAppOptIn}`);
      }

      // --- Send to doctors concurrently (unchanged unless they use video templates) ---
      if (doctorList.length) {
        const sendPromises = doctorList.map(docPhone => {
          const payload = {
            templateName: "confirmation_link",
            language: "en_US",
            params: [
              String(name),
              String(newAppointment._id)
            ],  // ✅ comma added
            to: normalizePhoneLocal(docPhone),
          };

          console.log(">>> calling AiSensy for doctor:", payload);
          return sendTemplateMessage(payload)
            .then(resp => ({ status: "ok", phone: docPhone, resp }))
            .catch(err => ({ status: "error", phone: docPhone, error: err.response?.data || err.message || String(err) }));
        });

        Promise.all(sendPromises)
          .then(results => {
            results.forEach(r => {
              if (r.status === "ok") console.log("Doctor WhatsApp sent:", r.phone);
              else console.error("Doctor WhatsApp failed:", r.phone, r.error);
            });
          })
          .catch(err => console.error("Bulk notify error:", err));
      } else {
        console.warn("No doctor numbers configured in NOTIFY_DOCTORS and no concern.doctor_phones found.");
      }

      // Respond — return appointment and opt-in status
      res.status(201).json({
        message: "Appointment stored successfully",
        appointment: newAppointment,
        whatsAppOptIn: !!newAppointment.whatsAppOptIn
      });
    } catch (error) {
      console.error("Error saving appointment:", error);
      res.status(500).json({ error: "Server error while saving appointment" });
    }
  });


// router.post("/doctor", async (req, res) => {
//   try {
//     const { username, doctorId } = req.body || {};

//     if (!username && !doctorId) {
//       return res.status(400).json({ success: false, message: "username or doctorId required" });
//     }

//     const orConditions = [];

//     // If doctorId looks like an ObjectId, match doctorAssigned by ObjectId equality
//     if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
//       try {
//         orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(String(doctorId)) });
//       } catch (e) {
//         console.warn("Invalid doctorId (skipping doctorAssigned match):", doctorId, e);
//       }
//     }

//     // If username provided, match against doctorAssignedUsername (string field)
//     if (username && String(username).trim()) {
//       const esc = String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       orConditions.push({ doctorAssignedUsername: { $regex: new RegExp(`^${esc}$`, "i") } });
//     }

//     if (!orConditions.length) {
//       return res.json({ success: true, count: 0, appointments: [] });
//     }

//     // Query (safe): find appointments that match either objectId equality or username text match
//     const appointments = await Appointment.find({ $or: orConditions })
//       .populate({ path: "primaryConcern", select: "concern" })
//       .sort({ cdate: -1, ctime: -1, createdAt: -1 })
//       .lean();

//     // Resolve any doctorAssigned ObjectId -> username by looking up login_credentials collection
//     const doctorIdStrings = [
//       ...new Set(
//         appointments
//           .map((a) => {
//             const d = a.doctorAssigned;
//             if (!d) return null;
//             return typeof d === "string" ? d : String(d);
//           })
//           .filter(Boolean)
//           .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
//       ),
//     ];

//     let doctorMap = {};
//     if (doctorIdStrings.length) {
//       const allCols = await mongoose.connection.db.listCollections().toArray();
//       const found = allCols.find((c) => String(c.name).trim().toLowerCase() === "login_credentials");
//       const credCollName = found ? found.name : "login_credentials";
//       const credColl = mongoose.connection.collection(credCollName);

//       const creds = await credColl
//         .find({ _id: { $in: doctorIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
//         .project({ _id: 1, username: 1, user: 1, user_name: 1 })
//         .toArray();

//       creds.forEach((c) => {
//         const uname = c.username || c.user || c.user_name || "";
//         doctorMap[String(c._id)] = uname;
//       });
//     }

//     // Shape the response and include couponCode and twilioRoom.roomName
//     const shaped = appointments.map((a) => {
//       const docId = a.doctorAssigned ? (typeof a.doctorAssigned === "string" ? a.doctorAssigned : String(a.doctorAssigned)) : null;
//       const usernameResolved = (docId && doctorMap[docId]) || (a.doctorAssignedUsername || null) || null;

//       return {
//         _id: a._id,
//         name: a.name,
//         age: a.age,
//         gender: a.gender,
//         phone: a.phone,
//         email: a.email,
//         primaryConcern: a.primaryConcern ? a.primaryConcern.concern : null,
//         appointment_date: a.appointment_date,
//         appointment_time: a.appointment_time,
//         cdate: a.cdate,
//         ctime: a.ctime,
//         language: a.language,
//         status: a.status,
//         transferredTo:a.transferredTo,
//         transferredFrom:a.transferred,

//         // ObjectId string (if present)
//         doctorAssigned: docId || null,
//         // resolved username (preferred) or whatever was stored
//         doctorAssignedUsername: usernameResolved || (username ? username : null),
//         // ✅ new: couponCode
//         couponCode: a.couponCode || null,
//         // ✅ new: twilio room name (if stored)
//         twilioRoomName: a.twilioRoom && a.twilioRoom.roomName ? a.twilioRoom.roomName : null,
//         chief_complaints: a.chiefComplaint,
//         notes: a.enquiryNotes,

//       };
//     });

//     return res.json({ success: true, count: shaped.length, appointments: shaped });
//   } catch (err) {
//     console.error("Error in POST /api/appointments/doctor:", err);
//     return res.status(500).json({ success: false, message: "Server error fetching doctor appointments" });
//   }
// });


// router.post("/doctor", async (req, res) => {
//   try {
//     const { username, doctorId } = req.body || {};

//     if (!username && !doctorId) {
//       return res.status(400).json({ success: false, message: "username or doctorId required" });
//     }

//     const orConditions = [];

//     // If doctorId looks like an ObjectId, match doctorAssigned by ObjectId equality
//     if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
//       try {
//         orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(String(doctorId)) });
//       } catch (e) {
//         console.warn("Invalid doctorId (skipping doctorAssigned match):", doctorId, e);
//       }
//     }

//     // If username provided, match against doctorAssignedUsername (string field)
//     if (username && String(username).trim()) {
//       const esc = String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       orConditions.push({ doctorAssignedUsername: { $regex: new RegExp(`^${esc}$`, "i") } });
//     }

//     if (!orConditions.length) {
//       return res.json({ success: true, count: 0, appointments: [] });
//     }

//     // Fetch appointments matching either condition
//     const appointments = await Appointment.find({ $or: orConditions })
//       .populate({ path: "primaryConcern", select: "concern name" })
//       .sort({ cdate: -1, ctime: -1, createdAt: -1 })
//       .lean();

//     // ---- Batch-resolve clinic ids (transferredTo / transferredFrom) ----
//     const clinicIdStrings = [
//       ...new Set(
//         appointments
//           .flatMap((a) => {
//             const out = [];
//             if (a.transferredTo) {
//               out.push(typeof a.transferredTo === "string" ? a.transferredTo : (a.transferredTo._id ? String(a.transferredTo._id) : null));
//             }
//             if (a.transferredFrom) {
//               out.push(typeof a.transferredFrom === "string" ? a.transferredFrom : (a.transferredFrom._id ? String(a.transferredFrom._id) : null));
//             }
//             return out.filter(Boolean);
//           })
//           .filter((s) => /^[0-9a-fA-F]{24}$/.test(String(s)))
//       ),
//     ];

//     let clinicMap = {};
//     if (clinicIdStrings.length) {
//       try {
//         const clinicsDocs = await Clinic.find({ _id: { $in: clinicIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
//           .select("clinicName name")
//           .lean();
//         clinicsDocs.forEach((c) => {
//           clinicMap[String(c._id)] = c.clinicName || c.name || String(c._id);
//         });
//       } catch (e) {
//         console.warn("Failed to load clinic names for appointments:", e);
//       }
//     }

//     // ---- Batch-resolve doctorAssigned ObjectIds -> username from login_credentials ----
//     const doctorIdStrings = [
//       ...new Set(
//         appointments
//           .map((a) => {
//             const d = a.doctorAssigned;
//             if (!d) return null;
//             return typeof d === "string" ? d : String(d);
//           })
//           .filter(Boolean)
//           .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
//       ),
//     ];

//     let doctorMap = {};
//     if (doctorIdStrings.length) {
//       try {
//         // login_credentials collection name might vary. find it defensively.
//         const allCols = await mongoose.connection.db.listCollections().toArray();
//         const found = allCols.find((c) => String(c.name).trim().toLowerCase() === "login_credentials");
//         const credCollName = found ? found.name : "login_credentials";
//         const credColl = mongoose.connection.collection(credCollName);

//         const creds = await credColl
//           .find({ _id: { $in: doctorIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
//           .project({ _id: 1, username: 1, user: 1, user_name: 1 })
//           .toArray();

//         creds.forEach((c) => {
//           const uname = c.username || c.user || c.user_name || "";
//           doctorMap[String(c._id)] = uname;
//         });
//       } catch (e) {
//         console.warn("Failed to resolve doctorAssigned usernames:", e);
//       }
//     }

//     // ---- Shape final response ----
//     const shaped = appointments.map((a) => {
//       const docId = a.doctorAssigned ? (typeof a.doctorAssigned === "string" ? a.doctorAssigned : String(a.doctorAssigned)) : null;
//       const usernameResolved = (docId && doctorMap[docId]) || (a.doctorAssignedUsername || null) || null;

//       const tToId = a.transferredTo ? (typeof a.transferredTo === "string" ? a.transferredTo : (a.transferredTo._id ? String(a.transferredTo._id) : null)) : null;
//       const tFromId = a.transferredFrom ? (typeof a.transferredFrom === "string" ? a.transferredFrom : (a.transferredFrom._id ? String(a.transferredFrom._id) : null)) : null;

//       return {
//         _id: a._id,
//         name: a.name,
//         age: a.age,
//         gender: a.gender,
//         phone: a.phone,
//         email: a.email,
//         primaryConcern: a.primaryConcern ? (a.primaryConcern.concern || a.primaryConcern.name || a.primaryConcern) : null,
//         appointment_date: a.appointment_date,
//         appointment_time: a.appointment_time,
//         cdate: a.cdate,
//         ctime: a.ctime,
//         language: a.language,
//         status: a.status,

//         // Raw ids (string) kept for reference
//         transferredTo: tToId || null,
//         transferredFrom: tFromId || null,

//         // Human-friendly names (preferred)
//         transferredToName: tToId ? (clinicMap[tToId] || tToId) : null,
//         transferredFromName: tFromId ? (clinicMap[tFromId] || tFromId) : null,

//         doctorAssigned: docId || null,
//         doctorAssignedUsername: usernameResolved || (username ? username : null),

//         couponCode: a.couponCode || null,
//         twilioRoomName: a.twilioRoom && a.twilioRoom.roomName ? a.twilioRoom.roomName : null,
//         chief_complaints: a.chiefComplaint || null,
//         notes: a.enquiryNotes || null,
//       };
//     });

//     return res.json({ success: true, count: shaped.length, appointments: shaped });
//   } catch (err) {
//     console.error("Error in POST /api/appointments/doctor:", err);
//     return res.status(500).json({ success: false, message: "Server error fetching doctor appointments" });
//   }
// });

router.post("/doctor", async (req, res) => {
  try {
    const { username, doctorId } = req.body || {};

    if (!username && !doctorId) {
      return res.status(400).json({ success: false, message: "username or doctorId required" });
    }

    const orConditions = [];

    if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
      try {
        orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(String(doctorId)) });
      } catch (e) {
        console.warn("Invalid doctorId (skipping doctorAssigned match):", doctorId, e);
      }
    }

    if (username && String(username).trim()) {
      const esc = String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      orConditions.push({ doctorAssignedUsername: { $regex: new RegExp(`^${esc}$`, "i") } });
    }

    if (!orConditions.length) {
      return res.json({ success: true, count: 0, appointments: [] });
    }

    const appointments = await Appointment.find({ $or: orConditions })
      .populate({ path: "primaryConcern", select: "concern name" })
      .sort({ cdate: -1, ctime: -1, createdAt: -1 })
      .lean();

    // Collect clinic id strings from transferredTo / transferredFrom
    const clinicIdStrings = [
      ...new Set(
        appointments
          .flatMap((a) => {
            const out = [];
            if (a.transferredTo) {
              out.push(typeof a.transferredTo === "string" ? a.transferredTo : (a.transferredTo._id ? String(a.transferredTo._id) : null));
            }
            if (a.transferredFrom) {
              out.push(typeof a.transferredFrom === "string" ? a.transferredFrom : (a.transferredFrom._id ? String(a.transferredFrom._id) : null));
            }
            return out.filter(Boolean);
          })
          .filter((s) => /^[0-9a-fA-F]{24}$/.test(String(s)))
      ),
    ];

    let clinicMap = {};

    if (clinicIdStrings.length) {
      try {
        // Try to find the most likely clinic collection name(s)
        const collList = await mongoose.connection.db.listCollections().toArray();
        const candidateNames = [
          "Zeromedixine_clinic_details",
          "zeromedixine_clinic_details",
          "zeromedixine_clinic_details".toLowerCase(),
          "Zeromedixine_clinic_details".toLowerCase(),
          "clinic_details",
          "clinicdetail",
          "clinic_details".toLowerCase(),
          "clinics",
          "clinic",
        ];

        // find any candidate that actually exists in the DB
        const foundNames = [];
        for (const c of collList) {
          const name = String(c.name || "").trim();
          if (!name) continue;
          const low = name.toLowerCase();
          if (candidateNames.some((cand) => cand.toLowerCase() === low)) {
            foundNames.push(name);
          }
        }

        // If none found, try to heuristically pick a collection name containing "clinic"
        if (foundNames.length === 0) {
          for (const c of collList) {
            const name = String(c.name || "").trim();
            if (/clinic/i.test(name)) {
              foundNames.push(name);
            }
          }
        }

        // If still none, fallback to "Zeromedixine_clinic_details" (may error if not present)
        if (foundNames.length === 0) {
          foundNames.push("Zeromedixine_clinic_details");
        }

        // Query all found clinic-like collections and build map
        for (const collName of foundNames) {
          try {
            const coll = mongoose.connection.collection(collName);
            // ask only for documents whose _id in our list
            const docs = await coll
              .find({ _id: { $in: clinicIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
              .project({ _id: 1, clinicName: 1, name: 1, clinic_name: 1 })
              .toArray();

            docs.forEach((d) => {
              const idStr = String(d._id);
              // prefer clinicName, then clinic_name, then name, then id
              const display = d.clinicName || d.clinic_name || d.name || idStr;
              clinicMap[idStr] = display;
            });
          } catch (e) {
            // ignore collection errors and continue to next candidate
            console.warn(`Unable to query clinics from collection ${collName}:`, e.message || e);
          }
        }
      } catch (e) {
        console.warn("Failed to load clinic names:", e);
      }
    }

    // Resolve doctorAssigned usernames (same strategy as before)
    const doctorIdStrings = [
      ...new Set(
        appointments
          .map((a) => {
            const d = a.doctorAssigned;
            if (!d) return null;
            return typeof d === "string" ? d : String(d);
          })
          .filter(Boolean)
          .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
      ),
    ];

    let doctorMap = {};
    if (doctorIdStrings.length) {
      try {
        const allCols = await mongoose.connection.db.listCollections().toArray();
        const found = allCols.find((c) => String(c.name).trim().toLowerCase() === "login_credentials");
        const credCollName = found ? found.name : "login_credentials";
        const credColl = mongoose.connection.collection(credCollName);

        const creds = await credColl
          .find({ _id: { $in: doctorIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
          .project({ _id: 1, username: 1, user: 1, user_name: 1 })
          .toArray();

        creds.forEach((c) => {
          const uname = c.username || c.user || c.user_name || "";
          doctorMap[String(c._id)] = uname;
        });
      } catch (e) {
        console.warn("Failed to resolve doctorAssigned usernames:", e);
      }
    }

    // shape response
    const shaped = appointments.map((a) => {
      const docId = a.doctorAssigned ? (typeof a.doctorAssigned === "string" ? a.doctorAssigned : String(a.doctorAssigned)) : null;
      const usernameResolved = (docId && doctorMap[docId]) || (a.doctorAssignedUsername || null) || null;

      const tToId = a.transferredTo ? (typeof a.transferredTo === "string" ? a.transferredTo : (a.transferredTo._id ? String(a.transferredTo._id) : null)) : null;
      const tFromId = a.transferredFrom ? (typeof a.transferredFrom === "string" ? a.transferredFrom : (a.transferredFrom._id ? String(a.transferredFrom._id) : null)) : null;

      return {
        _id: a._id,
        name: a.name,
        age: a.age,
        gender: a.gender,
        phone: a.phone,
        email: a.email,
        primaryConcern: a.primaryConcern ? (a.primaryConcern.concern || a.primaryConcern.name || a.primaryConcern) : null,
        appointment_date: a.appointment_date,
        appointment_time: a.appointment_time,
        cdate: a.cdate,
        ctime: a.ctime,
        language: a.language,
        status: a.status,

        // raw ids
        transferredTo: tToId || null,
        transferredFrom: tFromId || null,

        // resolved human-friendly names, fallback to raw id if mapping missing
        transferredToName: tToId ? (clinicMap[tToId] || tToId) : null,
        transferredFromName: tFromId ? (clinicMap[tFromId] || tFromId) : null,

        doctorAssigned: docId || null,
        doctorAssignedUsername: usernameResolved || (username ? username : null),

        couponCode: a.couponCode || null,
        twilioRoomName: a.twilioRoom && a.twilioRoom.roomName ? a.twilioRoom.roomName : null,
        chief_complaints: a.chiefComplaint || null,
        notes: a.enquiryNotes || null,
      };
    });

    return res.json({ success: true, count: shaped.length, appointments: shaped });
  } catch (err) {
    console.error("Error in POST /api/appointments/doctor:", err);
    return res.status(500).json({ success: false, message: "Server error fetching doctor appointments" });
  }
});


// POST /api/appointments/enquiries
// payload: { patientId, chiefComplaint, notes, sessions, updatedBy } 
// - patientId = appointment._id (string)
// - updatedBy = optional username/objectId of the doctor/admin doing the enquiry

router.post("/enquiries", async (req, res) => {
  try {
    const { patientId, chiefComplaint, notes, sessions, updatedBy } = req.body || {};

    if (!patientId) {
      return res.status(400).json({ success: false, message: "patientId is required" });
    }

    const id = sanitizeIdParam(patientId);
    if (!id) return res.status(400).json({ success: false, message: "Invalid patientId" });

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // Update fields on the appointment document.
    // You can adapt names: 'chiefComplaint', 'enquiryNotes', 'sessions' — change if you prefer different field names.
    appt.chiefComplaint = typeof chiefComplaint === "string" ? chiefComplaint.trim() : appt.chiefComplaint;
    appt.enquiryNotes = typeof notes === "string" ? notes.trim() : appt.enquiryNotes;
    appt.sessionsRequested = sessions || appt.sessionsRequested || null;

    // audit fields
    appt.lastEnquiryUpdatedBy = updatedBy || appt.lastEnquiryUpdatedBy || null;
    appt.lastEnquiryUpdatedAt = new Date();

    // Optionally keep an array of enquiry history (uncomment if you want history)
    /*
    appt.enquiryHistory = appt.enquiryHistory || [];
    appt.enquiryHistory.push({
      chiefComplaint: appt.chiefComplaint,
      enquiryNotes: appt.enquiryNotes,
      sessionsRequested: appt.sessionsRequested,
      updatedBy: appt.lastEnquiryUpdatedBy,
      updatedAt: appt.lastEnquiryUpdatedAt
    });
    */

    await appt.save();

    // Return the updated appointment (shape as you prefer)
    return res.json({
      success: true,
      message: "Enquiry saved on appointment",
      appointment: {
        _id: appt._id,
        chiefComplaint: appt.chiefComplaint,
        enquiryNotes: appt.enquiryNotes,
        sessionsRequested: appt.sessionsRequested,
        lastEnquiryUpdatedBy: appt.lastEnquiryUpdatedBy,
        lastEnquiryUpdatedAt: appt.lastEnquiryUpdatedAt,
        // include other fields if frontend needs them:
        name: appt.name,
        phone: appt.phone,
        status: appt.status,
        doctorAssigned: appt.doctorAssigned
      }
    });
  } catch (err) {
    console.error("Error saving enquiry to appointment:", err);
    return res.status(500).json({ success: false, message: "Server error saving enquiry" });
  }
});



router.get("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: "username and password required" });

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      $or: [
        { username: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user_name: { $regex: new RegExp(`^${esc}$`, "i") } },
        { mobile_no: raw },
        { email: { $regex: new RegExp(`^${esc}$`, "i") } }
      ]
    };

    const user = await LoginCredential.findOne(query).lean();
    if (!user) return res.status(401).json({ success: false, message: "Invalid username or password" });

    const stored = user.password || "";
    let passwordMatches = false;

    // bcrypt hash detection
    if (/^\$2[ayb]\$/.test(stored)) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      // legacy plaintext fallback
      passwordMatches = stored === password;
      // if matches plaintext -> re-hash & update (migration)
      if (passwordMatches) {
        try {
          const newHash = await bcrypt.hash(password, 12);
          await LoginCredential.updateOne({ _id: user._id }, { $set: { password: newHash } });
          console.log("Migrated password to bcrypt for user:", user._id);
        } catch (e) {
          console.warn("Password migration failed for", user._id, e);
        }
      }
    }

    if (!passwordMatches) return res.status(401).json({ success: false, message: "Invalid username or password" });

    // sign token
    let token = null;
    if (process.env.JWT_SECRET) {
      token = jwt.sign(
        { id: user._id.toString(), username: user.username || user.user || user.user_name || null, role: user.role || "doctor" },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || "8h" }
      );
    }

    // set secure httpOnly cookie (frontend should call withCredentials: true)
    if (token) {
      res.cookie("access_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
      });
    }

    const safeUser = {
      _id: user._id,
      username: user.username || user.user || user.user_name || null,
      email: user.email || null,
      mobile_no: user.mobile_no || null,
      role: user.role || "doctor",
    };

    return res.json({ success: true, user: safeUser, token: token || null });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
});


// this is important fallback to notify doctors it username is wrong in confirm appointment by doctor
// router.post("/:id/confirm", async (req, res) => {
//   try {
//     const rawId = req.params.id;
//     const id = sanitizeIdParam(rawId);
//     if (!id) return res.status(400).json({ message: "Invalid id" });

//     const usernameRaw = typeof req.body.username === "string" ? req.body.username.trim() : null;
//     if (!usernameRaw) return res.status(400).json({ message: "username is required in body" });

//     console.log(`Confirm request for appointment ${id} initiated by input "${usernameRaw}"`);

//     const appointment = await Appointment.findById(id);
//     if (!appointment) return res.status(404).json({ message: "Appointment not found" });

//     if (appointment.status && String(appointment.status).toLowerCase() === "confirmed") {
//       return res.status(409).json({
//         message: "Appointment already confirmed",
//         appointment: {
//           _id: appointment._id,
//           status: appointment.status,
//           doctorAssigned: appointment.doctorAssigned || null,
//           doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//           confirmedAt: appointment.confirmedAt || null,
//           twilioRoomPatient: appointment.twilioRoomPatient || null,
//           twilioRoomDoctor: appointment.twilioRoomDoctor || null
//         }
//       });
//     }

//     // --- Robust user lookup in login_credentials (multiple heuristics) ---
//     // find actual collection name (defensive)
//     let credCollName = "login_credentials";
//     try {
//       const allCols = await mongoose.connection.db.listCollections().toArray();
//       const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
//       if (found) credCollName = found.name;
//     } catch (e) {
//       // proceed with default
//     }

//     const credColl = mongoose.connection.collection(credCollName);
//     const esc = usernameRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//     let matchedUser = null;

//     // 1) loose case-insensitive search across common username/email fields
//     try {
//       matchedUser = await credColl.findOne({
//         $or: [
//           { username: { $regex: esc, $options: 'i' } },
//           { user: { $regex: esc, $options: 'i' } },
//           { user_name: { $regex: esc, $options: 'i' } },
//           { login: { $regex: esc, $options: 'i' } },
//           { email: { $regex: esc, $options: 'i' } }
//         ]
//       });
//     } catch (e) {
//       console.warn("Loose credential search failed:", e.message || e);
//     }

//     // 2) anchored exact-trim match
//     if (!matchedUser) {
//       try {
//         const escTrim = `^\\s*${esc}\\s*$`;
//         matchedUser = await credColl.findOne({
//           $or: [
//             { username: { $regex: escTrim, $options: 'i' } },
//             { user: { $regex: escTrim, $options: 'i' } },
//             { user_name: { $regex: escTrim, $options: 'i' } }
//           ]
//         });
//       } catch (e) {
//         // ignore
//       }
//     }

//     // 3) objectId match
//     if (!matchedUser) {
//       const maybeId = (usernameRaw.match(/^[0-9a-fA-F]{24}$/) || [null])[0];
//       if (maybeId) {
//         try {
//           matchedUser = await credColl.findOne({ _id: new mongoose.Types.ObjectId(maybeId) });
//         } catch (e) { /* ignore */ }
//       }
//     }

//     // 4) phone/mobile matching
//     if (!matchedUser) {
//       try {
//         const digits = usernameRaw.replace(/\D/g, "");
//         const candidates = [usernameRaw, digits, (digits.length === 10 ? "91" + digits : null)].filter(Boolean);
//         matchedUser = await credColl.findOne({
//           $or: [
//             { mobile_no: { $in: candidates } },
//             { mobile: { $in: candidates } },
//             { phone: { $in: candidates } },
//             { mobileno: { $in: candidates } }
//           ]
//         });
//       } catch (e) { /* ignore */ }
//     }

//     if (matchedUser) {
//       console.log("User lookup SUCCESS:", {
//         _id: matchedUser._id && matchedUser._id.toString(),
//         username: matchedUser.username || matchedUser.user || matchedUser.user_name,
//         mobile_no: matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone
//       });
//     } else {
//       console.warn(`User not found for input "${usernameRaw}". Will fallback to NOTIFY_DOCTORS list.`);
//     }

//     // --- Create Twilio room (best-effort) ---
//     const roomName = `consult_${uuidv4()}`; // unique name
//     let twilioRoomData = null;
//     try {
//       if (typeof createTwilioRoom === "function") {
//         twilioRoomData = await createTwilioRoom(roomName);
//       } else {
//         console.warn("createTwilioRoom util not defined - skipping Twilio API call (will still save roomName).");
//         twilioRoomData = null;
//       }
//       console.log("Twilio room result:", twilioRoomData);
//     } catch (twErr) {
//       console.error("Twilio create failed (continuing):", twErr?.message || twErr);
//       twilioRoomData = null;
//     }

//     // --- Update appointment fields: doctorAssigned, status, confirmedAt, twilio rooms ---
//     if (matchedUser && matchedUser._id) {
//       appointment.doctorAssigned = matchedUser._id;
//       appointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw;
//     } else {
//       appointment.doctorAssigned = null;
//       appointment.doctorAssignedUsername = usernameRaw;
//     }
//     appointment.status = "confirmed";
//     appointment.confirmedAt = moment().tz("Asia/Kolkata").toDate();

//     const FRONTEND_URL = process.env.FRONTEND_URL || "";
//     const patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${roomName}` : `/consult/${roomName}`;
//     const doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${roomName}` : `/doctor/join/${roomName}`;

//     if (twilioRoomData) {
//       const now = new Date();
//       const roomSid = twilioRoomData.roomSid || twilioRoomData.sid || null;

//       const patientRoomObj = {
//         roomName: roomName,
//         roomSid: roomSid,
//         link: patientLink,
//         createdAt: now
//       };
//       const doctorRoomObj = {
//         roomName: roomName,
//         roomSid: roomSid,
//         link: doctorLink,
//         createdAt: now
//       };

//       appointment.twilioRoomPatient = patientRoomObj;
//       appointment.twilioRoomDoctor = doctorRoomObj;
//       appointment.twilioRoom = { roomName: roomName, roomSid: roomSid, createdAt: now }; // legacy
//     } else {
//       // no roomSid — still store the name so frontend can construct links if needed
//       const now = new Date();
//       const patientRoomObj = { roomName: roomName, roomSid: null, link: patientLink, createdAt: now };
//       const doctorRoomObj = { roomName: roomName, roomSid: null, link: doctorLink, createdAt: now };
//       appointment.twilioRoomPatient = patientRoomObj;
//       appointment.twilioRoomDoctor = doctorRoomObj;
//       appointment.twilioRoom = { roomName: roomName, roomSid: null, createdAt: now };
//     }

//     await appointment.save();
//     console.log("Appointment updated to confirmed:", { id: appointment._id.toString(), doctorAssigned: appointment.doctorAssigned });

//     // --- Messaging: patient WA (if opted-in) ---
//     const patientName = String(appointment.name || "Patient");
//     const doctorNameFormatted = appointment.doctorAssignedUsername || usernameRaw;

//     if (appointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
//       try {
//         const patientPayload = {
//           to: normalizePhone(appointment.phone || ""),
//           campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME || "",
//           templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "",
//           params: [ patientName, patientLink, doctorNameFormatted ]
//         };
//         await sendTemplateMessage(patientPayload);
//         console.log("Patient WhatsApp sent:", appointment.phone);
//       } catch (err) {
//         console.error("Patient WhatsApp failed:", err?.response?.data || err.message || err);
//       }
//     } else {
//       if (!appointment.whatsAppOptIn) console.log("Patient is not opted into WhatsApp - skipping patient WA.");
//       if (typeof sendTemplateMessage !== "function") console.warn("sendTemplateMessage util not available - patient WA not sent.");
//     }

//     // --- Messaging: doctor WA (matched user or fallback NOTIFY_DOCTORS) ---
//     let doctorPhonesToNotify = [];

//     if (matchedUser) {
//       const mobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
//       const normalized = normalizePhone(mobileRaw);
//       if (normalized) doctorPhonesToNotify.push(normalized);
//     } else {
//       const doctorList = (process.env.NOTIFY_DOCTORS || "")
//         .split(",").map(s => s.replace(/\+/g,"").trim()).filter(Boolean);
//       doctorList.forEach(d => {
//         const n = normalizePhone(d);
//         if (n) doctorPhonesToNotify.push(n);
//       });
//     }

//     if (doctorPhonesToNotify.length > 0 && typeof sendTemplateMessage === "function") {
//       try {
//         const docPayloadBase = {
//           campaignName: process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN || "",
//           templateName: process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE || "",
//           params: [ patientName, doctorLink ]
//         };

//         if (doctorPhonesToNotify.length > 1) {
//           const sends = doctorPhonesToNotify.map(dp => {
//             const payload = { ...docPayloadBase, to: dp };
//             return sendTemplateMessage(payload)
//               .then(r => ({ ok: true, phone: dp, res: r }))
//               .catch(e => ({ ok: false, phone: dp, err: e }));
//           });
//           const results = await Promise.all(sends);
//           results.forEach(r => r.ok ? console.log("Doctor WA sent (fallback):", r.phone) : console.error("Doctor WA failed (fallback):", r.phone, r.err));
//         } else {
//           const dp = doctorPhonesToNotify[0];
//           const payload = { ...docPayloadBase, to: dp };
//           await sendTemplateMessage(payload);
//           console.log("Doctor WhatsApp sent to:", dp);
//         }
//       } catch (err) {
//         console.error("Doctor WhatsApp failed:", err?.response?.data || err.message || err);
//       }
//     } else {
//       if (doctorPhonesToNotify.length === 0) console.warn("No doctor phone numbers available to notify.");
//       if (typeof sendTemplateMessage !== "function") console.warn("sendTemplateMessage util not available - doctor WA not sent.");
//     }

//     // --- Shape response for frontend convenience ---
//     const shaped = {
//       _id: appointment._id,
//       name: appointment.name,
//       age: appointment.age,
//       gender: appointment.gender,
//       phone: appointment.phone,
//       email: appointment.email,
//       primaryConcern: appointment.primaryConcern,
//       appointment_date: appointment.appointment_date,
//       appointment_time: appointment.appointment_time,
//       language: appointment.language,
//       status: appointment.status,
//       doctorAssigned: appointment.doctorAssigned,
//       doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//       confirmedAt: appointment.confirmedAt,
//       twilioRoomPatient: appointment.twilioRoomPatient || null,
//       twilioRoomDoctor: appointment.twilioRoomDoctor || null
//     };
//  // Non-blocking: create Google Calendar event with doctor as attendee only
//  (async () => {
//   try {
//     const doctorEmailCandidate = (matchedUser && (matchedUser.email || matchedUser.user_email)) ||
//       (appointment.doctorAssignedUsername && String(appointment.doctorAssignedUsername).includes("@") ? appointment.doctorAssignedUsername : null);

//     const calData = await createCalendarEventUsingOAuth(appointment, doctorEmailCandidate);
//     if (calData) {
//       appointment.calendarEventId = calData.id || null;
//       appointment.calendarEventLink = calData.htmlLink || calData.htmlLink || null;
//       await appointment.save();
//     }
//   } catch (e) {
//     console.warn("Background calendar error:", e?.message || e);
//   }
// })();

// return res.json({ message: "Appointment confirmed", appointment: shaped });

// } catch (err) {
// console.error("Error in confirm route:", err);
// return res.status(500).json({ message: "Server error while confirming appointment", error: String(err) });
// }
// });


// this is important not fallback to notify doctors it username is wrong in confirm appointment by doctor

// Replace existing confirm route with this
// router.post("/:id/confirm", async (req, res) => {
//   try {
//     const rawId = req.params.id;
//     const id = sanitizeIdParam(rawId);
//     if (!id) return res.status(400).json({ message: "Invalid id" });

//     const usernameRaw = typeof req.body.username === "string" ? req.body.username.trim() : null;
//     if (!usernameRaw) return res.status(400).json({ message: "username is required in body" });

//     console.log(`Confirm request for appointment ${id} initiated by input "${usernameRaw}"`);

//     const appointment = await Appointment.findById(id);
//     if (!appointment) return res.status(404).json({ message: "Appointment not found" });

//     if (appointment.status && String(appointment.status).toLowerCase() === "confirmed") {
//       return res.status(409).json({
//         message: "Appointment already confirmed",
//         appointment: {
//           _id: appointment._id,
//           status: appointment.status,
//           doctorAssigned: appointment.doctorAssigned || null,
//           doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//           confirmedAt: appointment.confirmedAt || null,
//           twilioRoomPatient: appointment.twilioRoomPatient || null,
//           twilioRoomDoctor: appointment.twilioRoomDoctor || null
//         }
//       });
//     }

//     // --- Strict username validation: require exact (anchored) match ---
//     let credCollName = "login_credentials";
//     try {
//       const allCols = await mongoose.connection.db.listCollections().toArray();
//       const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
//       if (found) credCollName = found.name;
//     } catch (e) {
//       // proceed with default if listCollections fails
//     }

//     const credColl = mongoose.connection.collection(credCollName);
//     // Build anchored, case-insensitive regex for exact-match intent
//     const esc = usernameRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//     const anchored = `^\\s*${esc}\\s*$`;

//     const matchedUser = await credColl.findOne({
//       $or: [
//         { username: { $regex: anchored, $options: "i" } },
//         { user: { $regex: anchored, $options: "i" } },
//         { user_name: { $regex: anchored, $options: "i" } }
//       ]
//     });

//     if (!matchedUser) {
//       console.warn(`Username not found for input "${usernameRaw}". Confirmation aborted.`);
//       return res.status(404).json({
//         message: "Username not found — confirmation aborted. Please enter your exact username."
//       });
//     }

//     console.log("User lookup SUCCESS:", {
//       _id: matchedUser._id && matchedUser._id.toString(),
//       username: matchedUser.username || matchedUser.user || matchedUser.user_name,
//       mobile_no: matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone
//     });

//     // --- Create Twilio room (best-effort) ---
//     const roomName = `consult_${uuidv4()}`;
//     let twilioRoomData = null;
//     try {
//       if (typeof createTwilioRoom === "function") {
//         twilioRoomData = await createTwilioRoom(roomName);
//       } else {
//         console.warn("createTwilioRoom util not defined - skipping Twilio API call (will still save roomName).");
//         twilioRoomData = null;
//       }
//       console.log("Twilio room result:", twilioRoomData);
//     } catch (twErr) {
//       console.error("Twilio create failed (continuing):", twErr?.message || twErr);
//       twilioRoomData = null;
//     }

//     // --- Update appointment fields: doctorAssigned, status, confirmedAt, twilio rooms ---
//     appointment.doctorAssigned = matchedUser._id;
//     appointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw;
//     appointment.status = "confirmed";
//     appointment.confirmedAt = moment().tz("Asia/Kolkata").toDate();

//     const FRONTEND_URL = process.env.FRONTEND_URL || "";
//     const patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${roomName}` : `/consult/${roomName}`;
//     const doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${roomName}` : `/doctor/join/${roomName}`;

//     if (twilioRoomData) {
//       const now = new Date();
//       const roomSid = twilioRoomData.roomSid || twilioRoomData.sid || null;

//       const patientRoomObj = { roomName: roomName, roomSid: roomSid, link: patientLink, createdAt: now };
//       const doctorRoomObj = { roomName: roomName, roomSid: roomSid, link: doctorLink, createdAt: now };

//       appointment.twilioRoomPatient = patientRoomObj;
//       appointment.twilioRoomDoctor = doctorRoomObj;
//       appointment.twilioRoom = { roomName: roomName, roomSid: roomSid, createdAt: now };
//     } else {
//       const now = new Date();
//       const patientRoomObj = { roomName: roomName, roomSid: null, link: patientLink, createdAt: now };
//       const doctorRoomObj = { roomName: roomName, roomSid: null, link: doctorLink, createdAt: now };
//       appointment.twilioRoomPatient = patientRoomObj;
//       appointment.twilioRoomDoctor = doctorRoomObj;
//       appointment.twilioRoom = { roomName: roomName, roomSid: null, createdAt: now };
//     }

//     await appointment.save();
//     console.log("Appointment updated to confirmed:", { id: appointment._id.toString(), doctorAssigned: appointment.doctorAssigned });

//     // --- Messaging: patient WA (if opted-in) ---
//     const patientName = String(appointment.name || "Patient");
//     const doctorNameFormatted = appointment.doctorAssignedUsername || (matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw);

//     if (appointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
//       try {
//         const mobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
//         const normalizedDoctorMobile = normalizePhone(mobileRaw);
//         // patient payload, use patientLink and doctorNameFormatted
//         const patientPayload = {
//           to: normalizePhone(appointment.phone || ""),
//           campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME || "",
//           templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "",
//           params: [ patientName, patientLink, doctorNameFormatted ]
//         };
//         await sendTemplateMessage(patientPayload);
//         console.log("Patient WhatsApp sent:", appointment.phone);
//       } catch (err) {
//         console.error("Patient WhatsApp failed:", err?.response?.data || err.message || err);
//       }
//     } else {
//       if (!appointment.whatsAppOptIn) console.log("Patient is not opted into WhatsApp - skipping patient WA.");
//       if (typeof sendTemplateMessage !== "function") console.warn("sendTemplateMessage util not available - patient WA not sent.");
//     }

//     // --- Messaging: doctor WA (send to the matched doctor's mobile, only) ---
//     try {
//       const docMobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
//       const docNorm = normalizePhone(docMobileRaw);
//       if (docNorm && typeof sendTemplateMessage === "function") {
//         const docPayload = {
//           campaignName: process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN || "",
//           templateName: process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE || "",
//           params: [ patientName, doctorLink ],
//           to: docNorm
//         };
//         await sendTemplateMessage(docPayload);
//         console.log("Doctor WhatsApp sent to matched user:", docNorm);
//       } else {
//         console.warn("Matched doctor has no mobile number or sendTemplateMessage missing - doctor WA not sent.");
//       }
//     } catch (err) {
//       console.error("Doctor WhatsApp failed:", err?.response?.data || err.message || err);
//     }

//     // --- Shape response for frontend convenience ---
//     const shaped = {
//       _id: appointment._id,
//       name: appointment.name,
//       age: appointment.age,
//       gender: appointment.gender,
//       phone: appointment.phone,
//       email: appointment.email,
//       primaryConcern: appointment.primaryConcern,
//       appointment_date: appointment.appointment_date,
//       appointment_time: appointment.appointment_time,
//       language: appointment.language,
//       status: appointment.status,
//       doctorAssigned: appointment.doctorAssigned,
//       doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//       confirmedAt: appointment.confirmedAt,
//       twilioRoomPatient: appointment.twilioRoomPatient || null,
//       twilioRoomDoctor: appointment.twilioRoomDoctor || null
//     };

//     // Non-blocking: create Google Calendar event with doctor as attendee only
//     (async () => {
//       try {
//         const doctorEmailCandidate = (matchedUser && (matchedUser.email || matchedUser.user_email)) ||
//           (appointment.doctorAssignedUsername && String(appointment.doctorAssignedUsername).includes("@") ? appointment.doctorAssignedUsername : null);

//         const calData = await createCalendarEventUsingOAuth(appointment, doctorEmailCandidate);
//         if (calData) {
//           appointment.calendarEventId = calData.id || null;
//           appointment.calendarEventLink = calData.htmlLink || calData.htmlLink || null;
//           await appointment.save();
//         }
//       } catch (e) {
//         console.warn("Background calendar error:", e?.message || e);
//       }
//     })();

//     return res.json({ message: "Appointment confirmed", appointment: shaped });
//   } catch (err) {
//     console.error("Error in confirm route:", err);
//     return res.status(500).json({ message: "Server error while confirming appointment", error: String(err) });
//   }
// });

router.post("/:id/confirm", async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = sanitizeIdParam(rawId);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const usernameRaw = typeof req.body.username === "string" ? req.body.username.trim() : null;
    if (!usernameRaw) return res.status(400).json({ message: "username is required in body" });

    console.log(`Confirm request for appointment ${id} initiated by input "${usernameRaw}"`);

    const appointment = await Appointment.findById(id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    if (appointment.status && String(appointment.status).toLowerCase() === "confirmed") {
      return res.status(409).json({
        message: "Appointment already confirmed",
        appointment: {
          _id: appointment._id,
          status: appointment.status,
          doctorAssigned: appointment.doctorAssigned || null,
          doctorAssignedUsername: appointment.doctorAssignedUsername || null,
          confirmedAt: appointment.confirmedAt || null,
          twilioRoomPatient: appointment.twilioRoomPatient || null,
          twilioRoomDoctor: appointment.twilioRoomDoctor || null
        }
      });
    }

    // --- Strict username validation: require exact (anchored) match ---
    let credCollName = "login_credentials";
    try {
      const allCols = await mongoose.connection.db.listCollections().toArray();
      const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
      if (found) credCollName = found.name;
    } catch (e) {
      // proceed with default if listCollections fails
    }

    const credColl = mongoose.connection.collection(credCollName);
    const esc = usernameRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchored = `^\\s*${esc}\\s*$`;

    const matchedUser = await credColl.findOne({
      $or: [
        { username: { $regex: anchored, $options: "i" } },
        { user: { $regex: anchored, $options: "i" } },
        { user_name: { $regex: anchored, $options: "i" } }
      ]
    });

    if (!matchedUser) {
      console.warn(`Username not found for input "${usernameRaw}". Confirmation aborted.`);
      return res.status(404).json({
        message: "Username not found — confirmation aborted. Please enter your exact username."
      });
    }

    console.log("User lookup SUCCESS:", {
      _id: matchedUser._id && matchedUser._id.toString(),
      username: matchedUser.username || matchedUser.user || matchedUser.user_name,
      mobile_no: matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone
    });

    // --- Create Twilio room (best-effort) ---
    const roomName = `consult_${uuidv4()}`;
    let twilioRoomData = null;
    try {
      if (typeof createTwilioRoom === "function") {
        twilioRoomData = await createTwilioRoom(roomName);
      } else {
        console.warn("createTwilioRoom util not defined - skipping Twilio API call (will still save roomName).");
        twilioRoomData = null;
      }
      console.log("Twilio room result:", twilioRoomData);
    } catch (twErr) {
      console.error("Twilio create failed (continuing):", twErr?.message || twErr);
      twilioRoomData = null;
    }

    // --- Update appointment fields: doctorAssigned, status, confirmedAt, twilio rooms ---
    appointment.doctorAssigned = matchedUser._id;
    appointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw;
    appointment.status = "confirmed";
    appointment.confirmedAt = moment().tz("Asia/Kolkata").toDate();

    const FRONTEND_URL = process.env.FRONTEND_URL || "";
    const patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${roomName}` : `/consult/${roomName}`;
    // const doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${roomName}` : `/doctor/join/${roomName}`;
    
    const doctorUsernameFinal =
    appointment.doctorAssignedUsername ||
    matchedUser.username ||
    matchedUser.user ||
    matchedUser.user_name ||
    usernameRaw;
  
  const doctorLink = FRONTEND_URL
    ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${matchedUser._id}&doctorUsername=${encodeURIComponent(
        doctorUsernameFinal
      )}`
    : `/doctor/join/${roomName}?doctorId=${matchedUser._id}&doctorUsername=${encodeURIComponent(
        doctorUsernameFinal
      )}`;
  
    if (twilioRoomData) {
      const now = new Date();
      const roomSid = twilioRoomData.roomSid || twilioRoomData.sid || null;

      const patientRoomObj = {
        roomName: roomName,
        roomSid: roomSid,
        link: patientLink,
        createdAt: now
      };
      const doctorRoomObj = {
        roomName: roomName,
        roomSid: roomSid,
        link: doctorLink,
        createdAt: now
      };

      appointment.twilioRoomPatient = patientRoomObj;
      appointment.twilioRoomDoctor = doctorRoomObj;
      appointment.twilioRoom = { roomName: roomName, roomSid: roomSid, createdAt: now }; // legacy
    } else {
      const now = new Date();
      const patientRoomObj = { roomName: roomName, roomSid: null, link: patientLink, createdAt: now };
      const doctorRoomObj = { roomName: roomName, roomSid: null, link: doctorLink, createdAt: now };
      appointment.twilioRoomPatient = patientRoomObj;
      appointment.twilioRoomDoctor = doctorRoomObj;
      appointment.twilioRoom = { roomName: roomName, roomSid: null, createdAt: now };
    }

    await appointment.save();
    console.log("Appointment updated to confirmed:", { id: appointment._id.toString(), doctorAssigned: appointment.doctorAssigned });

    // --- Messaging: patient WA (if opted-in) ---
    const patientName = String(appointment.name || "Patient");
    const doctorNameFormatted = appointment.doctorAssignedUsername || (matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw);

    // prepare displayTime
    const tz = process.env.GOOGLE_CALENDAR_TZ || "Asia/Kolkata";
    let displayTime = "";
    try {
      let dt = moment.tz(`${appointment.appointment_date} ${appointment.appointment_time}`, "YYYY-MM-DD HH:mm:ss", tz);
      if (!dt.isValid()) dt = moment.tz(`${appointment.appointment_date} ${appointment.appointment_time}`, "YYYY-MM-DD HH:mm", tz);
      if (!dt.isValid()) dt = moment.tz(`${appointment.appointment_date}T${appointment.appointment_time}`, tz);
      displayTime = dt.isValid()
      ? dt.format("h:mm A [on] DD MMM YYYY")
      : (appointment.appointment_time || "");
        } catch (e) {
      displayTime = appointment.appointment_time || "";
    }

    // if (appointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
    //   try {
    //     // patient template expects: [ patientName, doctorName, time, link ]
    //     const patientPayload = {
    //       to: normalizePhone(appointment.phone || ""),
    //       campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME || "",
    //       templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "",
    //       params: [ patientName, doctorNameFormatted, displayTime, patientLink ]
    //     };
    //     await sendTemplateMessage(patientPayload);
    //     console.log("Patient WhatsApp sent:", appointment.phone);
    //   } catch (err) {
    //     console.error("Patient WhatsApp failed:", err?.response?.data || err.message || err);
    //   }
    // } 

    if (appointment.whatsAppOptIn && typeof sendTemplateMessage === "function") {
      try {
        const patientPayload = {
          to: normalizePhone(appointment.phone || ""),
          templateName: "patient_appointment_with_time",
          language: "en_US",
          params: [
            patientName,           // {{1}}
            doctorNameFormatted,   // {{2}}
            displayTime,           // {{3}}
            patientLink            // {{4}}
          ]
        };
    
        console.log("Sending Superfone patient WA:", patientPayload);
        await sendTemplateMessage(patientPayload);
        console.log("Patient WhatsApp sent via Superfone:", appointment.phone);
    
      } catch (err) {
        console.error("Patient WhatsApp failed:", err?.response?.data || err.message || err);
      }
    }
    
    else {
      if (!appointment.whatsAppOptIn) console.log("Patient is not opted into WhatsApp - skipping patient WA.");
      if (typeof sendTemplateMessage !== "function") console.warn("sendTemplateMessage util not available - patient WA not sent.");
    }

    // --- Messaging: doctor WA (send to the matched doctor's mobile, only) ---
    // try {
    //   const docMobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
    //   const docNorm = normalizePhone(docMobileRaw);
    //   if (docNorm && typeof sendTemplateMessage === "function") {
    //     // doctor template expects: [ doctorName, patientName, time, link ]
    //     const docPayload = {
    //       campaignName: process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN || "",
    //       templateName: process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE || "",
    //       params: [ doctorNameFormatted || (process.env.CLINIC_NAME || "Doctor"), patientName, displayTime, doctorLink ],
    //       to: docNorm
    //     };
    //     await sendTemplateMessage(docPayload);
    //     console.log("Doctor WhatsApp sent to matched user:", docNorm);
    //   } else {
    //     console.warn("Matched doctor has no mobile number or sendTemplateMessage missing - doctor WA not sent.");
    //   }
    // } catch (err) {
    //   console.error("Doctor WhatsApp failed:", err?.response?.data || err.message || err);
    // }

    try {
      const docMobileRaw = (matchedUser.mobile_no || matchedUser.mobile || matchedUser.phone || "").toString();
      const docNorm = normalizePhone(docMobileRaw);
    
      if (docNorm && typeof sendTemplateMessage === "function") {
    
        const docPayload = {
          to: docNorm,
          templateName: "twilio_doctor_with_time_new",
          language: "en_US",
          params: [
            doctorNameFormatted,  // {{1}}
            patientName,          // {{2}}
            displayTime,          // {{3}}
            doctorLink            // {{4}}
          ]
        };
    
        console.log("Sending Superfone doctor WA:", docPayload);
        await sendTemplateMessage(docPayload);
        console.log("Doctor WhatsApp sent via Superfone:", docNorm);
    
      } else {
        console.warn("Doctor mobile missing or sendTemplateMessage unavailable.");
      }
    
    } catch (err) {
      console.error("Doctor WhatsApp failed:", err?.response?.data || err.message || err);
    }

    // --- Non-blocking: create Google Calendar event with doctor as attendee only ---
    (async () => {
      try {
        const doctorEmailCandidate = (matchedUser && (matchedUser.email || matchedUser.user_email)) ||
          (appointment.doctorAssignedUsername && String(appointment.doctorAssignedUsername).includes("@") ? appointment.doctorAssignedUsername : null);

        const calData = await createCalendarEventUsingOAuth(appointment, doctorEmailCandidate);
        if (calData) {
          appointment.calendarEventId = calData.id || null;
          appointment.calendarEventLink = calData.htmlLink || calData.htmlLink || null;
          await appointment.save();
        }
      } catch (e) {
        console.warn("Background calendar error:", e?.message || e);
      }
    })();

    // Shape response for frontend convenience
    const shaped = {
      _id: appointment._id,
      name: appointment.name,
      age: appointment.age,
      gender: appointment.gender,
      phone: appointment.phone,
      email: appointment.email,
      primaryConcern: appointment.primaryConcern,
      appointment_date: appointment.appointment_date,
      appointment_time: appointment.appointment_time,
      language: appointment.language,
      status: appointment.status,
      doctorAssigned: appointment.doctorAssigned,
      doctorAssignedUsername: appointment.doctorAssignedUsername || null,
      confirmedAt: appointment.confirmedAt,
      twilioRoomPatient: appointment.twilioRoomPatient || null,
      twilioRoomDoctor: appointment.twilioRoomDoctor || null
    };

    return res.json({ message: "Appointment confirmed", appointment: shaped });
  } catch (err) {
    console.error("Error in confirm route:", err);
    return res.status(500).json({ message: "Server error while confirming appointment", error: String(err) });
  }
});



// POST /api/appointments/:id/add-session
router.post("/:id/add-session", async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = sanitizeIdParam(rawId);
    if (!id) return res.status(400).json({ success: false, message: "Invalid appointment ID" });

    const { sessionId, notes, assignedBy } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // Initialize array if not present
    if (!Array.isArray(appt.sessionsAssigned)) appt.sessionsAssigned = [];

    appt.sessionsAssigned.push({
      sessionId,
      notes: notes || "",
      assignedBy: assignedBy || null,
      assignedAt: new Date()
    });

    await appt.save();

    return res.json({
      success: true,
      message: "Session added successfully",
      appointment: appt
    });

  } catch (err) {
    console.error("Error in /add-session:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



// GET /api/appointments/:id
// router.get("/:id", async (req, res) => {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).json({ success: false, message: "Missing id" });

//     const appt = await Appointment.findById(id).lean();
//     if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

//     return res.json({ success: true, appointment: appt });
//   } catch (err) {
//     console.error("GET appointment error:", err);
//     return res.status(500).json({ success: false, message: "Server error" });
//   }
// });

router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, message: "Missing id" });

    // Try populate for common refs (if schema has refs)
    let appt = await Appointment.findById(id)
      .populate({ path: "primaryConcern", select: "concern name" })
      .populate({ path: "transferredFrom", select: "clinicName name" })
      .lean();

    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // primaryConcernDisplay (prefer populated object)
    if (appt.primaryConcern && typeof appt.primaryConcern === "object") {
      appt.primaryConcernDisplay = appt.primaryConcern.concern || appt.primaryConcern.name || appt.primaryConcern._id;
    } else if (appt.primaryConcern) {
      // fallback lookup
      try {
        const c = await Concern.findById(appt.primaryConcern).lean();
        appt.primaryConcernDisplay = c ? (c.concern || c.name || c._id) : appt.primaryConcern;
      } catch (e) {
        appt.primaryConcernDisplay = appt.primaryConcern;
      }
    } else {
      appt.primaryConcernDisplay = "Not specified";
    }

    // transferredFromName logic:
    // Cases:
    // - appt.transferredFrom is an object (populated or only _id)
    // - appt.transferredFrom is a string id
    let transferredFromId = null;
    if (appt.transferredFrom) {
      if (typeof appt.transferredFrom === "object") {
        // if populate succeeded and gave clinicName, use it
        if (appt.transferredFrom.clinicName || appt.transferredFrom.name) {
          appt.transferredFromName = appt.transferredFrom.clinicName || appt.transferredFrom.name;
        } else if (appt.transferredFrom._id) {
          transferredFromId = String(appt.transferredFrom._id);
        }
      } else {
        transferredFromId = String(appt.transferredFrom);
      }
    }

    // If we still need the clinic name, do an explicit lookup using the clinic id
    if (!appt.transferredFromName && transferredFromId) {
      try {
        const clinicDoc = await Clinic.findById(transferredFromId).select("clinicName name").lean();
        appt.transferredFromName = clinicDoc ? (clinicDoc.clinicName || clinicDoc.name || clinicDoc._id) : transferredFromId;
      } catch (e) {
        appt.transferredFromName = transferredFromId;
      }
    }

    // Default if nothing found
    if (!appt.transferredFromName) appt.transferredFromName = "Zeromedixine";

    return res.json({ success: true, appointment: appt });
  } catch (err) {
    console.error("GET appointment error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



// POST /api/appointments/transfer-to-clinic
// router.post("/transfer-to-clinic", async (req, res) => {
//   try {
//     const { appointmentId, clinicId, clinicName, transferNotes, patientData } = req.body;

//     if (!appointmentId || !clinicId || !clinicName) {
//       return res.status(400).json({ 
//         success: false, 
//         message: "appointmentId, clinicId, and clinicName are required" 
//       });
//     }

//     // 1. Find the appointment
//     const appointment = await Appointment.findById(appointmentId);
//     if (!appointment) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Appointment not found" 
//       });
//     }

//     // 2. Find the clinic
//     const clinic = await Clinic.findById(clinicId);
//     if (!clinic) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Clinic not found" 
//       });
//     }

//     // 3. Create clinic patient record
//     const clinicPatient = new ClinicPatient({
//       clinic: clinicId,
//       clinic_name: clinicName,
//       name: patientData.name || appointment.name,
//       mobile: patientData.mobile || appointment.phone,
//       email: patientData.email || appointment.email || "",
//       age: patientData.age || appointment.age || null,
//       gender: patientData.gender || appointment.gender || "other",
//       address: patientData.address || appointment.address || "",
//       notes: patientData.notes || transferNotes || "",
//       treatment: patientData.treatment || appointment.primaryConcern || "General Consultation",
//       treatmentDate: patientData.treatmentDate ? new Date(patientData.treatmentDate) : new Date(),
//       treatmentTime: patientData.treatmentTime || new Date().toTimeString().split(' ')[0].substring(0, 5),
//       transferredFrom: "zeromedixine_appointment"
//     });

//     await clinicPatient.save();

//       // 4. Update appointment status
//       appointment.status = "transferred";
//       appointment.transferredTo = clinicId;
//       appointment.transferNotes = transferNotes || "";
//       appointment.transferredAt = new Date();
//       await appointment.save();
  
//       // -------------------------------
//       // Notify destination clinic via AiSensy (WhatsApp) - best-effort non-blocking
//       // -------------------------------
//       (async () => {
//         try {
//           if (typeof sendTemplateMessage !== "function") {
//             console.warn("sendTemplateMessage not available — skipping transfer WhatsApp notify to destination clinic.");
//             return;
//           }
  
//           // find clinic phone - try common fields on your Clinic model
//           const rawPhone = String(
//             clinic.ownerNumber ||
//             clinic.contact ||
//             clinic.phone ||
//             clinic.mobile ||
//             clinic.owner_phone ||
//             ""
//           ).trim();
  
//           function normalizePhone(p) {
//             if (!p) return "";
//             let s = String(p).replace(/\D/g, "");
//             if (s.length === 10) s = "91" + s;
//             return s;
//           }
//           const destination = normalizePhone(rawPhone);
//           if (!destination) {
//             console.warn("Destination clinic has no phone configured — skipping WhatsApp notify.");
//             return;
//           }
  
//           // Build confirm link for the clinic (frontend route)
//           const FRONTEND = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
//           const confirmLink = `${FRONTEND}/transfers/confirm_clinic/${appointment._id}`;
  
//           // Which clinic name to show? Use source info (Zeromedixine) since this is a transfer from Zeromedixine
//           // If you want the source clinic name from a different field, change SOURCE_NAME accordingly
//           const SOURCE_NAME = process.env.BUSINESS_NAME || "Zeromedixine";
  
//           // vars order from env (so it matches AiSensy template placeholders)
//           // e.g. AISENSY_TRANSFER_TEMPLATE_VARS=sourceClinicName,link,patientName,patientPhone
//           const varsEnv = (process.env.AISENSY_TRANSFER_TEMPLATE_VARS || "sourceClinicName,link").split(",").map(s => s.trim()).filter(Boolean);
  
//           // map of possible template values
//           const varsMap = {
//             sourceClinicName: String(SOURCE_NAME),
//             clinicName: String(clinic.clinicName || clinic.clinic_name || clinic.name || "Clinic"),
//             link: confirmLink,
//             patientName: String(clinicPatient.name || appointment.name || ""),
//             patientPhone: String(clinicPatient.mobile || appointment.phone || ""),
//             appointmentId: String(appointment._id)
//           };
  
//           const templateParams = varsEnv.map(k => (varsMap[k] !== undefined ? varsMap[k] : ""));
  
//           const campaignName = process.env.AISENSY_TRANSFER_CAMPAIGN || process.env.AISENSY_CAMPAIGN_NAME || process.env.AISENSY_CAMPAIGN;
//           if (!campaignName) {
//             console.warn("AISENSY_TRANSFER_CAMPAIGN / AISENSY_CAMPAIGN_NAME not set — skipping WhatsApp notify to destination clinic.");
//             return;
//           }
  
//           const payload = {
//             to: destination,
//             campaignName,
//             templateName: process.env.AISENSY_TRANSFER_TEMPLATE || "transfer_request_new",
//             params: templateParams
//           };
  
//           console.log("Sending transfer notify to destination clinic via AiSensy:", { to: destination, payloadPreview: { campaignName: payload.campaignName, templateName: payload.templateName, params: templateParams } });
  
//           await sendTemplateMessage(payload);
//           console.log("AiSensy transfer notify sent to destination clinic:", destination);
//         } catch (err) {
//           // Non-fatal: log the error (include debug if available)
//           console.error("AiSensy transfer notify to destination clinic failed (non-fatal):", err?.debug || err?.message || err);
//           if (err?.debug?.data) console.error("AiSensy debug data:", err.debug.data);
//         }
//       })();
  
//       // 5. Respond
//       return res.json({
//         success: true,
//         message: `Patient transferred to ${clinicName} successfully`,
//         clinicPatientId: clinicPatient._id,
//         appointment: appointment
//       });
  

//   } catch (err) {
//     console.error("Transfer to clinic error:", err);
//     return res.status(500).json({ 
//       success: false, 
//       message: "Server error during transfer",
//       error: err.message 
//     });
//   }
// });

router.post("/transfer-to-clinic", async (req, res) => {
  try {
    const { appointmentId, clinicId, clinicName, transferNotes, patientData } = req.body;

    if (!appointmentId || !clinicId || !clinicName) {
      return res.status(400).json({ 
        success: false, 
        message: "appointmentId, clinicId, and clinicName are required" 
      });
    }

    // 1. Find the appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ 
        success: false, 
        message: "Appointment not found" 
      });
    }

    // 2. Find the clinic
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ 
        success: false, 
        message: "Clinic not found" 
      });
    }

    // 3. Create clinic patient record
    const clinicPatient = new ClinicPatient({
      clinic: clinicId,
      clinic_name: clinicName,
      name: patientData.name || appointment.name,
      mobile: patientData.mobile || appointment.phone,
      email: patientData.email || appointment.email || "",
      age: patientData.age || appointment.age || null,
      gender: patientData.gender || appointment.gender || "other",
      address: patientData.address || appointment.address || "",
      notes: patientData.notes || transferNotes || "",
      treatment: patientData.treatment || appointment.primaryConcern || "General Consultation",
      treatmentDate: patientData.treatmentDate ? new Date(patientData.treatmentDate) : new Date(),
      treatmentTime: patientData.treatmentTime || new Date().toTimeString().split(' ')[0].substring(0, 5),
      transferredFrom: "zeromedixine_appointment"
    });

    await clinicPatient.save();

      // 4. Update appointment status
      appointment.status = "transferred";
      appointment.transferredTo = clinicId;
      appointment.transferNotes = transferNotes || "";
      appointment.transferredAt = new Date();
      await appointment.save();
  
      // -------------------------------
      // Notify destination clinic via AiSensy (WhatsApp) - best-effort non-blocking
      // -------------------------------
     // -------------------------------
// Notify destination clinic via Superfone (WhatsApp)
// -------------------------------
(async () => {
  try {
    if (typeof sendTemplateMessage !== "function") {
      console.warn("sendTemplateMessage not available — skipping transfer WhatsApp notify.");
      return;
    }

    // 1️⃣ Get clinic phone
    const rawPhone = String(
      clinic.ownerNumber ||
      clinic.contact ||
      clinic.phone ||
      clinic.mobile ||
      clinic.owner_phone ||
      ""
    ).trim();

    if (!rawPhone) {
      console.warn("Destination clinic has no phone configured — skipping WhatsApp notify.");
      return;
    }

    // 2️⃣ Build confirm link
    const FRONTEND = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const confirmLink = `${FRONTEND}/transfers/confirm_clinic/${appointment._id}`;

    // 3️⃣ Source clinic name (Zeromedixine)
    const sourceClinicName = process.env.BUSINESS_NAME || "Zeromedixine";

    // 4️⃣ Superfone payload
    const waPayload = {
      to: rawPhone, // send as-is (Superfone handles formatting)
      templateName: process.env.SUPERFONE_TRANSFER_TEMPLATE || "transfer_request_new",
      language: "en",
      params: [
        sourceClinicName,   // {{clinic_name}}
        confirmLink         // {{link}}
      ]
    };

    console.log("📤 Sending Superfone TRANSFER WA:", waPayload);

    await sendTemplateMessage(waPayload);

    console.log("✅ Superfone transfer notify sent to clinic:", rawPhone);

  } catch (err) {
    console.error("❌ Superfone transfer notify failed (non-fatal):", err.message || err);
  }
})();
  
      // 5. Respond
      return res.json({
        success: true,
        message: `Patient transferred to ${clinicName} successfully`,
        clinicPatientId: clinicPatient._id,
        appointment: appointment
      });
  

  } catch (err) {
    console.error("Transfer to clinic error:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server error during transfer",
      error: err.message 
    });
  }
});



// GET /api/clinics
router.get("/clinics", async (req, res) => {
  try {
    const clinics = await Clinic.find({ status: "active" })
      .select("clinicName address specialisation registrationNumber ownerNumber")
      .sort({ clinicName: 1 })
      .lean();

    return res.json({
      success: true,
      count: clinics.length,
      clinics: clinics
    });
  } catch (err) {
    console.error("Error fetching clinics:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server error fetching clinics" 
    });
  }
});


// POST /api/appointments/:id/confirm_transfer
// router.post("/:id/confirm_transfer", async (req, res) => {
//   try {
//     const rawId = req.params.id;
//     const id = sanitizeIdParam(rawId);
//     if (!id) return res.status(400).json({ message: "Invalid id" });

//     const usernameRaw = typeof req.body.username === "string" ? req.body.username.trim() : null;
//     if (!usernameRaw) return res.status(400).json({ message: "username is required in body" });

//     console.log(`Confirm_transfer request for appointment ${id} initiated by input "${usernameRaw}"`);

//     const appointment = await Appointment.findById(id);
//     if (!appointment) return res.status(404).json({ message: "Appointment not found" });

//     if (appointment.status && String(appointment.status).toLowerCase() === "confirmed") {
//       return res.status(409).json({
//         message: "Appointment already confirmed",
//         appointment: {
//           _id: appointment._id,
//           status: appointment.status,
//           doctorAssigned: appointment.doctorAssigned || null,
//           doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//           confirmedAt: appointment.confirmedAt || null
//         }
//       });
//     }

//     // Find login_credentials collection name (robust)
//     let credCollName = "login_credentials";
//     try {
//       const allCols = await mongoose.connection.db.listCollections().toArray();
//       const found = allCols.find(c => String(c.name).trim().toLowerCase() === 'login_credentials');
//       if (found) credCollName = found.name;
//     } catch (e) {
//       // proceed with default if listing fails
//     }
//     const credColl = mongoose.connection.collection(credCollName);

//     // anchored exact-ish match for username/user/user_name fields
//     const esc = usernameRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//     const anchored = `^\\s*${esc}\\s*$`;

//     const matchedUser = await credColl.findOne({
//       $or: [
//         { username: { $regex: anchored, $options: "i" } },
//         { user: { $regex: anchored, $options: "i" } },
//         { user_name: { $regex: anchored, $options: "i" } }
//       ]
//     });

//     if (!matchedUser) {
//       console.warn(`Username not found for input "${usernameRaw}". Confirmation aborted.`);
//       return res.status(404).json({
//         message: "Username not found — confirmation aborted. Please enter the exact username."
//       });
//     }

//     // Update appointment: assign doctor and mark confirmed (no WA/calendar/etc.)
//     appointment.doctorAssigned = matchedUser._id;
//     appointment.doctorAssignedUsername = matchedUser.username || matchedUser.user || matchedUser.user_name || usernameRaw;
//     appointment.status = "confirmed";
//     appointment.confirmedAt = new Date();

//     await appointment.save();
//     console.log("Transfer confirmed (no WA). Appointment updated:", appointment._id.toString());

//     // Shape response for frontend convenience
//     const shaped = {
//       _id: appointment._id,
//       name: appointment.name,
//       age: appointment.age,
//       gender: appointment.gender,
//       phone: appointment.phone,
//       email: appointment.email,
//       primaryConcern: appointment.primaryConcern,
//       appointment_date: appointment.appointment_date,
//       appointment_time: appointment.appointment_time,
//       language: appointment.language,
//       status: appointment.status,
//       doctorAssigned: appointment.doctorAssigned,
//       doctorAssignedUsername: appointment.doctorAssignedUsername || null,
//       confirmedAt: appointment.confirmedAt
//     };

//     return res.json({ message: "Transfer confirmed and doctor assigned", appointment: shaped });
//   } catch (err) {
//     console.error("Error in confirm_transfer route:", err);
//     return res.status(500).json({ message: "Server error while confirming transfer", error: String(err) });
//   }
// });

// POST /api/appointments/:id/confirm_transfer
router.post("/:id/confirm_transfer", async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = sanitizeIdParam(rawId);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const usernameRaw =
      typeof req.body.username === "string" ? req.body.username.trim() : null;
    if (!usernameRaw)
      return res.status(400).json({ message: "username is required in body" });

    console.log(`Confirm_transfer for appointment ${id} by "${usernameRaw}"`);

    const appointment = await Appointment.findById(id);
    if (!appointment)
      return res.status(404).json({ message: "Appointment not found" });

    // prevent double confirm
    if (
      appointment.status &&
      String(appointment.status).toLowerCase() === "confirmed"
    ) {
      return res.status(409).json({
        message: "Appointment already confirmed",
        appointment,
      });
    }

    /* ----------------------------------------
       Find doctor from login_credentials
    ---------------------------------------- */
    let credCollName = "login_credentials";
    try {
      const cols = await mongoose.connection.db.listCollections().toArray();
      const found = cols.find(
        (c) => c.name.trim().toLowerCase() === "login_credentials"
      );
      if (found) credCollName = found.name;
    } catch {}

    const credColl = mongoose.connection.collection(credCollName);

    const esc = usernameRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchored = `^\\s*${esc}\\s*$`;

    const matchedUser = await credColl.findOne({
      $or: [
        { username: { $regex: anchored, $options: "i" } },
        { user: { $regex: anchored, $options: "i" } },
        { user_name: { $regex: anchored, $options: "i" } },
      ],
    });

    if (!matchedUser) {
      return res.status(404).json({
        message: "Username not found — please enter exact doctor username",
      });
    }

    /* ----------------------------------------
       Create Twilio Video Room
    ---------------------------------------- */
    const roomName = `consult_${uuidv4()}`;
    let twilioRoomData = null;

    try {
      if (typeof createTwilioRoom === "function") {
        twilioRoomData = await createTwilioRoom(roomName);
      }
    } catch (err) {
      console.error("Twilio room create error:", err?.message || err);
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || "";
    const patientLink = FRONTEND_URL
      ? `${FRONTEND_URL}/consult/${roomName}`
      : `/consult/${roomName}`;

    const doctorUsername =
      matchedUser.username ||
      matchedUser.user ||
      matchedUser.user_name ||
      usernameRaw;

    const doctorLink = FRONTEND_URL
      ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${matchedUser._id}&doctorUsername=${encodeURIComponent(
          doctorUsername
        )}`
      : `/doctor/join/${roomName}`;

    /* ----------------------------------------
       Update appointment
    ---------------------------------------- */
    const nowDate = new Date();
    const roomSid = twilioRoomData
      ? twilioRoomData.sid || twilioRoomData.roomSid
      : null;

    appointment.doctorAssigned = matchedUser._id;
    appointment.doctorAssignedUsername = doctorUsername;
    appointment.status = "confirmed";
    appointment.confirmedAt = nowDate;

    appointment.twilioRoom = {
      roomName,
      roomSid,
      createdAt: nowDate,
    };

    appointment.twilioRoomPatient = {
      roomName,
      roomSid,
      link: patientLink,
      createdAt: nowDate,
    };

    appointment.twilioRoomDoctor = {
      roomName,
      roomSid,
      link: doctorLink,
      createdAt: nowDate,
    };

    await appointment.save();

    /* ----------------------------------------
       Format time (India)
    ---------------------------------------- */
    const tz = "Asia/Kolkata";
    let displayTime = "";
    try {
      let dt = moment.tz(
        `${appointment.appointment_date} ${appointment.appointment_time}`,
        ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"],
        tz
      );
      displayTime = dt.isValid()
        ? dt.format("h:mm A [on] DD MMM YYYY")
        : appointment.appointment_time;
    } catch {
      displayTime = appointment.appointment_time;
    }

    /* ----------------------------------------
       WhatsApp → Patient
    ---------------------------------------- */
    // if (typeof sendTemplateMessage === "function") {

    //   try {
    //     await sendTemplateMessage({
    //       to: normalizePhone(appointment.phone),
    //       campaignName: process.env.AISENSY_PATIENT_VIDEO_NAME,
    //       templateName: process.env.AISENSY_PATIENT_VIDEO_TEMPLATE,
    //       params: [
    //         appointment.name || "Patient",
    //         doctorUsername,
    //         displayTime,
    //         patientLink,
    //       ],
    //     });
    //     console.log("Patient WA sent (confirm_transfer)");
    //   } catch (err) {
    //     console.error(
    //       "Patient WA failed:",
    //       err?.response?.data || err.message
    //     );
    //   }
    // }
/* ----------------------------------------
   WhatsApp → Patient (Superfone)
---------------------------------------- */
try {
  const patientPhone = normalizePhone(appointment.phone);

  if (patientPhone) {
    const patientParams = [
      appointment.name || "Patient",
      doctorUsername,
      displayTime,
      patientLink
    ];

    console.log("📤 Superfone PATIENT confirm_transfer:", {
      to: patientPhone,
      params: patientParams
    });

    await sendTemplateMessage({
      to: patientPhone,
      templateName: "patient_appointment_with_time",
      language: "en",
      params: patientParams
    });

    console.log("✅ Patient WA sent (confirm_transfer)");
  }
} catch (err) {
  console.error(
    "❌ Patient WA failed:",
    err?.response?.data || err.message || err
  );
}
    /* ----------------------------------------
       WhatsApp → Doctor
    ---------------------------------------- */
    // try {
    //   const docPhone =
    //     matchedUser.mobile_no ||
    //     matchedUser.mobile ||
    //     matchedUser.phone ||
    //     "";
    //   const docNorm = normalizePhoneLocal(docPhone);

    //   if (docNorm && typeof sendTemplateMessage === "function") {
    //     await sendTemplateMessage({
    //       campaignName: process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN,
    //       templateName: process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE,
    //       to: docNorm,
    //       params: [
    //         doctorUsername,
    //         appointment.name || "Patient",
    //         displayTime,
    //         doctorLink,
    //       ],
    //     });
    //     console.log("Doctor WA sent (confirm_transfer)");
    //   }
    // } catch (err) {
    //   console.error("Doctor WA failed:", err?.response?.data || err.message);
    // }

    /* ----------------------------------------
   WhatsApp → Doctor (Superfone)
---------------------------------------- */
try {
  const docPhone =
    matchedUser.mobile_no ||
    matchedUser.mobile ||
    matchedUser.phone ||
    "";

  const docNorm = normalizePhoneLocal(docPhone);

  if (docNorm) {

    const doctorParams = [
      doctorUsername,
      appointment.name || "Patient",
      displayTime,
      doctorLink
    ];

    console.log("📤 Superfone DOCTOR confirm_transfer:", {
      to: docNorm,
      params: doctorParams
    });

    await sendTemplateMessage({
      to: docNorm,
      templateName: "twilio_doctor_with_time_new",
      language: "en",
      params: doctorParams
    });

    console.log("✅ Doctor WA sent (confirm_transfer)");
  }
} catch (err) {
  console.error(
    "❌ Doctor WA failed:",
    err?.response?.data || err.message || err
  );
}

    /* ----------------------------------------
       Response
    ---------------------------------------- */
    return res.json({
      message: "Transfer confirmed, doctor assigned, video links created",
      appointment,
    });
  } catch (err) {
    console.error("Error in confirm_transfer route:", err);
    return res.status(500).json({
      message: "Server error while confirming transfer",
      error: String(err),
    });
  }
});



// POST /api/appointments/transfer-to-doctor
router.post("/transfer-to-doctor", async (req, res) => {
  try {
    const { appointmentId, doctorId, transferReason } = req.body;

    if (!appointmentId || !doctorId) {
      return res.status(400).json({
        success: false,
        message: "appointmentId and doctorId are required"
      });
    }

    // 1. Find appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found"
      });
    }

    // 2. Find doctor
    const credColl = mongoose.connection.collection("login_credentials");
    const doctor = await credColl.findOne({
      _id: new mongoose.Types.ObjectId(doctorId)
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found"
      });
    }

    // 3. Store previous doctor (for audit)
    appointment.transferredFromDoctor = appointment.doctorAssigned || null;

    // 4. Assign new doctor
    appointment.doctorAssigned = doctor._id;
    appointment.doctorAssignedUsername =
      doctor.username || doctor.user || doctor.user_name || "";

    appointment.status = "transferred_doctor";
    appointment.doctorTransferReason = transferReason || "";
    appointment.doctorTransferredAt = new Date();

    await appointment.save();

    return res.json({
      success: true,
      message: "Patient transferred to another doctor successfully",
      appointment: {
        _id: appointment._id,
        doctorAssigned: appointment.doctorAssigned,
        doctorAssignedUsername: appointment.doctorAssignedUsername,
        status: appointment.status
      }
    });
  } catch (err) {
    console.error("Doctor transfer error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during doctor transfer"
    });
  }
});




module.exports = router;
