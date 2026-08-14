// Routes/addSessionReschedule.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const AddSession = require("../Models/AddSession");
const Appointment = require("../Models/Appointment");
const LoginCred = require("../Models/Logincredential");
// const { sendTemplateMessage } = require("../utils/aisensy"); // your existing util
const { sendTemplateMessage } = require("../utils/superfone");

// Small phone normalizer (reuse your project's helper if present)
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

// Safe wrapper around sendTemplateMessage so callers get structured response
async function sendWaSafe(payload) {
  try {
    const r = await sendTemplateMessage(payload);
    // If your util returns structured object, normalize here:
    if (r && typeof r === "object" && r.ok === false) {
      return { ok: false, error: r.error || r };
    }
    // If util returned axios-like response with data.success, we still mark ok
    return { ok: true, data: r };
  } catch (err) {
    return { ok: false, error: err?.response?.data || err?.message || String(err) };
  }
}

// GET single addSession/session entry
// GET single addSession/session entry + include patient & package details
router.get("/:addSessionId/session/:index", async (req, res) => {
    try {
      const { addSessionId, index } = req.params;
      const idx = Number(index);
  
      const doc = await AddSession.findById(addSessionId).lean();
      if (!doc)
        return res.status(404).json({ success: false, message: "AddSession not found" });
  
      // find session
      const session = (doc.sessions || []).find((s) => Number(s.index) === idx);
  
      // fetch appointment
      const appointment = await Appointment.findById(doc.appointmentId).lean();
  
      return res.json({
        success: true,
        addSessionId,
        session: {
          ...session,
          reschedule: session?.reschedule || null,
        },
  
        // newly added
        appointment: appointment
          ? {
              _id: appointment._id,
              name: appointment.name,
              age: appointment.age,
              gender: appointment.gender,
              phone: appointment.phone,
              appointment_date: appointment.appointment_date,
              appointment_time: appointment.appointment_time,
              concern: appointment.primaryConcern,
            }
          : null,
  
        package: doc.package_snapshot || null,
  
        appointmentId: doc.appointmentId
      });
    } catch (err) {
      console.error("GET session error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Server error", error: String(err) });
    }
  });
  
  
  

// POST request_reschedule (patient)
router.post("/:addSessionId/session/:index/request_reschedule", async (req, res) => {
  try {
    const { addSessionId, index } = req.params;
    const { newDate, newTime, reason, requestedBy } = req.body || {};
    const idx = Number(index);
    if (!addSessionId || Number.isNaN(idx)) return res.status(400).json({ success:false, message: "Invalid ids" });
    if (!newDate || !newTime) return res.status(400).json({ success:false, message: "newDate and newTime required" });

    const doc = await AddSession.findById(addSessionId);
    if (!doc) return res.status(404).json({ success:false, message: "AddSession not found" });

    // find session entry index
    const sessIndex = doc.sessions.findIndex(s => Number(s.index) === idx);
    if (sessIndex === -1) return res.status(404).json({ success:false, message: "Session entry not found" });

    // update subdoc reschedule
    doc.sessions[sessIndex].reschedule = doc.sessions[sessIndex].reschedule || {};
    doc.sessions[sessIndex].reschedule.newDate = String(newDate);
    doc.sessions[sessIndex].reschedule.newTime = String(newTime);
    doc.sessions[sessIndex].reschedule.reason = reason || null;
    doc.sessions[sessIndex].reschedule.status = "requested";
    doc.sessions[sessIndex].reschedule.requestedBy = requestedBy || (req.body.requestedBy) || "patient";
    doc.sessions[sessIndex].reschedule.requestedAt = new Date();

    await doc.save();

    // fetch appointment for patient/phone
    const appt = await Appointment.findById(doc.appointmentId).lean();

    // Build doctor phone list
    const doctorPhones = [];
    if (doc.doctorAssigned) {
      const doctor = await LoginCred.findById(doc.doctorAssigned).lean();
      if (doctor) {
        const dp = normalizePhone(doctor.mobile_no || doctor.mobile || doctor.phone || doctor.mobile_no || "");
        if (dp) doctorPhones.push(dp);
      }
    }
    // fallback: NOTIFY_DOCTORS env list
    if (!doctorPhones.length && process.env.NOTIFY_DOCTORS) {
      process.env.NOTIFY_DOCTORS.split(",").map(s => s.replace(/\+/g,"").trim()).forEach(p => {
        const n = normalizePhone(p);
        if (n) doctorPhones.push(n);
      });
    }

    const waErrors = [];

    // --- DOCTOR WA (match your 'reschedule_link' template which expects [name, link]) ---
/* ----------------------------------------
   👨‍⚕️ DOCTOR WA (Superfone)
---------------------------------------- */
try {
  const patientNameForTemplate =
    appt?.name || "Patient";

  const reviewLink =
    `${process.env.FRONTEND_URL || "https://www.zeromedixine.com"}/reschedule/review/${String(addSessionId)}/${String(idx)}`;

  const doctorParams = [
    patientNameForTemplate,  // {{1}}
    reviewLink               // {{2}}
  ];

  if (!doctorPhones.length) {
    console.warn("No doctor phone found to notify");
  } else {
    await Promise.all(
      doctorPhones.map(async (dp) => {

        console.log("📤 Superfone DOCTOR reschedule:", {
          to: dp,
          params: doctorParams
        });

        await sendTemplateMessage({
          to: dp,
          templateName: "reschedule_link",
          language: "en",
          params: doctorParams
        });

        console.log("✅ Doctor WA sent to", dp);
      })
    );
  }

} catch (err) {
  console.error("Doctor WA error (non-fatal):",
    err?.response?.data || err?.message || err
  );
}

    // --- PATIENT ACK WA (robust trimming + best-effort send) ---
    // try {
    //   const patientPhone = normalizePhone(appt?.phone || appt?.contact || "");
    //   if (!patientPhone) {
    //     console.warn("No patient phone found to notify");
    //   } else {
    //     // full params you might want to send; adjust order if your template expects different order
    //     const fullPatientParams = [
    //       appt?.name || "Patient",
    //       String(idx),          // session index / id
    //       String(newDate),
    //       String(newTime)
    //     ];

    //     // read expected count from env (default 2 to be safe)
    //     const expectedCount = Number(process.env.AISENSY_PATIENT_RESCHEDULE_ACK_PARAM_COUNT || 2);

    //     // trim to expected length (do not pad)
    //     const patientParams = fullPatientParams.slice(0, expectedCount);

    //     if (patientParams.length !== fullPatientParams.length) {
    //       console.warn(`AiSensy patient ack: trimming params to expected count ${expectedCount}`, {
    //         fullPatientParams, patientParams
    //       });
    //     }

    //     const payload = {
    //       to: patientPhone,
    //       campaignName: process.env.AISENSY_PATIENT_RESCHEDULE_ACK_CAMPAIGN || "patient_reschedule_request_ack",
    //       templateName: process.env.AISENSY_PATIENT_RESCHEDULE_ACK_TEMPLATE || "patient_reschedule_request_ack",
    //       params: patientParams
    //     };

    //     const r = await sendWaSafe(payload);
    //     if (!r.ok) {
    //       console.warn("Patient ack WA failed:", r.error);
    //       waErrors.push({ to: patientPhone, error: r.error, payload });
    //     } else {
    //       console.log("Patient ack WA sent to", patientPhone);
    //     }
    //   }
    // } catch (err) {
    //   console.warn("Patient ack WA unexpected error (non-fatal):", err);
    //   waErrors.push({ error: String(err) });
    // }

    /* ----------------------------------------
   👤 PATIENT ACK WA (Superfone)
---------------------------------------- */
  try {
    const patientPhone =
      normalizePhone(appt?.phone || appt?.contact || "");

    if (!patientPhone) {
      console.warn("No patient phone found to notify");
    } else {

      const patientParams = [
        appt?.name || "Patient",  // {{1}}
        String(idx)               // {{2}}
      ];

      console.log("📤 Superfone PATIENT reschedule ack:", {
        to: patientPhone,
        params: patientParams
      });

      await sendTemplateMessage({
        to: patientPhone,
        templateName: "patient_reschedule",
        language: "en",
        params: patientParams
      });

      console.log("✅ Patient ack WA sent to", patientPhone);
    }

  } catch (err) {
    console.warn("Patient ack WA error (non-fatal):",
      err?.response?.data || err?.message || err
    );
  }

      return res.json({
        success: true,
        message: "Reschedule requested and notifications attempted (best-effort).",
        addSession: doc,
        waErrors
      });
    } catch (err) {
      console.error("request_reschedule error:", err);
      return res.status(500).json({ success:false, message: "Server error", error: String(err) });
    }
  });

// POST confirm_reschedule (doctor)
// router.post("/:addSessionId/session/:index/confirm_reschedule", async (req, res) => {
//   try {
//     const { addSessionId, index } = req.params;
//     const { reviewNote, reviewedBy } = req.body || {};
//     const idx = Number(index);
//     if (!addSessionId || Number.isNaN(idx)) return res.status(400).json({ success:false, message: "Invalid ids" });

//     const doc = await AddSession.findById(addSessionId);
//     if (!doc) return res.status(404).json({ success:false, message: "AddSession not found" });

//     const sessIndex = doc.sessions.findIndex(s => Number(s.index) === idx);
//     if (sessIndex === -1) return res.status(404).json({ success:false, message: "Session entry not found" });

//     const r = doc.sessions[sessIndex].reschedule || {};
//     if (!r || !r.newDate || !r.newTime) {
//       return res.status(400).json({ success:false, message: "No reschedule request found for this session" });
//     }

//     // Apply new date/time to the session entry's date/time fields
//     doc.sessions[sessIndex].date = r.newDate;
//     doc.sessions[sessIndex].time = r.newTime;
//     try {
//       const dt = new Date(`${r.newDate}T${r.newTime}:00`);
//       if (!isNaN(dt.getTime())) doc.sessions[sessIndex].scheduledAt = dt;
//     } catch (e) { /* ignore */ }

//     doc.sessions[sessIndex].reschedule.status = "confirmed";
//     doc.sessions[sessIndex].reschedule.reviewedBy = reviewedBy ? mongoose.Types.ObjectId(reviewedBy) : null;
//     doc.sessions[sessIndex].reschedule.reviewedAt = new Date();
//     doc.sessions[sessIndex].reschedule.reviewNote = reviewNote || null;

//     await doc.save();

//     // notify patient of confirmed reschedule (best-effort)
//     const appt = await Appointment.findById(doc.appointmentId).lean();
//     const patientPhone = normalizePhone(appt?.phone || appt?.contact || "");
//     const waErrors = [];
//     if (patientPhone) {
//       const fullConfirmParams = [ appt?.name || "Patient", String(idx), doc.sessions[sessIndex].date || r.newDate, doc.sessions[sessIndex].time || r.newTime ];
//       const expectedConfirmCount = Number(process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_PARAM_COUNT || 2);
//       const confirmParams = fullConfirmParams.slice(0, expectedConfirmCount);
//       if (confirmParams.length !== fullConfirmParams.length) {
//         console.warn("Trimming confirm params to expected count", expectedConfirmCount, { fullConfirmParams, confirmParams });
//       }
//       const payload = {
//         to: patientPhone,
//         campaignName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_CAMPAIGN || "patient_reschedule_confirm",
//         templateName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_TEMPLATE || "patient_reschedule_confirm",
//         params: confirmParams
//       };
//       const r2 = await sendWaSafe(payload);
//       if (!r2.ok) {
//         console.warn("Patient confirm WA failed:", r2.error);
//         waErrors.push({ to: patientPhone, error: r2.error, payload });
//       } else {
//         console.log("Patient confirm WA sent to", patientPhone);
//       }
//     } else {
//       console.warn("No patient phone to send confirm WA");
//     }

//     return res.json({ success: true, message: "Reschedule confirmed and patient notified (best-effort).", addSession: doc, waErrors });
//   } catch (err) {
//     console.error("confirm_reschedule error:", err);
//     return res.status(500).json({ success:false, message: "Server error", error: String(err) });
//   }
// });


// screenshot reference (for debugging): /mnt/data/e3019e8a-c43e-479b-b9bc-640c6c9a7eda.png

// POST /:addSessionId/session/:index/confirm_reschedule
// router.post("/:addSessionId/session/:index/confirm_reschedule", async (req, res) => {
//     try {
//       const { addSessionId, index } = req.params;
//       const { reviewNote, reviewedBy } = req.body || {};
//       const idx = Number(index);
  
//       if (!addSessionId || Number.isNaN(idx)) {
//         return res.status(400).json({ success: false, message: "Invalid ids" });
//       }
  
//       // load AddSession
//       const doc = await AddSession.findById(addSessionId);
//       if (!doc) return res.status(404).json({ success: false, message: "AddSession not found" });
  
//       const sessIndex = doc.sessions.findIndex((s) => Number(s.index) === idx);
//       if (sessIndex === -1) return res.status(404).json({ success: false, message: "Session entry not found" });
  
//       // ensure reschedule exists and has requested values
//       const r = (doc.sessions[sessIndex].reschedule) ? doc.sessions[sessIndex].reschedule : null;
//       if (!r || !r.newDate || !r.newTime) {
//         return res.status(400).json({ success: false, message: "No reschedule request found for this session" });
//       }
  
//       // --- Apply new date/time to the session entry ---
//       doc.sessions[sessIndex].date = String(r.newDate);
//       doc.sessions[sessIndex].time = String(r.newTime);
  
//       try {
//         const dt = new Date(`${r.newDate}T${r.newTime}:00`);
//         if (!Number.isNaN(dt.getTime())) doc.sessions[sessIndex].scheduledAt = dt;
//       } catch (e) {
//         // ignore scheduling date parse errors - keep existing scheduledAt
//         console.warn("confirm_reschedule: unable to parse scheduledAt from newDate/newTime", e);
//       }
  
//       // --- safely convert reviewedBy to ObjectId if provided ---
//       let reviewerObjectId = null;
//       try {
//         if (reviewedBy) reviewerObjectId = new mongoose.Types.ObjectId(String(reviewedBy));
//       } catch (convErr) {
//         console.warn("confirm_reschedule: reviewedBy conversion failed, ignoring reviewedBy:", convErr?.message || convErr);
//         reviewerObjectId = null;
//       }
  
//       // update reschedule metadata
//       doc.sessions[sessIndex].reschedule = doc.sessions[sessIndex].reschedule || {};
//       doc.sessions[sessIndex].reschedule.status = "confirmed";
//       doc.sessions[sessIndex].reschedule.reviewedBy = reviewerObjectId;
//       doc.sessions[sessIndex].reschedule.reviewedAt = new Date();
//       doc.sessions[sessIndex].reschedule.reviewNote = reviewNote || null;
  
//       // save the document
//       await doc.save();
  
//       // --- Notify patient (best-effort) ---
//       const appt = await Appointment.findById(doc.appointmentId).lean();
//       const patientPhoneRaw = appt?.phone || appt?.contact || appt?.customer?.contact || appt?.customer?.phone || "";
//       const patientPhone = normalizePhone(patientPhoneRaw);
  
//       const waErrors = [];
//       if (patientPhone) {
//         try {
//           const fullConfirmParams = [
//             appt?.name || appt?.customer?.name || "Patient",
//             String(idx),
//             String(doc.sessions[sessIndex].date || r.newDate),
//             String(doc.sessions[sessIndex].time || r.newTime)
//           ];
  
//           const expectedConfirmCount = Number(process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_PARAM_COUNT || 2);
//           const confirmParams = fullConfirmParams.slice(0, expectedConfirmCount);
  
//           if (confirmParams.length !== fullConfirmParams.length) {
//             console.warn("confirm_reschedule: trimming confirm params to expected count", expectedConfirmCount, { fullConfirmParams, confirmParams });
//           }
  
//           const payload = {
//             to: patientPhone,
//             campaignName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_CAMPAIGN || "patient_reschedule_confirm",
//             templateName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_TEMPLATE || "patient_reschedule_confirm",
//             params: confirmParams
//           };
  
//           const sendResult = await sendWaSafe(payload);
//           if (!sendResult.ok) {
//             console.warn("Patient confirm WA failed:", sendResult.error);
//             waErrors.push({ to: patientPhone, error: sendResult.error, payload });
//           } else {
//             console.log("Patient confirm WA sent to", patientPhone);
//           }
//         } catch (err) {
//           console.warn("Patient confirm WA unexpected error:", err);
//           waErrors.push({ to: patientPhone, error: String(err) });
//         }
//       } else {
//         console.warn("confirm_reschedule: no patient phone to notify");
//       }
  
//       return res.json({
//         success: true,
//         message: "Reschedule confirmed and patient notified (best-effort).",
//         addSession: doc,
//         waErrors
//       });
//     } catch (err) {
//       console.error("confirm_reschedule error:", err);
//       return res.status(500).json({ success: false, message: "Server error", error: String(err) });
//     }
//   });


// screenshot reference (for debugging): /mnt/data/e3019e8a-c43e-479b-b9bc-640c6c9a7eda.png

// POST /:addSessionId/session/:index/confirm_reschedule
router.post("/:addSessionId/session/:index/confirm_reschedule", async (req, res) => {
    try {
      const { addSessionId, index } = req.params;
      const { reviewNote, reviewedBy } = req.body || {};
      const idx = Number(index);
  
      if (!addSessionId || Number.isNaN(idx)) {
        return res.status(400).json({ success: false, message: "Invalid ids" });
      }
  
      // load AddSession
      const doc = await AddSession.findById(addSessionId);
      if (!doc) return res.status(404).json({ success: false, message: "AddSession not found" });
  
      const sessIndex = doc.sessions.findIndex((s) => Number(s.index) === idx);
      if (sessIndex === -1) return res.status(404).json({ success: false, message: "Session entry not found" });
  
      // ensure reschedule exists and has requested values
      const r = (doc.sessions[sessIndex] && doc.sessions[sessIndex].reschedule) ? doc.sessions[sessIndex].reschedule : null;
      if (!r || !r.newDate || !r.newTime) {
        return res.status(400).json({ success: false, message: "No reschedule request found for this session" });
      }
  
      // --- Apply new date/time to the session entry ---
      doc.sessions[sessIndex].date = String(r.newDate);
      doc.sessions[sessIndex].time = String(r.newTime);
  
      try {
        const dt = new Date(`${r.newDate}T${r.newTime}:00`);
        if (!Number.isNaN(dt.getTime())) doc.sessions[sessIndex].scheduledAt = dt;
      } catch (e) {
        console.warn("confirm_reschedule: unable to parse scheduledAt from newDate/newTime", e);
      }
  
      // --- safely convert reviewedBy to ObjectId if provided ---
      let reviewerObjectId = null;
      try {
        if (reviewedBy) reviewerObjectId = new mongoose.Types.ObjectId(String(reviewedBy));
      } catch (convErr) {
        console.warn("confirm_reschedule: reviewedBy conversion failed, ignoring reviewedBy:", convErr?.message || convErr);
        reviewerObjectId = null;
      }
  
      // update reschedule metadata
      doc.sessions[sessIndex].reschedule = doc.sessions[sessIndex].reschedule || {};
      doc.sessions[sessIndex].reschedule.status = "confirmed";
      doc.sessions[sessIndex].reschedule.reviewedBy = reviewerObjectId;
      doc.sessions[sessIndex].reschedule.reviewedAt = new Date();
      doc.sessions[sessIndex].reschedule.reviewNote = reviewNote || null;
  
      // save the document
      await doc.save();
      console.log(`confirm_reschedule: AddSession ${addSessionId} session ${idx} updated.`);
  
      // --- Notify patient (best-effort) ---
      const appt = await Appointment.findById(doc.appointmentId).lean();
      if (!appt) console.warn("confirm_reschedule: appointment not found for AddSession", addSessionId);
  
      const patientPhoneRaw = appt?.phone || appt?.contact || appt?.customer?.contact || appt?.customer?.phone || "";
      const patientPhone = normalizePhone(patientPhoneRaw);
  
      const waErrors = [];
  
      // if (patientPhone) {
      //   try {
      //     // build params exactly in template order: {1}=name, {2}=sessionIndex, {3}=date, {4}=time
      //     const patientName = appt?.name || appt?.customer?.name || "Patient";
      //     const sessionIndexStr = String(idx);
      //     const sessionDate = String(doc.sessions[sessIndex].date || r.newDate || "");
      //     const sessionTime = String(doc.sessions[sessIndex].time || r.newTime || "");
  
      //     const fullConfirmParams = [ patientName, sessionIndexStr, sessionDate, sessionTime ];
  
      //     // prefer explicit env param count if set, otherwise send all 4 (your template requires 4)
      //     const expectedConfirmCount = Number(process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_PARAM_COUNT || 4);
      //     const confirmParams = fullConfirmParams.slice(0, expectedConfirmCount);
  
      //     // Build payload using env variables you set
      //     const payload = {
      //       to: patientPhone,
      //       campaignName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_CAMPAIGN || "confirmation_link_new",
      //       templateName: process.env.AISENSY_PATIENT_CONFIRM_RESCHEDULE_TEMPLATE || "patient_confirm_requestrequest",
      //       params: confirmParams,
      //       // optional: include userName/source if your sendTemplateMessage expects them
      //       userName: patientName,
      //       source: "Zeromedixine_App"
      //     };
  
      //     // Log payload for debugging
      //     console.log("confirm_reschedule: sending AiSensy payload:", JSON.stringify(payload, null, 2));
  
      //     // send via your wrapper
      //     const sendResult = await sendWaSafe(payload);
  
      //     // log raw result for debugging (sendWaSafe already normalizes but log it)
      //     console.log("confirm_reschedule: AiSensy sendResult:", JSON.stringify(sendResult, null, 2));
  
      //     if (!sendResult.ok) {
      //       console.warn("Patient confirm WA failed:", sendResult.error);
      //       waErrors.push({ to: patientPhone, error: sendResult.error, payload });
      //     } else {
      //       console.log("Patient confirm WA sent to", patientPhone);
      //     }
      //   } catch (err) {
      //     console.warn("Patient confirm WA unexpected error:", err);
      //     waErrors.push({ to: patientPhone, error: String(err) });
      //   }
      // } else {
      //   console.warn("confirm_reschedule: no patient phone to notify for appointment", doc.appointmentId);
      // }

      /* ----------------------------------------
   👤 PATIENT WA (Superfone confirm_reschedule)
---------------------------------------- */

if (patientPhone) {
  try {

    const patientName =
      appt?.name ||
      appt?.customer?.name ||
      "Patient";

    const sessionIndexStr = String(idx);
    const sessionDate =
      String(doc.sessions[sessIndex].date || r.newDate || "");

    const sessionTime =
      String(doc.sessions[sessIndex].time || r.newTime || "");

    const confirmParams = [
      patientName,       // {{1}}
      sessionIndexStr,   // {{2}}
      sessionDate,       // {{3}}
      sessionTime        // {{4}}
    ];

    console.log("📤 Superfone confirm_reschedule:", {
      to: patientPhone,
      template: "patient_confirm",
      params: confirmParams
    });

    await sendTemplateMessage({
      to: patientPhone,
      templateName: "patient_confirm",
      language: "en_US",
      params: confirmParams
    });

    console.log("✅ Patient confirm WA sent to", patientPhone);

  } catch (err) {
    console.warn(
      "❌ Patient confirm WA failed:",
      err?.response?.data || err?.message || err
    );
  }
} else {
  console.warn(
    "confirm_reschedule: no patient phone to notify for appointment",
    doc.appointmentId
  );
}
  
      return res.json({
        success: true,
        message: "Reschedule confirmed and patient notified (best-effort).",
        addSession: doc,
        waErrors
      });
    } catch (err) {
      console.error("confirm_reschedule error:", err);
      return res.status(500).json({ success: false, message: "Server error", error: String(err) });
    }
  });


  
  

// POST reject_reschedule (doctor)
router.post("/:addSessionId/session/:index/reject_reschedule", async (req, res) => {
  try {
    const { addSessionId, index } = req.params;
    const { reviewNote, reviewedBy } = req.body || {};
    const idx = Number(index);
    if (!addSessionId || Number.isNaN(idx)) return res.status(400).json({ success:false, message: "Invalid ids" });

    const doc = await AddSession.findById(addSessionId);
    if (!doc) return res.status(404).json({ success:false, message: "AddSession not found" });

    const sessIndex = doc.sessions.findIndex(s => Number(s.index) === idx);
    if (sessIndex === -1) return res.status(404).json({ success:false, message: "Session entry not found" });

    doc.sessions[sessIndex].reschedule = doc.sessions[sessIndex].reschedule || {};
    doc.sessions[sessIndex].reschedule.status = "rejected";
    doc.sessions[sessIndex].reschedule.reviewedBy = reviewedBy ? mongoose.Types.ObjectId(reviewedBy) : null;
    doc.sessions[sessIndex].reschedule.reviewedAt = new Date();
    doc.sessions[sessIndex].reschedule.reviewNote = reviewNote || null;

    await doc.save();

    // notify patient of rejection (best-effort)
    const appt = await Appointment.findById(doc.appointmentId).lean();
    const patientPhone = normalizePhone(appt?.phone || appt?.contact || "");
    const waErrors = [];
    if (patientPhone) {
      const fullRejectParams = [ appt?.name || "Patient", String(idx) ];
      const expectedRejectCount = Number(process.env.AISENSY_PATIENT_RESCHEDULE_REJECT_PARAM_COUNT || 2);
      const rejectParams = fullRejectParams.slice(0, expectedRejectCount);
      if (rejectParams.length !== fullRejectParams.length) {
        console.warn("Trimming reject params to expected count", expectedRejectCount, { fullRejectParams, rejectParams });
      }
      const payload = {
        to: patientPhone,
        campaignName: process.env.AISENSY_PATIENT_RESCHEDULE_REJECT_CAMPAIGN || "patient_reschedule_reject",
        templateName: process.env.AISENSY_PATIENT_RESCHEDULE_REJECT_TEMPLATE || "patient_reschedule_reject",
        params: rejectParams
      };
      const r2 = await sendWaSafe(payload);
      if (!r2.ok) {
        console.warn("Patient reject WA failed:", r2.error);
        waErrors.push({ to: patientPhone, error: r2.error, payload });
      } else {
        console.log("Patient reject WA sent to", patientPhone);
      }
    } else {
      console.warn("No patient phone to send reject WA");
    }

    return res.json({ success: true, message: "Reschedule rejected and patient notified (best-effort).", addSession: doc, waErrors });
  } catch (err) {
    console.error("reject_reschedule err:", err);
    return res.status(500).json({ success:false, message: "Server error", error: String(err) });
  }
});

// GET /api/add_sessions/reschedule_requests?doctorId=...
router.get("/reschedule_requests", async (req, res) => {
  try {
    const { doctorId } = req.query;
    const q = { "sessions.reschedule.status": "requested" };
    if (doctorId && /^[0-9a-fA-F]{24}$/.test(doctorId)) q.doctorAssigned = new mongoose.Types.ObjectId(doctorId);

    const docs = await AddSession.find(q).lean();
    const out = [];
    for (const d of docs) {
      for (const s of (d.sessions || [])) {
        if (s.reschedule && s.reschedule.status === "requested") {
          const appt = await Appointment.findById(d.appointmentId).lean();
          out.push({ addSessionId: d._id, session: s, appointment: appt });
        }
      }
    }
    return res.json({ success: true, count: out.length, requests: out });
  } catch (err) {
    console.error("reschedule_requests err:", err);
    return res.status(500).json({ success:false, message: "Server error", error: String(err) });
  }
});

module.exports = router;
