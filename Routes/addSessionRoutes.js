// Routes/addSessionRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const AddSession = require("../Models/AddSession");
const Appointment = require("../Models/Appointment");
const LoginCred = require("../Models/Logincredential"); // adjust filename if different
// const { sendTemplateMessage } = require("../utils/aisensy"); // reuse your existing util
const { sendTemplateMessage } = require("../utils/superfone");
const twilio = require("twilio");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");


const { createCalendarEventOAuth } = require('../utils/calendar'); // ensure path matches
const { createSessionCalendarEventOAuth } = require("../utils/calendarSession");


// Twilio client init (best-effort; uses env)
const twilioClient = twilio(
  process.env.TWILIO_API_KEY_SID,
  process.env.TWILIO_API_KEY_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

function format12Hour(timeStr) {
  if (!timeStr) return "";
  try {
    const m = moment(timeStr, ["HH:mm", "HH:mm:ss"]);
    return m.isValid() ? m.format("h:mm A") : timeStr;
  } catch (e) {
    return timeStr;
  }
}




// helper to create short tokens (store full UUID too)
function makeToken() {
  return crypto.randomBytes(18).toString("hex");
}


// Helper to normalize phone as you have elsewhere
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

// Routes/addSessionRoutes.js

// POST /api/add_sessions/update-enquiry
router.post("/update-enquiry", async (req, res) => {
  try {
    const { addSessionId, sessionIndex, chiefComplaints, enquiryNotes, updatedBy } = req.body || {};

    if (!addSessionId || !sessionIndex) {
      return res.status(400).json({ success: false, message: "addSessionId and sessionIndex are required" });
    }

    const addSessionDoc = await AddSession.findById(addSessionId);
    if (!addSessionDoc) {
      return res.status(404).json({ success: false, message: "AddSession not found" });
    }

    // Find the specific session by index
    const sessionIndexNum = Number(sessionIndex);
    const sessionToUpdate = addSessionDoc.sessions.find(s => s.index === sessionIndexNum);
    
    if (!sessionToUpdate) {
      return res.status(404).json({ success: false, message: `Session with index ${sessionIndex} not found` });
    }

    // Update the session fields
    sessionToUpdate.chiefComplaints = chiefComplaints || "";
    sessionToUpdate.enquiryNotes = enquiryNotes || "";
    sessionToUpdate.enquiryUpdatedBy = updatedBy || "unknown";
    sessionToUpdate.enquiryUpdatedAt = new Date();

    await addSessionDoc.save();

    return res.json({
      success: true,
      message: "Enquiry updated successfully",
      addSession: addSessionDoc
    });

  } catch (err) {
    console.error("Error in /api/add_sessions/update-enquiry:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server error updating enquiry", 
      error: String(err) 
    });
  }
});



router.get("/available_doctors", async (req, res) => {
  try {
    const docs = await LoginCred.find({}, { username: 1, mobile_no: 1, type: 1 }).sort({ username: 1 }).lean();
    return res.json({ success: true, count: docs.length, doctors: docs });
  } catch (err) {
    console.error("Error fetching doctors:", err);
    return res.status(500).json({ success: false, message: "Server error fetching doctors" });
  }
});




// GET /api/add_sessions/consent?appointmentId=...&sessionId=...
router.get("/consent", async (req, res) => {
  try {
    const { appointmentId, sessionId } = req.query || {};
    if (!appointmentId) return res.status(400).json({ success: false, message: "appointmentId required" });

    // Build match: appointmentId exact
    const match = { appointmentId: null };

    // appointmentId could be ObjectId string
    if (/^[0-9a-fA-F]{24}$/.test(String(appointmentId))) {
      match.appointmentId = new mongoose.Types.ObjectId(String(appointmentId));
    } else {
      match.appointmentId = String(appointmentId);
    }

    // If sessionId provided, match session field too
    if (sessionId) {
      // session field in AddSession schema is an ObjectId referencing Sessions
      if (/^[0-9a-fA-F]{24}$/.test(String(sessionId))) {
        match.session = new mongoose.Types.ObjectId(String(sessionId));
      } else {
        // fallback: match by string if session stored as string
        match.session = String(sessionId);
      }
    }

    // Try findOne
    const doc = await AddSession.findOne(match).lean();
    if (!doc) {
      return res.json({ success: true, consentForm: null, message: "No AddSession found for appointment/session" });
    }

    // consentForm subdoc may be empty object
    const consentForm = doc.consentForm && Object.keys(doc.consentForm).length ? doc.consentForm : null;

    return res.json({ success: true, consentForm });
  } catch (err) {
    console.error("Error in GET /api/add_sessions/consent:", err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});



// Try to require a Sessions model if it exists; if not, we'll fallback to raw collection queries.
let SessionModel = null;
try {
  // update path if your sessions model file uses a different name
  SessionModel = require("../Models/Sessions");
  console.log("Using Sessions model from ../Models/Sessions");
} catch (e) {
  try {
    SessionModel = require("../Models/Session");
    console.log("Using Sessions model from ../Models/Session");
  } catch (err) {
    console.log("No Sessions model file found; will fallback to direct collection queries.");
    SessionModel = null;
  }
}

// helper to sanitize objectId-like strings
function toObjectIdOrNull(s) {
  if (!s) return null;
  try {
    if (/^[0-9a-fA-F]{24}$/.test(String(s).trim())) return new mongoose.Types.ObjectId(String(s).trim());
  } catch (e) { /* ignore */ }
  return null;
}

// helper: try to load session/package either via model or raw collection names
async function findSessionDocById(sid) {
  if (!sid) return null;

  // if we have a model, try that first
  if (SessionModel && typeof SessionModel.findById === "function") {
    try {
      const doc = await SessionModel.findById(sid).lean();
      if (doc) return doc;
    } catch (e) {
      console.warn("SessionModel.findById threw:", e.message || e);
    }
  }

  // fallback: try common collection names
  const candidateNames = ["Sessions", "sessions", "Session", "session"];
  for (const name of candidateNames) {
    try {
      // ensure DB is ready
      if (!mongoose.connection || !mongoose.connection.db) continue;
      const coll = mongoose.connection.db.collection(name);
      if (!coll) continue;
      const obj = await coll.findOne({ _id: new mongoose.Types.ObjectId(String(sid)) });
      if (obj) {
        console.log(`Found session doc in collection "${name}"`);
        return obj;
      }
    } catch (e) {
      // ignore collection not found or invalid id errors
    }
  }

  // final fallback: try scanning collections (only for debugging; can be removed)
  try {
    const cols = await mongoose.connection.db.listCollections().toArray();
    console.log("MongoDB collections:", cols.map(c => c.name).join(", "));
  } catch (e) {
    // ignore
  }

  return null;
}

/**
 * POST /api/add_sessions/create
 * body: {
 *   appointmentId, sessionId, doctorAssigned (optional),
 *   sessions: [{ index:1, date:"YYYY-MM-DD", time:"HH:mm" }, ...],
 *   notes
 * }
 */
router.post("/create", async (req, res) => {
  try {
    const { appointmentId, sessionId, doctorAssigned, sessions = [], notes = "" } = req.body || {};

    // validate ids
    const apptId = toObjectIdOrNull(appointmentId);
    const sid = toObjectIdOrNull(sessionId);
    const docId = toObjectIdOrNull(doctorAssigned);

    if (!apptId || !sid || !docId) {
      return res.status(400).json({ success: false, message: "appointmentId, sessionId and doctorAssigned (ObjectId) are required" });
    }

    // load appointment & session
    const appt = await Appointment.findById(apptId).lean();
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // Try to find sessionDoc using helper (works with or without a Sessions model file)
    const sessionDoc = await findSessionDocById(sid);
    if (!sessionDoc) return res.status(404).json({ success: false, message: "Session/package not found" });

    // sessions_count check (optional but recommended)
    const expectedCount = (sessionDoc.sessions_count && Number(sessionDoc.sessions_count)) || sessions.length;
    if (sessions.length !== expectedCount) {
      console.warn(`Expected ${expectedCount} session entries but got ${sessions.length}. Saving anyway.`);
    }

    // sanitise each session entry and optionally compute scheduledAt Date
    const finalSessions = sessions.map((s, idx) => {
      const dateStr = (s.date || "").toString();
      const timeStr = (s.time || "").toString();
      let scheduledAt = null;
      try {
        if (dateStr && timeStr) {
          scheduledAt = new Date(`${dateStr}T${timeStr}:00`);
          if (isNaN(scheduledAt.getTime())) scheduledAt = null;
        }
      } catch (e) { scheduledAt = null; }
      return {
        index: (s.index || idx + 1),
        date: dateStr,
        time: timeStr,
        scheduledAt
      };
    });

    const doc = new AddSession({
      appointmentId: apptId,
      session: sid,
      doctorAssigned: docId,
      package_snapshot: {
        package_name: sessionDoc.package_name || null,
        sessions_count: sessionDoc.sessions_count || null,
        duration_weeks: sessionDoc.duration_weeks || null,
        concern: sessionDoc.concern || null
      },
      sessions: finalSessions,
      notes: notes || "",
      createdBy: docId // docId is already converted to ObjectId earlier in the route
    });

    await doc.save();

    // attach to Appointment if needed
  

    return res.json({ success: true, message: "Sessions scheduled", addSession: doc });
  } catch (err) {
    console.error("Error in /api/add_sessions/create:", err);
    return res.status(500).json({ success: false, message: "Server error creating sessions", error: String(err) });
  }
});



/**
 * POST /api/add_sessions/fetch_paidsessions_simple
 * Simpler approach to fetch add_sessions with customer data
 */
router.post("/fetch_paidsessions_simple", async (req, res) => {
    try {
      const { username, doctorId, q = "", limit = 200 } = req.body || {};
      
      // Build match conditions (same as before)
      const orConditions = [];
      
      if (doctorId && /^[0-9a-fA-F]{24}$/.test(doctorId.trim())) {
        orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(doctorId.trim()) });
      }
      
      if (username && String(username).trim()) {
        const doctor = await LoginCred.findOne({ 
          username: { $regex: new RegExp(`^${username.trim()}$`, "i") } 
        }).lean();
        
        if (doctor && doctor._id) {
          orConditions.push({ doctorAssigned: doctor._id });
        }
        
        if (/^[0-9a-fA-F]{24}$/.test(username.trim())) {
          orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(username.trim()) });
        }
      }
      
      if (!orConditions.length) {
        return res.json({ success: true, count: 0, sessions: [] });
      }
      
      // First, get the add_sessions
      const addSessions = await AddSession.find({ $or: orConditions })
        .sort({ createdAt: -1 })
        .limit(Number(limit) || 200)
        .lean();
      
      // Get all unique doctor IDs (both doctorAssigned and createdBy)
      const doctorIds = new Set();
      addSessions.forEach(session => {
        if (session.doctorAssigned) doctorIds.add(session.doctorAssigned.toString());
        if (session.createdBy) doctorIds.add(session.createdBy.toString());
      });
      
      // Fetch doctor details
      const doctors = await LoginCred.find({ 
        _id: { $in: Array.from(doctorIds).map(id => new mongoose.Types.ObjectId(id)) } 
      }).lean();
      
      const doctorMap = {};
      doctors.forEach(doctor => {
        doctorMap[doctor._id.toString()] = {
          username: doctor.username,
          name: doctor.name || doctor.username
        };
      });
      
      // Then, enrich with appointment data and doctor names
      const enrichedSessions = await Promise.all(
        addSessions.map(async (session) => {
          try {
            let customerName = "Unknown Customer";
            let customerContact = "No Contact";
            let customerEmail = "No Email";
            
            // Fetch appointment data
            if (session.appointmentId) {
              const appointment = await Appointment.findById(session.appointmentId).lean();
              if (appointment) {
                console.log("Found appointment:", appointment);
                
                // Extract customer name
                if (appointment.customer && appointment.customer.name) {
                  customerName = appointment.customer.name;
                } else if (appointment.name) {
                  customerName = appointment.name;
                } else if (appointment.customerName) {
                  customerName = appointment.customerName;
                }
                
                // Extract customer contact
                if (appointment.customer && appointment.customer.contact) {
                  customerContact = appointment.customer.contact;
                } else if (appointment.customer && appointment.customer.phone) {
                  customerContact = appointment.customer.phone;
                } else if (appointment.phone) {
                  customerContact = appointment.phone;
                } else if (appointment.contact) {
                  customerContact = appointment.contact;
                }
                
                // Extract customer email
                if (appointment.customer && appointment.customer.email) {
                  customerEmail = appointment.customer.email;
                } else if (appointment.email) {
                  customerEmail = appointment.email;
                }
              }
            }
            
            return {
              ...session,
              customer: {
                name: customerName,
                contact: customerContact,
                email: customerEmail
              },
              appointment: {
                _id: session.appointmentId,
                name: customerName,
                phone: customerContact,
                email: customerEmail
              },
              // Add populated doctor information
              doctorAssigned: session.doctorAssigned ? doctorMap[session.doctorAssigned.toString()] : null,
              createdByDoctor: session.createdBy ? doctorMap[session.createdBy.toString()] : null
            };
          } catch (error) {
            console.error("Error enriching session:", error);
            return session;
          }
        })
      );
      
      // Apply search filter if provided
      let filteredSessions = enrichedSessions;
      if (q && q.trim()) {
        const ql = q.trim().toLowerCase();
        filteredSessions = enrichedSessions.filter(session => {
          return (
            session.customer.name.toLowerCase().includes(ql) ||
            session.customer.contact.toLowerCase().includes(ql) ||
            (session.package_snapshot?.package_name || "").toLowerCase().includes(ql) ||
            (session.package_snapshot?.concern || "").toLowerCase().includes(ql) ||
            (session.appointmentId || "").toLowerCase().includes(ql)
          );
        });
      }
      
      return res.json({ 
        success: true, 
        count: filteredSessions.length, 
        sessions: filteredSessions 
      });
      
    } catch (err) {
      console.error("Error in /api/add_sessions/fetch_paidsessions_simple:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Server error fetching sessions", 
        error: err.message 
      });
    }
  });



  // POST /api/add_sessions/update
router.post("/update", async (req, res) => {
  try {
    const { addSessionId, sessions = [] } = req.body || {};
    if (!addSessionId) return res.status(400).json({ success: false, message: "addSessionId required" });

    if (!Array.isArray(sessions)) return res.status(400).json({ success: false, message: "sessions must be an array" });

    // find existing doc
    const doc = await AddSession.findById(addSessionId);
    if (!doc) return res.status(404).json({ success: false, message: "AddSession not found" });

    // sanitize and compute scheduledAt where possible
    const finalSessions = sessions.map((s, idx) => {
      const dateStr = (s.date || "").toString();
      const timeStr = (s.time || "").toString();
      let scheduledAt = null;
      try {
        if (dateStr && timeStr) {
          // construct ISO local datetime (assume time is HH:MM)
          const iso = `${dateStr}T${timeStr}:00`;
          const dt = new Date(iso);
          if (!isNaN(dt.getTime())) scheduledAt = dt;
        }
      } catch (e) {
        scheduledAt = null;
      }
      return {
        index: s.index || (idx + 1),
        date: dateStr,
        time: timeStr,
        scheduledAt
      };
    });

    // update doc
    doc.sessions = finalSessions;
    // optionally update notes/other fields if sent
    if (typeof req.body.notes === "string") doc.notes = req.body.notes;
    await doc.save();

    return res.json({ success: true, message: "Sessions updated", addSession: doc });
  } catch (err) {
    console.error("Error in /api/add_sessions/update:", err);
    return res.status(500).json({ success: false, message: "Server error updating sessions", error: String(err) });
  }
});

  
router.post("/:addSessionId/session/:index/create_room", async (req, res) => {
  try {
    const { addSessionId, index } = req.params;
    const { doctorId, treatmentType } = req.body || {};

    if (!addSessionId || !index) return res.status(400).json({ success: false, message: "addSessionId and index required" });

    const idx = Number(index);
    if (Number.isNaN(idx) || idx < 1) return res.status(400).json({ success: false, message: "invalid index" });

    const addSessionDoc = await AddSession.findById(addSessionId);
    if (!addSessionDoc) return res.status(404).json({ success: false, message: "AddSession not found" });

    const sessArray = Array.isArray(addSessionDoc.sessions) ? addSessionDoc.sessions : [];
    const target = sessArray.find(s => Number(s.index) === idx) || sessArray[idx - 1];
    if (!target) return res.status(404).json({ success: false, message: "Session entry not found for that index" });

    // load appointment to get patient contact & name
    const appt = await Appointment.findById(addSessionDoc.appointmentId).lean();
    if (!appt) return res.status(404).json({ success: false, message: "Linked Appointment not found" });

    // Get doctor details (optional)
    let doctor = null;
    if (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId).trim()) && LoginCred) {
      doctor = await LoginCred.findById(doctorId).lean();
    }

    // create Twilio room (best-effort)
    const roomName = `session_${addSessionId}_${idx}_${uuidv4().slice(0,8)}`;
    let twRoom = null;
    try {
      if (twilioClient && twilioClient.video && typeof twilioClient.video.v1.rooms.create === "function") {
        twRoom = await twilioClient.video.v1.rooms.create({
          uniqueName: roomName,
          type: "group",
          recordParticipantsOnConnect: false
        });
      } else {
        console.warn("Twilio client not available; skipping actual Twilio room create.");
        twRoom = { uniqueName: roomName, sid: null };
      }
    } catch (err) {
      console.error("Twilio create room error:", err?.message || err);
      if (err?.code === 53113) {
        twRoom = { uniqueName: roomName, sid: null };
      } else {
        twRoom = { uniqueName: roomName, sid: null, error: String(err.message || err) };
      }
    }

    // Build frontend links
    const FRONTEND_URL = process.env.FRONTEND_URL || "";
    const patientLink = `${FRONTEND_URL}/consult/${roomName}`;
    const doctorLink = `${FRONTEND_URL}/doctor/join/${roomName}`;


    // --- NEW: reschedule link for patient (no token required for patient request page) ---
const rescheduleLink = `${FRONTEND_URL}/reschedule/request/${String(addSessionId)}/${idx}`;


    // Normalize phone numbers
    const patientPhone = normalizePhone(appt.phone || appt.contact || appt.phoneNumber || "");


    // Build doctor phones to notify
    let doctorPhonesToNotify = [];
    if (doctor && (doctor.mobile_no || doctor.mobile || doctor.phone)) {
      const dp = normalizePhone(doctor.mobile_no || doctor.mobile || doctor.phone || "");
      if (dp) doctorPhonesToNotify.push(dp);
    } else {
      const doctorList = (process.env.NOTIFY_DOCTORS || "").split(",").map(s => s.replace(/\+/g, "").trim()).filter(Boolean);
      doctorList.forEach(d => {
        const n = normalizePhone(d);
        if (n) doctorPhonesToNotify.push(n);
      });
    }

    // Build package/session strings
    const pkg = addSessionDoc.package_snapshot || {};
    const concern = pkg.concern || target.concern || "N/A";
    const packageName = pkg.package_name || "Session Package";
    const sessionIndex = String(target.index || idx || 1);
    const dateStr = target.date || "";
    const timeStr = target.time || "";



    // --- Patient template send (7 placeholders) ---
    // if (appt.whatsAppOptIn && patientPhone && sendTemplateMessage) {
    //   try {
    //     const patientParams = [
    //       appt.name || appt.customer?.name || "Patient",
    //       concern,
    //       packageName,
    //       sessionIndex,
    //       dateStr,
    //       timeStr,
    //       patientLink,
    //       rescheduleLink                                   // [reschedule_link]  <-- NEW

    //     ];
    //     const patientPayload = {
    //       to: patientPhone,
    //       campaignName: process.env.AISENSY_PATIENT_SESSION_CAMPAIGN || process.env.AISENSY_PATIENT_VIDEO_NAME || "patient_session_notification_and_reschedulelink",
    //       templateName: process.env.AISENSY_PATIENT_SESSION_TEMPLATE || process.env.AISENSY_PATIENT_VIDEO_TEMPLATE || "patient_session_notification_and_reschedulelink",
    //       params: patientParams
    //     };
    //     await sendTemplateMessage(patientPayload);
    //     console.log("Patient WhatsApp sent (params):", patientParams);
    //   } catch (err) {
    //     console.error("Patient WA failed:", err?.response?.data || err.message || err);
    //   }
    // }

    // --- Patient template send via Superfone ---
if (appt.whatsAppOptIn && patientPhone) {
  try {
    const patientParams = [
      appt.name || "Patient",      // {{1}}
      concern,                     // {{2}}
      packageName,                 // {{3}}
      sessionIndex,                // {{4}}
      dateStr,                     // {{5}}
      timeStr,                     // {{6}}
      patientLink,                 // {{7}}
      rescheduleLink               // {{8}}
    ];

    await sendTemplateMessage({
      to: patientPhone,
      templateName: process.env.SUPERFONE_PATIENT_SESSION_TEMPLATE || "patient_session_notification_and_reschedulelink",
      language: "en",
      params: patientParams
    });

    console.log("✅ Superfone Patient WA sent:", patientParams);
  } catch (err) {
    console.error("❌ Superfone Patient WA failed:", err?.message || err);
  }
}

    // --- Doctor template send (9 placeholders) ---
    // if (doctorPhonesToNotify.length && sendTemplateMessage) {
    //   try {
    //     const docDisplay = (doctor && (doctor.username || doctor.name)) || "Doctor";
    //     const doctorParams = [
    //       docDisplay,
    //       appt.name || "Patient",
    //       concern,
    //       packageName,
    //       sessionIndex,
    //       dateStr,
    //       timeStr,
    //       doctorLink,
    //     ];

    //     const docTemplateName = process.env.AISENSY_DOCTOR_SESSION_TEMPLATE || process.env.AISENSY_DOCTOR_VIDEO_TEMPLATE || "doctor_session_notifications";
    //     const docCampaign = process.env.AISENSY_DOCTOR_SESSION_CAMPAIGN || process.env.AISENSY_DOCTOR_VIDEO_CAMPAIGN || "doctor_session_notification";

    //     const sendSingle = async (dp) => {
    //       const docPayload = { to: dp, campaignName: docCampaign, templateName: docTemplateName, params: doctorParams };
    //       console.log("� AiSensy: sending campaign", docCampaign, "to", dp, "(template:", docTemplateName + ").");
    //       console.log("� POST payload:", JSON.stringify(docPayload, null, 2));
    //       return sendTemplateMessage(docPayload);
    //     };

    //     if (doctorPhonesToNotify.length > 1) {
    //       const results = await Promise.all(doctorPhonesToNotify.map(dp =>
    //         sendSingle(dp).then(r => ({ ok: true, phone: dp, res: r })).catch(e => ({ ok: false, phone: dp, err: e })))
    //       );
    //       console.log("Doctor WA results:", results);
    //     } else {
    //       const dp = doctorPhonesToNotify[0];
    //       try {
    //         const r = await sendSingle(dp);
    //         console.log("Doctor WhatsApp sent to:", dp, "response:", r);
    //       } catch (err) {
    //         console.error("Doctor WA failed:", err?.response?.data || err.message || err);
    //       }
    //     }
    //   } catch (err) {
    //     console.error("Doctor WA send unexpected error:", err);
    //   }
    // }

    // --- Doctor template send via Superfone ---
if (doctorPhonesToNotify.length) {
  try {
    const docDisplay =
      (doctor && (doctor.username || doctor.name)) || "Doctor";

      const doctorParams = [
        docDisplay,                  // {{1}}
        appt.name || "Patient",      // {{2}}
        concern,                     // {{3}}
        packageName,                 // {{4}}
        sessionIndex,                // {{5}}
        dateStr,                     // {{6}}
        timeStr,                     // {{7}}
        doctorLink                   // {{8}}
      ];

    const sendSingle = async (dp) => {
      return sendTemplateMessage({
        to: dp,
        templateName: process.env.SUPERFONE_DOCTOR_SESSION_TEMPLATE || "doctor_session_notificationss",
        language: "en",
        params: doctorParams
      });
    };

    if (doctorPhonesToNotify.length > 1) {
      await Promise.all(
        doctorPhonesToNotify.map(dp =>
          sendSingle(dp)
            .then(() => console.log("✅ Doctor WA sent to:", dp))
            .catch(err =>
              console.error("❌ Doctor WA failed for:", dp, err?.message)
            )
        )
      );
    } else {
      await sendSingle(doctorPhonesToNotify[0]);
      console.log("✅ Doctor WA sent to:", doctorPhonesToNotify[0]);
    }

  } catch (err) {
    console.error("Doctor WA unexpected error:", err);
  }
}


    // ---------------- Persist room metadata & session_handled/treatment in the specific session entry ----------------
    const now = new Date();
    const roomObj = {
      roomName: twRoom?.uniqueName || roomName,
      roomSid: twRoom?.sid || null,
      link: patientLink,
      createdAt: now
    };
    const doctorRoomObj = { ...roomObj, link: doctorLink };

    // find index in array
    const arrIdx = addSessionDoc.sessions.findIndex(s => Number(s.index) === idx);

    // helper to update a session object reference
    const applyRoomToSession = (sess) => {
      sess.twilioRoomPatient = roomObj;
      sess.twilioRoomDoctor = doctorRoomObj;
      if (doctor && doctor._id) {
        sess.session_handled = doctor._id;
        sess.session_handled_display = doctor.username || doctor.name || String(doctor._id);
      }
      if (typeof treatmentType === "string" && treatmentType.trim()) {
        sess.treatment = String(treatmentType).trim();
      }
    };

    if (arrIdx === -1) {
      const pos = idx - 1;
      if (addSessionDoc.sessions[pos]) {
        applyRoomToSession(addSessionDoc.sessions[pos]);
      } else {
        const newSess = {
          index: idx,
          date: target.date || "",
          time: target.time || "",
          scheduledAt: target.scheduledAt || null,
          twilioRoomPatient: roomObj,
          twilioRoomDoctor: doctorRoomObj
        };
        if (doctor && doctor._id) {
          newSess.session_handled = doctor._id;
          newSess.session_handled_display = doctor.username || doctor.name || String(doctor._id);
        }
        if (typeof treatmentType === "string" && treatmentType.trim()) {
          newSess.treatment = String(treatmentType).trim();
        }
        addSessionDoc.sessions.push(newSess);
      }
    } else {
      applyRoomToSession(addSessionDoc.sessions[arrIdx]);
}


    // === NEW: Create Google Calendar invite for this session (best-effort) ===
    // (async () => {
    //   try {
    //     // pick doctor email if available
    //     const doctorEmail = (doctor && (doctor.email || doctor.user_email || doctor.mail)) ||
    //                         (addSessionDoc.doctorEmail && String(addSessionDoc.doctorEmail).includes('@') ? addSessionDoc.doctorEmail : null);

    //     // Build a small appointment-like object for the calendar helper
    //     const miniAppt = {
    //       _id: `${addSessionId}_${idx}`,
    //       name: appt.name || "Patient",
    //       phone: appt.phone || null,
    //       appointment_date: dateStr,
    //       appointment_time: timeStr,
    //       // any extra fields your calendar helper may expect
    //     };

    //     // Only attempt if we have at least a date/time
    //     if (dateStr && timeStr) {
    //       const calRes = await createCalendarEventOAuth(miniAppt, doctorEmail);
    //       if (calRes) {
    //         // Save event info into the correct session entry
    //         const saveIdx = addSessionDoc.sessions.findIndex(s => Number(s.index) === idx) || (idx - 1);
    //         const sessToSave = addSessionDoc.sessions[saveIdx] || addSessionDoc.sessions[idx - 1];
    //         if (sessToSave) {
    //           sessToSave.calendarEventId = calRes.id || null;
    //           sessToSave.calendarEventLink = calRes.htmlLink || calRes.alternateLink || null;
    //           sessToSave.calendarCreatedAt = new Date();
    //           // If doctor invited, also save attendee email
    //           if (doctorEmail) sessToSave.calendarInvitedDoctor = doctorEmail;
    //           await addSessionDoc.save();
    //           console.log("Saved calendar event for session:", addSessionId, "index:", idx, "eventId:", calRes.id);
    //         }
    //       }
    //     } else {
    //       console.warn("Skipping calendar invite because date/time missing for session", addSessionId, idx);
    //     }
    //   } catch (calErr) {
    //     console.warn("Background session calendar creation error (handled):", calErr?.response?.data || calErr?.message || calErr);
    //     // if token invalid -> your integration entry will be marked invalid by helper
    //   }
    // })();

    // --- Create Google Calendar event for SESSION (non-blocking) ---
(async () => {
  try {
    const doctorEmailCandidate =
      (doctor && (doctor.email || doctor.user_email)) ||
      (addSessionDoc.doctorEmail && addSessionDoc.doctorEmail.includes("@")
        ? addSessionDoc.doctorEmail
        : null);

    // Prevent duplicate calendar creation
    if (target.calendarEventId) {
      console.log("Session calendar already exists — skipping");
      return;
    }

    const calData = await createSessionCalendarEventOAuth(
      {
        date: target.date,
        time: target.time,
        duration: 30,
        patientName: appt.name,
        concern: pkg.concern,
        sessionIndex: target.index
      },
      doctorEmailCandidate
    );

    if (calData) {
      target.calendarEventId = calData.id || null;
      target.calendarEventLink = calData.htmlLink || null;
      target.calendarCreatedAt = new Date();

      if (doctorEmailCandidate) {
        target.calendarInvitedDoctor = doctorEmailCandidate;
      }

      await addSessionDoc.save();

      console.log("Session calendar saved:", {
        addSessionId,
        sessionIndex: target.index,
        calendarEventId: target.calendarEventId
      });
    }
  } catch (err) {
    console.warn(
      "Session calendar background failure:",
      err?.message || err
    );
  }
})();


    // Persist the addSessionDoc (room & session updates already applied)
    await addSessionDoc.save();

    return res.json({
      success: true,
      message: "Room created and notifications sent (best-effort). session_handled & treatment updated in session object.",
      room: roomObj,
      doctor: doctor || null,
      addSession: addSessionDoc
    });

  } catch (err) {
    console.error("Error in create_room:", err);
    return res.status(500).json({ success: false, message: "Server error creating room", error: String(err) });
  }
});


// Routes/addSessionRoutes.js (add handler)
router.post("/:addSessionId/session/:sessionIndex/set-reminder", async (req, res) => {
  try {
    const { addSessionId, sessionIndex } = req.params;
    const { sendReminder } = req.body;

    if (!addSessionId || !sessionIndex) {
      return res.status(400).json({ success: false, message: "Missing ids" });
    }

    const idx = Number(sessionIndex);
    if (Number.isNaN(idx)) {
      return res.status(400).json({ success: false, message: "sessionIndex must be a number" });
    }

    // Use arrayFilters with numeric match
    const arrayFilters = [{ "s.index": idx }];
    const update = { $set: { "sessions.$[s].sendReminder": !!sendReminder } };

    const result = await AddSession.updateOne({ _id: new mongoose.Types.ObjectId(addSessionId) }, update, { arrayFilters });

    // fetch and return updated document (lean for faster transfer)
    const updated = await AddSession.findById(addSessionId).lean();

    return res.json({ success: true, modifiedCount: result.modifiedCount || 0, addSession: updated });
  } catch (err) {
    console.error("set-reminder error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});




module.exports = router;

