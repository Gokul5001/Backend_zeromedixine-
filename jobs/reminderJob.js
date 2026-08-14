// jobs/reminderJob.js
const cron = require("node-cron");
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const Appointment = require("../Models/Appointment");
// const { sendTemplateMessage } = require("../utils/aisensy");
const { sendTemplateMessage } = require("../utils/superfone");
const admin = require("../utils/firebase");
const FcmDevice = require("../models/FcmDevice");

// Helper to normalize phone (copied from your route)
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

function formatTime(apptMoment) {
  return apptMoment ? apptMoment.format("hh:mm A") : "";
} 


// parse appointment date & time robustly into a moment in Asia/Kolkata
function parseAppointmentMoment(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const tz = "Asia/Kolkata";
  const makeString = (v) => {
    if (!v && v !== 0) return "";
    if (v instanceof Date) return moment(v).format("YYYY-MM-DD HH:mm");
    if (typeof v === "number") return String(v);
    return String(v).trim();
  };

  const ds = makeString(dateStr);
  const ts = makeString(timeStr);
  if (!ds || !ts) return null;
  const combined = `${ds} ${ts}`;

  const formats = [
    "YYYY-MM-DD HH:mm",
    "YYYY-MM-DD HH:mm:ss",
    "YYYY-MM-DD h:mm A",
    "YYYY-MM-DD hh:mm A",
    "DD-MM-YYYY HH:mm",
    "DD/MM/YYYY HH:mm",
    "DD-MM-YYYY h:mm A",
    "DD/MM/YYYY h:mm A",
    moment.ISO_8601
  ];

  for (const fmt of formats) {
    try {
      const m = moment.tz(combined, fmt, tz);
      if (m && m.isValid()) return m;
    } catch (e) {}
  }

  try {
    const mLoose = moment.tz(combined, tz);
    if (mLoose && mLoose.isValid()) return mLoose;
  } catch (e) {}

  return null;
}

// Build patient params to match ai sensy template placeholders you showed:
// patient_appointment_remainder expects: [name], [date], [primaryConcern], [link]
function buildPatientTemplateParams(apptMoment, appointment) {
  const patientName = appointment.name || "Patient";
  const dateStr = apptMoment ? apptMoment.format("YYYY-MM-DD") : (appointment.appointment_date || "");
  // try a bunch of common fields for primary concern
  const primaryConcern = appointment.primaryConcern || appointment.primary_concern || appointment.primaryCondition || appointment.primary_condition || appointment.primaryConcernText || appointment.primary || "General";
  // consultation link fallback - look for explicit link fields else build predictable URL
  const link = appointment.consultationLink || appointment.consultation_link || appointment.consultation_url ||
               (process.env.FRONTEND_BASE_URL ? `${process.env.FRONTEND_BASE_URL.replace(/\/$/, "")}/consult/${appointment._id}` : `https://app.zeromedixine.com/consult/${appointment._id}`);
  return [patientName, dateStr, primaryConcern, link];
}

// For doctors we send name, date, primaryConcern, link as well (adjust if your doctor template differs)
function buildDoctorTemplateParams(apptMoment, appointment) {
  const patientName = appointment.name || "Patient";
  const dateStr = apptMoment ? apptMoment.format("YYYY-MM-DD") : (appointment.appointment_date || "");
  const primaryConcern = appointment.primaryConcern || appointment.primary_concern || appointment.primaryCondition || "General";
  const link = appointment.consultationLink || appointment.consultation_link || (process.env.FRONTEND_BASE_URL ? `${process.env.FRONTEND_BASE_URL.replace(/\/$/, "")}/consult/${appointment._id}` : `https://app.zeromedixine.com/consult/${appointment._id}`);
  return [patientName, dateStr, primaryConcern, link];
}

// jobs/reminderJob.js (replace relevant parts inside processReminders)

// async function processReminders() {
//   try {
//     const now = moment().tz("Asia/Kolkata");

//     console.log(
//       "⏰ Reminder job running at:",
//       now.format("YYYY-MM-DD HH:mm:ss")
//     );

//     const today = now.clone().format("YYYY-MM-DD");
//     const tomorrow = now.clone().add(1, "day").format("YYYY-MM-DD");

//     // ✅ Populate primaryConcern so we send the concern string (not an ObjectId)
//     const candidates = await Appointment.find({
//       status: { $in: ["confirmed", "Confirmed", "CONFIRMED"] },
//       appointment_date: { $in: [today, tomorrow] }
//     })
//     .populate({ path: "primaryConcern", select: "concern" })
//     .lean();

//     if (!Array.isArray(candidates) || candidates.length === 0) return;

//     for (const ap of candidates) {
//       try {
//         const apptMoment = parseAppointmentMoment(ap.appointment_date, ap.appointment_time);
//         if (!apptMoment) continue;

//         const diffMinutes = Math.round(apptMoment.diff(now, "minutes", true));

//         // target ~30 minutes before
//         if (diffMinutes >= 29 && diffMinutes <= 31) {

//           // --- Build patient link robustly: prefer stored twilioRoomPatient.link if present ---
//           let patientLink = null;
//           if (ap.twilioRoomPatient && ap.twilioRoomPatient.link) {
//             patientLink = ap.twilioRoomPatient.link;
//           } else if (ap.twilioRoom && ap.twilioRoom.roomName) {
//             const FRONTEND_URL = process.env.FRONTEND_URL || "";
//             patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${ap.twilioRoom.roomName}` : `/consult/${ap.twilioRoom.roomName}`;
//           } else if (ap._id) {
//             // last resort: use appointment id (but better to rely on stored room)
//             const FRONTEND_URL = process.env.FRONTEND_URL || "";
//             patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${ap._id}` : `/consult/${ap._id}`;
//           }

//           // --- Patient reminder ---
//           if (!ap.reminder30PatientSent && ap.whatsAppOptIn) {
//             const patientPhone = normalizePhone(ap.phone || "");
//             if (patientPhone) {
//               const patientName = ap.name || "Patient";
//               // get readable concern string (populated) or fallback
//               const concernText = ap.primaryConcern && ap.primaryConcern.concern ? String(ap.primaryConcern.concern) : (ap.primaryConcern || "consultation");

//               const campaign = process.env.AISENSY_PATIENT_REMINDER_CAMPAIGN || process.env.AISENSY_CAMPAIGN_NAME || "patient_remainder";
//               const template = process.env.AISENSY_PATIENT_REMINDER_TEMPLATE || "patient_appointment_remainder";
//               // const params = [patientName, ap.appointment_date, concernText, patientLink];
              
//               const timeStr = apptMoment.format("hh:mm A"); // 07:30 PM
//               const params = [patientName, timeStr, concernText, patientLink];

//               console.log("Sending patient reminder payload:", { to: patientPhone, campaign, template, params });

//               try {
//                 await sendTemplateMessage({ to: patientPhone, campaignName: campaign, templateName: template, params });
//                 await Appointment.updateOne({ _id: ap._id }, { $set: { reminder30PatientSent: true } });
//                 console.log(`Reminder => patient sent for appt ${ap._id} to ${patientPhone}`);
//               } catch (err) {
//                 console.error("Patient reminder send failed for", ap._id, err?.response?.data || err?.message || err);
//               }
//             }
//           }

//           // --- Doctor reminder ---
//           if (!ap.reminder30DoctorSent) {
//             // build doctorNumbers list (resolve from login_credentials or fallback to NOTIFY_DOCTORS)
//             let doctorPhonesToNotify = [];

//             if (ap.doctorAssigned) {
//               try {
//                 const allCols = await mongoose.connection.db.listCollections().toArray();
//                 const credFound = allCols.find(c => String(c.name).trim().toLowerCase() === "login_credentials");
//                 const credCollName = credFound ? credFound.name : "login_credentials";
//                 const credColl = mongoose.connection.collection(credCollName);

//                 let q = {};
//                 if (/^[0-9a-fA-F]{24}$/.test(String(ap.doctorAssigned))) {
//                   q = { _id: new mongoose.Types.ObjectId(String(ap.doctorAssigned)) };
//                 } else {
//                   const s = String(ap.doctorAssigned).trim();
//                   q = { $or: [{ username: s }, { user: s }, { user_name: s }] };
//                 }

//                 const cred = await credColl.findOne(q);
//                 if (cred) {
//                   const phone = cred.mobile_no || cred.mobile || cred.phone || cred.mobileno || "";
//                   const n = normalizePhone(phone);
//                   if (n) doctorPhonesToNotify.push(n);
//                 }
//               } catch (err) {
//                 console.warn("Doctor resolution failed, will fallback to NOTIFY_DOCTORS:", err?.message || err);
//               }
//             }

//             if (!doctorPhonesToNotify.length) {
//               const doctorList = (process.env.NOTIFY_DOCTORS || "")
//                 .split(",").map(s => s.replace(/\+/g, "").trim()).filter(Boolean);
//               doctorList.forEach(d => {
//                 const n = normalizePhone(d);
//                 if (n) doctorPhonesToNotify.push(n);
//               });
//             }

//             // pick campaign/template from envs (do not attempt if campaign missing)
//             const docCampaign = process.env.AISENSY_DOCTOR_REMINDER_CAMPAIGN || process.env.AISENSY_DOCTOR_CAMPAIGN || process.env.AISENSY_CAMPAIGN_NAME || null;
//             const docTemplate = process.env.AISENSY_DOCTOR_REMINDER_TEMPLATE || process.env.AISENSY_DOCTOR_TEMPLATE || "doctor_remainder_notification";

//             if (!docCampaign) {
//               console.warn("Doctor reminder skipped: AISENSY_DOCTOR_REMINDER_CAMPAIGN / AISENSY_DOCTOR_CAMPAIGN not set in env.");
//             } else if (doctorPhonesToNotify.length === 0) {
//               console.warn("No doctor numbers to notify for appt", ap._id);
//             } else {
//               const patientName = ap.name || "Patient";
//               const concernText = ap.primaryConcern && ap.primaryConcern.concern ? String(ap.primaryConcern.concern) : (ap.primaryConcern || "consultation");
//               // const params = [patientName, ap.appointment_date, concernText, patientLink];

//               const timeStr = apptMoment.format("hh:mm A");
//               const params = [patientName, timeStr, concernText, patientLink];

//               try {
//                 const sends = doctorPhonesToNotify.map(dp => {
//                   const payload = { to: dp, campaignName: docCampaign, templateName: docTemplate, params };
//                   return sendTemplateMessage(payload).then(r => ({ ok: true, phone: dp, res: r })).catch(e => ({ ok: false, phone: dp, err: e }));
//                 });

//                 const results = await Promise.all(sends);
//                 results.forEach(r => r.ok ? console.log("Doctor WA sent:", r.phone) : console.error("Doctor WA failed:", r.phone, r.err?.response?.data || r.err?.message || r.err));
//                 await Appointment.updateOne({ _id: ap._id }, { $set: { reminder30DoctorSent: true } });
//               } catch (err) {
//                 console.error("Doctor reminder send failed:", err?.response?.data || err?.message || err);
//               }
//             }
//           } // end doctor reminder check
//         } // end timing window check
//       } catch (innerErr) {
//         console.error("Error processing appointment in reminder loop:", innerErr);
//       }
//     } // end for candidates
//   } catch (err) {
//     console.error("Reminder job top-level error:", err);
//   }
// }

async function processReminders() {
  try {
    const now = moment().tz("Asia/Kolkata");

    console.log("⏰ Reminder job running at:", now.format("YYYY-MM-DD HH:mm:ss"));

    const today = now.clone().format("YYYY-MM-DD");
    const tomorrow = now.clone().add(1, "day").format("YYYY-MM-DD");

    const candidates = await Appointment.find({
      status: { $in: ["confirmed", "Confirmed", "CONFIRMED"] },
      appointment_date: { $in: [today, tomorrow] }
    })
      .populate({ path: "primaryConcern", select: "concern" })
      .lean();

    if (!Array.isArray(candidates) || candidates.length === 0) return;

    for (const ap of candidates) {
      try {
        const apptMoment = parseAppointmentMoment(ap.appointment_date, ap.appointment_time);
        if (!apptMoment) continue;

        const diffMinutes = Math.round(apptMoment.diff(now, "minutes", true));

        // 🎯 30 min before window
        if (diffMinutes >= 29 && diffMinutes <= 31) {

          const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.zeromedixine.com";
          const roomName = ap?.twilioRoom?.roomName || ap?._id;

          /* =========================================================
             ✅ BUILD PATIENT LINK
          ==========================================================*/
          let patientLink = null;

          if (ap?.twilioRoomPatient?.link) {
            patientLink = ap.twilioRoomPatient.link;
          } else {
            patientLink = `${FRONTEND_URL}/consult/${roomName}`;
          }

          /* =========================================================
             ✅ BUILD DOCTOR LINK (Correct Fix)
          ==========================================================*/
          let doctorLink = null;
          let doctorUsername = ap.doctorUsername || "";
          let doctorId = ap.doctorAssigned || "";

          // Resolve doctor username from login_credentials if missing
          if (!doctorUsername && ap.doctorAssigned) {
            try {
              const credColl = mongoose.connection.collection("login_credentials");

              let query = {};
              if (/^[0-9a-fA-F]{24}$/.test(String(ap.doctorAssigned))) {
                query = { _id: new mongoose.Types.ObjectId(String(ap.doctorAssigned)) };
              } else {
                const s = String(ap.doctorAssigned).trim();
                query = { $or: [{ username: s }, { user: s }, { user_name: s }] };
              }

              const cred = await credColl.findOne(query);
              if (cred) {
                doctorUsername = cred.username || "";
                doctorId = cred._id?.toString() || doctorId;
              }
            } catch (err) {
              console.warn("Doctor username resolve failed:", err?.message || err);
            }
          }

          if (ap?.twilioRoomDoctor?.link) {
            doctorLink = ap.twilioRoomDoctor.link;
          } else {
            doctorLink =
              `${FRONTEND_URL}/doctor/join/${roomName}` +
              `?doctorId=${doctorId}&doctorUsername=${encodeURIComponent(doctorUsername)}`;
          }

          /* =========================================================
             👤 PATIENT REMINDER
          ==========================================================*/
          // if (!ap.reminder30PatientSent && ap.whatsAppOptIn) {
          //   const patientPhone = normalizePhone(ap.phone || "");

          //   if (patientPhone) {
          //     const patientName = ap.name || "Patient";
          //     const concernText =
          //       ap.primaryConcern?.concern ||
          //       ap.primaryConcern ||
          //       "consultation";

          //     const timeStr = apptMoment.format("hh:mm A");

          //     const campaign =
          //       process.env.AISENSY_PATIENT_REMINDER_CAMPAIGN ||
          //       process.env.AISENSY_CAMPAIGN_NAME ||
          //       "patient_remainder";

          //     const template =
          //       process.env.AISENSY_PATIENT_REMINDER_TEMPLATE ||
          //       "patient_appointment_remainder";

          //     const params = [patientName, timeStr, concernText, patientLink];

          //     console.log("📤 Sending PATIENT reminder:", {
          //       to: patientPhone,
          //       params
          //     });

          //     try {
          //       await sendTemplateMessage({
          //         to: patientPhone,
          //         campaignName: campaign,
          //         templateName: template,
          //         params
          //       });

          //       await Appointment.updateOne(
          //         { _id: ap._id },
          //         { $set: { reminder30PatientSent: true } }
          //       );

          //       console.log("✅ Patient reminder sent:", ap._id);
          //     } catch (err) {
          //       console.error("❌ Patient reminder failed:", err?.response?.data || err?.message || err);
          //     }
          //   }
          // }

          /* =========================================================
   👤 PATIENT REMINDER (Superfone)
==========================================================*/
if (!ap.reminder30PatientSent && ap.whatsAppOptIn) {
  const patientPhone = normalizePhone(ap.phone || "");

  if (patientPhone) {
    const patientName = ap.name || "Patient";
    const concernText =
      ap.primaryConcern?.concern ||
      ap.primaryConcern ||
      "consultation";

    const timeStr = apptMoment.format("hh:mm A");

    const params = [
      patientName,   // {{1}}
      timeStr,       // {{2}}
      concernText,   // {{3}}
      patientLink    // {{4}}
    ];

    console.log("📤 Sending Superfone PATIENT reminder:", {
      to: patientPhone,
      params
    });

    try {
      await sendTemplateMessage({
        to: patientPhone,
        templateName: "patient_appointment_remainder_new",
        language: "en_US",
        params
      });

      await Appointment.updateOne(
        { _id: ap._id },
        { $set: { reminder30PatientSent: true } }
      );

      console.log("✅ Patient reminder sent:", ap._id);
    } catch (err) {
      console.error("❌ Patient reminder failed:",
        err?.response?.data || err?.message || err
      );
    }
  }
}

          /* =========================================================
             👨‍⚕️ DOCTOR REMINDER
          ==========================================================*/
          // if (!ap.reminder30DoctorSent) {
          //   let doctorPhonesToNotify = [];

          //   if (ap.doctorAssigned) {
          //     try {
          //       const credColl = mongoose.connection.collection("login_credentials");

          //       let query = {};
          //       if (/^[0-9a-fA-F]{24}$/.test(String(ap.doctorAssigned))) {
          //         query = { _id: new mongoose.Types.ObjectId(String(ap.doctorAssigned)) };
          //       } else {
          //         const s = String(ap.doctorAssigned).trim();
          //         query = { $or: [{ username: s }, { user: s }, { user_name: s }] };
          //       }

          //       const cred = await credColl.findOne(query);

          //       if (cred) {
          //         const phone =
          //           cred.mobile_no ||
          //           cred.mobile ||
          //           cred.phone ||
          //           "";

          //         const normalized = normalizePhone(phone);
          //         if (normalized) doctorPhonesToNotify.push(normalized);

          //         doctorUsername = cred.username || doctorUsername;
          //         doctorId = cred._id?.toString() || doctorId;
          //       }
          //     } catch (err) {
          //       console.warn("Doctor resolution failed:", err?.message || err);
          //     }
          //   }

          //   if (!doctorPhonesToNotify.length) {
          //     const fallback = (process.env.NOTIFY_DOCTORS || "")
          //       .split(",")
          //       .map(s => normalizePhone(s))
          //       .filter(Boolean);

          //     doctorPhonesToNotify.push(...fallback);
          //   }

          //   const docCampaign =
          //     process.env.AISENSY_DOCTOR_REMINDER_CAMPAIGN ||
          //     process.env.AISENSY_DOCTOR_CAMPAIGN;

          //   const docTemplate =
          //     process.env.AISENSY_DOCTOR_REMINDER_TEMPLATE ||
          //     "doctor_remainder_notification";

          //   if (docCampaign && doctorPhonesToNotify.length) {
          //     const patientName = ap.name || "Patient";
          //     const concernText =
          //       ap.primaryConcern?.concern ||
          //       ap.primaryConcern ||
          //       "consultation";

          //     const timeStr = apptMoment.format("hh:mm A");

          //     const params = [patientName, timeStr, concernText, doctorLink];

          //     console.log("📤 Sending DOCTOR reminder:", {
          //       phones: doctorPhonesToNotify,
          //       params
          //     });

          //     const sends = doctorPhonesToNotify.map(phone =>
          //       sendTemplateMessage({
          //         to: phone,
          //         campaignName: docCampaign,
          //         templateName: docTemplate,
          //         params
          //       })
          //     );

          //     await Promise.allSettled(sends);

          //     await Appointment.updateOne(
          //       { _id: ap._id },
          //       { $set: { reminder30DoctorSent: true } }
          //     );

          //     console.log("✅ Doctor reminder sent:", ap._id);
          //   }
          // }

          /* =========================================================
   👨‍⚕️ DOCTOR REMINDER (Superfone)
==========================================================*/
if (!ap.reminder30DoctorSent) {
  let doctorPhonesToNotify = [];

  if (ap.doctorAssigned) {
    try {
      const credColl = mongoose.connection.collection("login_credentials");

      let query = {};
      if (/^[0-9a-fA-F]{24}$/.test(String(ap.doctorAssigned))) {
        query = { _id: new mongoose.Types.ObjectId(String(ap.doctorAssigned)) };
      } else {
        const s = String(ap.doctorAssigned).trim();
        query = { $or: [{ username: s }, { user: s }, { user_name: s }] };
      }

      const cred = await credColl.findOne(query);

      if (cred) {
        const phone =
          cred.mobile_no ||
          cred.mobile ||
          cred.phone ||
          "";

        const normalized = normalizePhone(phone);
        if (normalized) doctorPhonesToNotify.push(normalized);
      }
    } catch (err) {
      console.warn("Doctor resolution failed:", err?.message || err);
    }
  }

  if (!doctorPhonesToNotify.length) {
    const fallback = (process.env.NOTIFY_DOCTORS || "")
      .split(",")
      .map(s => normalizePhone(s))
      .filter(Boolean);

    doctorPhonesToNotify.push(...fallback);
  }

  if (doctorPhonesToNotify.length) {
    const patientName = ap.name || "Patient";
    const concernText =
      ap.primaryConcern?.concern ||
      ap.primaryConcern ||
      "consultation";

    const timeStr = apptMoment.format("hh:mm A");

    const params = [
      patientName,   // {{1}}
      timeStr,       // {{2}}
      concernText,   // {{3}}
      doctorLink     // {{4}}
    ];

    console.log("📤 Sending Superfone DOCTOR reminder:", {
      phones: doctorPhonesToNotify,
      params
    });

    const sends = doctorPhonesToNotify.map(phone =>
      sendTemplateMessage({
        to: phone,
        templateName: "doctor_remainder_notification",
        language: "en_US",
        params
      })
    );

    await Promise.allSettled(sends);

    await Appointment.updateOne(
      { _id: ap._id },
      { $set: { reminder30DoctorSent: true } }
    );

    console.log("✅ Doctor reminder sent:", ap._id);
    await sendDoctorPush(
      ap.doctorAssigned,
      "Upcoming Consultation",
      `Appointment with ${patientName} at ${timeStr}`
    );
  }
}
        }
      } catch (innerErr) {
        console.error("Reminder loop error:", innerErr);
      }
    }
  } catch (err) {
    console.error("Reminder job top-level error:", err);
  }
}



// schedule every minute
function startReminderJob() {
  processReminders().catch(e => console.error("Initial reminders run failed:", e));
  cron.schedule("*/5 * * * *", async () => {
    try {
      await processReminders();
    } catch (e) {
      console.error("Scheduled reminder run error:", e);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  console.log("Reminder job scheduled to run every minute (Asia/Kolkata).");
}


async function sendDoctorPush(doctorId, title, body) {
  try {

    const devices = await FcmDevice.find({
      userId: doctorId,
      role: "doctor"
    });

    if (!devices.length) {
      console.log("No doctor devices found:", doctorId);
      return;
    }

    const tokens = devices.map(d => d.token);

    const message = {
      tokens,
      notification: {
        title,
        body
      },
      data: {
        type: "appointment_reminder"
      }
    };

    await admin.messaging().sendEachForMulticast(message);

    console.log("📲 Doctor push notification sent");

  } catch (err) {
    console.error("Doctor push error:", err);
  }
}


module.exports = { startReminderJob, processReminders };

