// jobs/physioReminderJob.js
// Sends 30-minute pre-session WhatsApp reminders for physio_appointments
// Runs every 3 minutes — checks for appointments in the next 29–31 min window
// Uses: Superfone sendTemplateMessage, Doctor model for doctor phone

// const cron    = require("node-cron");
// const moment  = require("moment-timezone");
// const PhysioAppointment = require("../Models/PhysioAppointment");
// const Doctor            = require("../Models/Doctor");
// const { sendTemplateMessage } = require("../utils/superfone");

// const TZ = "Asia/Kolkata";

// // ── Parse "9:00 AM" + "2026-06-14T18:30:00.000Z" → moment in IST ─────────────
// // WITH this:
// function parsePhysioMoment(dateISO, timeSlot) {
//     if (!dateISO || !timeSlot) return null;
//     try {
//       // dateISO "2026-06-09T18:30:00.000Z" is IST midnight stored as UTC
//       // We must parse it in IST first, then take the IST date, then combine with slot time
//       const dateStrIST = moment.tz(dateISO, TZ).format("YYYY-MM-DD");
//       const dt = moment.tz(`${dateStrIST} ${timeSlot}`, "YYYY-MM-DD h:mm A", TZ);
//       return dt.isValid() ? dt : null;
//     } catch {
//       return null;
//     }
//   }

// // ── Main reminder processor ───────────────────────────────────────────────────
// async function processPhysioReminders() {
//   try {
//     const now      = moment().tz(TZ);
//     const todayISO = now.clone().format("YYYY-MM-DD");

//     // Fetch confirmed physio appointments for today that haven't had reminders sent
//     // We filter broadly (today + tomorrow dates) then check exact timing in the loop
//     const tomorrowISO = now.clone().add(1, "day").format("YYYY-MM-DD");

//     const candidates = await PhysioAppointment.find({
//       status: "confirmed",
//       $or: [
//         // date field is stored as ISO string like "2026-06-14T18:30:00.000Z"
//         // so we match on date prefix
//         { date: { $regex: `^${todayISO}` } },
//         { date: { $regex: `^${tomorrowISO}` } },
//       ],
//       $or: [
//         { reminder_30_patient_sent: { $ne: true } },
//         { reminder_30_doctor_sent:  { $ne: true } },
//       ],
//     }).lean();

//     if (!candidates?.length) return;

//     console.log(`[PhysioReminder] ${candidates.length} candidate(s) found`);

//     for (const appt of candidates) {
//       try {
//         const apptMoment = parsePhysioMoment(appt.date, appt.time);
//         if (!apptMoment) {
//           console.warn(`[PhysioReminder] Could not parse time for appt ${appt._id}`);
//           continue;
//         }

//         const diffMinutes = Math.round(apptMoment.diff(now, "minutes", true));

//         // Only act in the 29–31 minute window
//         if (diffMinutes < 29 || diffMinutes > 31) continue;

//         console.log(`[PhysioReminder] Appt ${appt._id} is ${diffMinutes} min away — sending reminders`);

//         const displayTime  = apptMoment.format("h:mm A [on] DD MMM YYYY");
//         const patientName  = appt.patient_name  || "Patient";
//         const patientPhone = appt.patient_phone || ""; // already "91XXXXXXXXXX"

//         // ── Resolve doctor ──────────────────────────────────────────────────
//         let doctorDoc = null;
//         try {
//           if (appt.doctor_ref) {
//             doctorDoc = await Doctor.findById(appt.doctor_ref)
//               .select("_id doctor_id name phone_number")
//               .lean();
//           }
//           if (!doctorDoc && appt.doctor_id) {
//             doctorDoc = await Doctor.findOne({ doctor_id: appt.doctor_id })
//               .select("_id doctor_id name phone_number")
//               .lean();
//           }
//         } catch (docErr) {
//           console.warn(`[PhysioReminder] Doctor lookup failed for appt ${appt._id}:`, docErr.message);
//         }

//         const doctorName  = doctorDoc?.name   || "Doctor";
//         const doctorPhone = doctorDoc?.phone_number || null; // 10-digit

//         // ── Use stored links (set during verify-payment) ────────────────────
//         const FRONTEND = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
//         const patientLink = appt.patient_link
//           || (appt.twilio_room_name ? `${FRONTEND}/consult/${appt.twilio_room_name}` : "");
//         const doctorLink  = appt.doctor_link
//           || (appt.twilio_room_name && doctorDoc
//             ? `${FRONTEND}/doctor/join/${appt.twilio_room_name}?doctorId=${doctorDoc._id}&doctorUsername=${encodeURIComponent(doctorName)}`
//             : "");

//   // ── 1. Patient reminder ─────────────────────────────────────────────────────
// if (!appt.reminder_30_patient_sent && patientPhone) {
//     try {
//       await sendTemplateMessage({
//         to:           patientPhone,
//         templateName: "patient_appointment_remainder_new",
//         language:     "en_US",
//         params: [
//           patientName,
//           apptMoment.format("h:mm A"),   // "3:00 PM"  — just time, not full datetime
//           appt.concern || "consultation",
//           patientLink,
//         ],
//       });
//             await PhysioAppointment.updateOne(
//               { _id: appt._id },
//               { $set: { reminder_30_patient_sent: true } }
//             );
//             console.log(`✅ [PhysioReminder] Patient reminder sent → ${patientPhone}`);
//           } catch (err) {
//             console.error(`❌ [PhysioReminder] Patient reminder failed for ${appt._id}:`,
//               err?.response?.data || err.message);
//           }
//         }

//         // ── 2. Doctor reminder ──────────────────────────────────────────────
//       // ── 2. Doctor reminder ──────────────────────────────────────────────────────
// if (!appt.reminder_30_doctor_sent && doctorPhone) {
//     try {
//       await sendTemplateMessage({
//         to:           `91${doctorPhone}`,
//         templateName: "doctor_remainder_notification",   // ← change this
//         language:     "en",
//         params: [
//           patientName,
//           apptMoment.format("h:mm A"),   // "3:00 PM"
//           appt.concern || "consultation",
//           doctorLink,
//         ],
//       });
//             await PhysioAppointment.updateOne(
//               { _id: appt._id },
//               { $set: { reminder_30_doctor_sent: true } }
//             );
//             console.log(`✅ [PhysioReminder] Doctor reminder sent → 91${doctorPhone}`);
//           } catch (err) {
//             console.error(`❌ [PhysioReminder] Doctor reminder failed for ${appt._id}:`,
//               err?.response?.data || err.message);
//           }
//         } else if (!doctorPhone) {
//           console.warn(`⚠️ [PhysioReminder] No doctor phone for appt ${appt._id} — skipping doctor reminder`);
//         }

//       } catch (innerErr) {
//         console.error(`[PhysioReminder] Error processing appt ${appt._id}:`, innerErr);
//       }
//     }

//   } catch (err) {
//     console.error("[PhysioReminder] Top-level error:", err);
//   }
// }

// // ── Scheduler ─────────────────────────────────────────────────────────────────
// function startPhysioReminderJob() {
//   // Run once immediately on startup, then every 3 minutes
//   processPhysioReminders().catch(e =>
//     console.error("[PhysioReminder] Initial run failed:", e)
//   );

//   cron.schedule("*/3 * * * *", async () => {
//     try {
//       await processPhysioReminders();
//     } catch (e) {
//       console.error("[PhysioReminder] Scheduled run error:", e);
//     }
//   }, {
//     scheduled: true,
//     timezone:  TZ,
//   });

//   console.log("✅ PhysioReminder job scheduled — every 3 min (Asia/Kolkata)");
// }

// module.exports = { startPhysioReminderJob, processPhysioReminders };


// jobs/physioReminderJob.js
// Sends 30-minute pre-session WhatsApp + FCM push reminders for physio_appointments
// Runs every 3 minutes — checks for appointments in the next 29–31 min window
// Uses: Superfone sendTemplateMessage, Doctor model for doctor phone,
//       sendNotificationToDoctor for FCM push to doctor's app

const cron    = require("node-cron");
const moment  = require("moment-timezone");
const PhysioAppointment = require("../Models/PhysioAppointment");
const Doctor            = require("../Models/Doctor");
const { sendTemplateMessage } = require("../utils/superfone");
const { sendNotificationToDoctor } = require("../Routes/notification");

const TZ = "Asia/Kolkata";

// ── Parse "9:00 AM" + "2026-06-14T18:30:00.000Z" → moment in IST ─────────────
function parsePhysioMoment(dateISO, timeSlot) {
  if (!dateISO || !timeSlot) return null;
  try {
    // dateISO "2026-06-09T18:30:00.000Z" is IST midnight stored as UTC
    // We must parse it in IST first, then take the IST date, then combine with slot time
    const dateStrIST = moment.tz(dateISO, TZ).format("YYYY-MM-DD");
    const dt = moment.tz(`${dateStrIST} ${timeSlot}`, "YYYY-MM-DD h:mm A", TZ);
    return dt.isValid() ? dt : null;
  } catch {
    return null;
  }
}

// ── Main reminder processor ───────────────────────────────────────────────────
async function processPhysioReminders() {
  try {
    const now      = moment().tz(TZ);
    const todayISO = now.clone().format("YYYY-MM-DD");

    // Fetch confirmed physio appointments for today/tomorrow that haven't had reminders sent
    const tomorrowISO = now.clone().add(1, "day").format("YYYY-MM-DD");

    const candidates = await PhysioAppointment.find({
      status: "confirmed",
      $or: [
        { date: { $regex: `^${todayISO}` } },
        { date: { $regex: `^${tomorrowISO}` } },
      ],
      $or: [
        { reminder_30_patient_sent: { $ne: true } },
        { reminder_30_doctor_sent:  { $ne: true } },
      ],
    }).lean();

    if (!candidates?.length) return;

    console.log(`[PhysioReminder] ${candidates.length} candidate(s) found`);

    for (const appt of candidates) {
      try {
        const apptMoment = parsePhysioMoment(appt.date, appt.time);
        if (!apptMoment) {
          console.warn(`[PhysioReminder] Could not parse time for appt ${appt._id}`);
          continue;
        }

        const diffMinutes = Math.round(apptMoment.diff(now, "minutes", true));

        // Only act in the 29–31 minute window
        if (diffMinutes < 29 || diffMinutes > 31) continue;

        console.log(`[PhysioReminder] Appt ${appt._id} is ${diffMinutes} min away — sending reminders`);

        const patientName  = appt.patient_name  || "Patient";
        const patientPhone = appt.patient_phone || ""; // already "91XXXXXXXXXX"

        // ── Resolve doctor ──────────────────────────────────────────────────
        let doctorDoc = null;
        try {
          if (appt.doctor_ref) {
            doctorDoc = await Doctor.findById(appt.doctor_ref)
              .select("_id doctor_id name phone_number")
              .lean();
          }
          if (!doctorDoc && appt.doctor_id) {
            doctorDoc = await Doctor.findOne({ doctor_id: appt.doctor_id })
              .select("_id doctor_id name phone_number")
              .lean();
          }
        } catch (docErr) {
          console.warn(`[PhysioReminder] Doctor lookup failed for appt ${appt._id}:`, docErr.message);
        }

        const doctorName  = doctorDoc?.name   || "Doctor";
        const doctorPhone = doctorDoc?.phone_number || null; // 10-digit

        // ── Use stored links (set during verify-payment) ────────────────────
        const FRONTEND = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
        const patientLink = appt.patient_link
          || (appt.twilio_room_name ? `${FRONTEND}/consult/${appt.twilio_room_name}` : "");
        const doctorLink  = appt.doctor_link
          || (appt.twilio_room_name && doctorDoc
            ? `${FRONTEND}/doctor/join/${appt.twilio_room_name}?doctorId=${doctorDoc._id}&doctorUsername=${encodeURIComponent(doctorName)}`
            : "");

        // ── 1. Patient reminder (WhatsApp) ──────────────────────────────────
        if (!appt.reminder_30_patient_sent && patientPhone) {
          try {
            await sendTemplateMessage({
              to:           patientPhone,
              templateName: "patient_appointment_remainder_new",
              language:     "en_US",
              params: [
                patientName,
                apptMoment.format("h:mm A"),   // "3:00 PM"
                appt.concern || "consultation",
                patientLink,
              ],
            });
            await PhysioAppointment.updateOne(
              { _id: appt._id },
              { $set: { reminder_30_patient_sent: true } }
            );
            console.log(`✅ [PhysioReminder] Patient WA sent → ${patientPhone}`);
          } catch (err) {
            console.error(`❌ [PhysioReminder] Patient WA failed for ${appt._id}:`,
              err?.response?.data || err.message);
          }
        }

        // ── 2. Doctor reminder (WhatsApp + FCM push) ────────────────────────
        if (!appt.reminder_30_doctor_sent) {

          // 2a. WhatsApp
          if (doctorPhone) {
            try {
              await sendTemplateMessage({
                to:           `91${doctorPhone}`,
                templateName: "doctor_remainder_notification",
                language:     "en",
                params: [
                  patientName,
                  apptMoment.format("h:mm A"),   // "3:00 PM"
                  appt.concern || "consultation",
                  doctorLink,
                ],
              });
              console.log(`✅ [PhysioReminder] Doctor WA sent → 91${doctorPhone}`);
            } catch (err) {
              console.error(`❌ [PhysioReminder] Doctor WA failed for ${appt._id}:`,
                err?.response?.data || err.message);
            }
          } else {
            console.warn(`⚠️ [PhysioReminder] No doctor phone for appt ${appt._id} — skipping doctor WA`);
          }

          // 2b. FCM push to doctor's app
          if (appt.doctor_id) {
            try {
              const pushResult = await sendNotificationToDoctor(appt.doctor_id, {
                title: "Upcoming Session Reminder",
                body:  `${patientName} — ${appt.concern || "consultation"} at ${apptMoment.format("h:mm A")}`,
                data: {
                  type:          "session_reminder",
                  appointmentId: appt._id.toString(),
                  date:          appt.date || "",
                  time:          appt.time || "",
                },
              });
              if (pushResult.success) {
                console.log(`✅ [PhysioReminder] Doctor push sent → ${appt.doctor_id}`);
              } else {
                console.warn(`⚠️ [PhysioReminder] Doctor push not sent (${pushResult.reason}) → ${appt.doctor_id}`);
              }
            } catch (pushErr) {
              console.error(`❌ [PhysioReminder] Doctor push failed for ${appt._id}:`, pushErr.message);
            }
          } else {
            console.warn(`⚠️ [PhysioReminder] No doctor_id for appt ${appt._id} — skipping doctor push`);
          }

          // Mark as sent regardless of individual channel outcomes —
          // WA/push failures are logged but shouldn't cause repeated retries
          await PhysioAppointment.updateOne(
            { _id: appt._id },
            { $set: { reminder_30_doctor_sent: true } }
          );
        }

      } catch (innerErr) {
        console.error(`[PhysioReminder] Error processing appt ${appt._id}:`, innerErr);
      }
    }

  } catch (err) {
    console.error("[PhysioReminder] Top-level error:", err);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startPhysioReminderJob() {
  // Run once immediately on startup, then every 3 minutes
  processPhysioReminders().catch(e =>
    console.error("[PhysioReminder] Initial run failed:", e)
  );

  cron.schedule("*/3 * * * *", async () => {
    try {
      await processPhysioReminders();
    } catch (e) {
      console.error("[PhysioReminder] Scheduled run error:", e);
    }
  }, {
    scheduled: true,
    timezone:  TZ,
  });

  console.log("✅ PhysioReminder job scheduled — every 3 min (Asia/Kolkata)");
}

module.exports = { startPhysioReminderJob, processPhysioReminders };