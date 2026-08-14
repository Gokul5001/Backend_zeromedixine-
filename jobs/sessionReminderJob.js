// jobs/sessionReminderJob.js
const cron = require("node-cron");
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const AddSession = require("../Models/AddSession"); // your model file
const Appointment = require("../Models/Appointment"); // to populate patient info
const { sendTemplateMessage } = require("../utils/aisensy");

// Helper: normalize phone
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

// Reuse parseAppointmentMoment logic (copy from your reminderJob)
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

// Build links: prefer stored twilioRoom link; fallback to FRONTEND_URL + roomName or appointment id
function buildSessionLinks(session, addSessionDoc) {
  // session: the session object inside sessions[]
  // addSessionDoc: the parent AddSession doc
  // doctor link
  let doctorLink = session.twilioRoomDoctor && session.twilioRoomDoctor.link ? session.twilioRoomDoctor.link : null;
  let patientLink = session.twilioRoomPatient && session.twilioRoomPatient.link ? session.twilioRoomPatient.link : null;

  const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  // if links missing but roomName exists, construct absolute
  if (!patientLink) {
    const rn = (session.twilioRoomPatient && session.twilioRoomPatient.roomName) || (session.twilioRoom && session.twilioRoom.roomName);
    if (rn) patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${rn}` : `https://www.zeromedixine.com/consult/${rn}`;
  }
  if (!doctorLink) {
    const rn = (session.twilioRoomDoctor && session.twilioRoomDoctor.roomName) || (session.twilioRoom && session.twilioRoom.roomName);
    if (rn) doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${rn}` : `https://www.zeromedixine.com/doctor/join/${rn}`;
  }

  // Last-resort: build using appointmentId + session index
  if (!patientLink && addSessionDoc && addSessionDoc.appointmentId) {
    patientLink = FRONTEND_URL ? `${FRONTEND_URL}/consult/${addSessionDoc.appointmentId}` : `https://www.zeromedixine.com/consult/${addSessionDoc.appointmentId}`;
  }
  if (!doctorLink && addSessionDoc && addSessionDoc.appointmentId) {
    doctorLink = FRONTEND_URL ? `${FRONTEND_URL}/doctor/join/${addSessionDoc.appointmentId}` : `https://www.zeromedixine.com/doctor/join/${addSessionDoc.appointmentId}`;
  }

  return { patientLink, doctorLink };
}

async function processSessionReminders() {
  try {
    const now = moment().tz("Asia/Kolkata");
    const today = now.clone().format("YYYY-MM-DD");
    const tomorrow = now.clone().add(1, "day").format("YYYY-MM-DD");

    const docs = await AddSession.find({
      "sessions": {
        $elemMatch: {
          sendReminder: true,
          $or: [
            { sessionNotificationSent: { $exists: false } },
            { sessionNotificationSent: false }
          ],
          date: { $in: [today, tomorrow] }
        }
      }
    })
    .populate({
      path: "appointmentId",
      select: "name phone whatsAppOptIn"
    })
    .lean();

    if (!docs.length) return;

    for (const doc of docs) {

      for (const session of (doc.sessions || [])) {

        if (!session.sendReminder) continue;
        if (session.sessionNotificationSent) continue;
        if (!session.date || !session.time) continue;

        const sessionMoment = parseAppointmentMoment(session.date, session.time);
        if (!sessionMoment) continue;

        const diffMinutes = Math.round(sessionMoment.diff(now, "minutes", true));
        if (!(diffMinutes >= 29 && diffMinutes <= 31)) continue;

        // =========================================================
        // Build Links (always production safe)
        // =========================================================
        const FRONTEND_URL =
          (process.env.FRONTEND_URL || "https://www.zeromedixine.com")
            .replace(/\/$/, "");

        let patientLink =
          session?.twilioRoomPatient?.link ||
          `${FRONTEND_URL}/consult/${session?.twilioRoomPatient?.roomName || doc.appointmentId?._id}`;

        let doctorLink =
          session?.twilioRoomDoctor?.link ||
          `${FRONTEND_URL}/doctor/join/${session?.twilioRoomDoctor?.roomName || doc.appointmentId?._id}`;

        // =========================================================
        // Prepare Template Data
        // =========================================================
        const patientName =
          doc.appointmentId?.name || session.patientName || "Patient";

        const packageName =
          doc.package_snapshot?.package_name || "Session Package";

        const concern =
          doc.package_snapshot?.concern ||
          session.concern ||
          "consultation";

        const idx = String(session.index || "1");
        const timeStr = sessionMoment.format("hh:mm A");

        // =========================================================
        // 👤 PATIENT SESSION REMINDER
        // =========================================================
        if (doc.appointmentId?.whatsAppOptIn) {

          const patientPhone = normalizePhone(doc.appointmentId.phone || "");

          if (patientPhone) {
            const pParams = [
              patientName,  // {{1}}
              idx,          // {{2}}
              packageName,  // {{3}}
              timeStr,      // {{4}}
              concern,      // {{5}}
              patientLink   // {{6}}
            ];

            console.log("📤 Superfone PATIENT session reminder:", {
              to: patientPhone,
              params: pParams
            });

            try {
              await sendTemplateMessage({
                to: patientPhone,
                templateName: "patient_session_remainder_notification",
                language: "en",
                params: pParams
              });

              console.log("✅ Patient session reminder sent:", patientPhone);

            } catch (err) {
              console.error(
                "❌ Patient session reminder failed:",
                err?.response?.data || err?.message || err
              );
            }
          }
        }

        // =========================================================
        // 👨‍⚕️ DOCTOR SESSION REMINDER
        // =========================================================
        let doctorPhonesToNotify = [];

        try {
          if (doc.doctorAssigned) {
            const credColl = mongoose.connection.collection("login_credentials");

            const cred = await credColl.findOne({
              _id: new mongoose.Types.ObjectId(doc.doctorAssigned)
            });

            if (cred) {
              const phone =
                cred.mobile_no ||
                cred.mobile ||
                cred.phone ||
                "";

              const normalized = normalizePhone(phone);
              if (normalized) doctorPhonesToNotify.push(normalized);
            }
          }
        } catch (err) {
          console.warn("Doctor resolution failed, fallback to NOTIFY_DOCTORS");
        }

        if (!doctorPhonesToNotify.length) {
          const fallback = (process.env.NOTIFY_DOCTORS || "")
            .split(",")
            .map(p => normalizePhone(p))
            .filter(Boolean);

          doctorPhonesToNotify.push(...fallback);
        }

        if (doctorPhonesToNotify.length) {

          const dParams = [
            idx,          // {{1}}
            packageName,  // {{2}}
            patientName,  // {{3}}
            timeStr,      // {{4}}
            concern,      // {{5}}
            doctorLink    // {{6}}
          ];

          console.log("📤 Superfone DOCTOR session reminder:", {
            phones: doctorPhonesToNotify,
            params: dParams
          });

          const sends = doctorPhonesToNotify.map(phone =>
            sendTemplateMessage({
              to: phone,
              templateName: "doctor_session_remainder_notification",
              language: "en",
              params: dParams
            })
          );

          await Promise.allSettled(sends);

          console.log("✅ Doctor session reminder processed:", doc._id);
        }

        // =========================================================
        // Mark Session As Notified
        // =========================================================
        await AddSession.updateOne(
          { _id: doc._id },
          {
            $set: {
              "sessions.$[s].sessionNotificationSent": true,
              "sessions.$[s].sessionNotificationSentAt": new Date()
            }
          },
          {
            arrayFilters: [{ "s.index": session.index }]
          }
        );

        console.log("✔ Marked sessionNotificationSent:", doc._id, idx);
      }
    }

  } catch (err) {
    console.error("Session reminder job error:", err);
  }
}

function startSessionReminderJob() {
  // run immediately at startup
  processSessionReminders().catch(e => console.error("Initial session reminders run failed:", e));

  // schedule every minute (change frequency if required)
  cron.schedule("*/5 * * * *", async () => {
    try {
      await processSessionReminders();
    } catch (e) {
      console.error("Scheduled session reminder run error:", e);
    }
  }, { scheduled: true, timezone: "Asia/Kolkata" });

  console.log("Session reminder job scheduled to run every minute (Asia/Kolkata).");
}

module.exports = { startSessionReminderJob, processSessionReminders };
