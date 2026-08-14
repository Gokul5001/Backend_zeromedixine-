// routes/addclinicpatient.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Clinic = require("../Models/Clinic");
const ClinicPatient = require("../models/addpatient");
const { authenticateToken, requireRole } = require("../middleware/auth");
const ZeromedixineClinic = require("../Models/ZeromedixineClinic");
const Appointment = require("../Models/Appointment"); // adjust path if different
// const { sendTemplateMessage } = require("../utils/aisensy");
const { sendTemplateMessage } = require("../utils/superfone");

// POST /api/clinics/patients
// POST /api/clinics/patients
router.post("/", authenticateToken, requireRole("clinic"), async (req, res) => {
  try {
    const clinicId = req.user?.id;
    if (!clinicId || !mongoose.Types.ObjectId.isValid(clinicId)) {
      return res.status(401).json({ success: false, message: "Invalid clinic authentication" });
    }

    const clinic = await Clinic.findById(clinicId).lean();
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

    const body = req.body || {};
    const name = (body.name || "").trim();
    const mobile = (body.mobile || "").trim();
    const age = (body.age === undefined || body.age === null || body.age === "") ? null : Number(body.age);
    const email = body.email ? String(body.email).trim() : null;
    const gender = (body.gender || "").trim() || null;
    const address = (body.address || "").trim() || null;
    const notes = (body.notes || "").trim() || null;

    // treatment fields
    const treatment = (body.treatment || "").trim() || null;
    const treatmentDate = body.treatmentDate ? new Date(body.treatmentDate) : null;
    const treatmentTime = (body.treatmentTime || "").trim() || null;

    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: "Patient name and mobile are required" });
    }
    // optional: basic age/email checks
    if (age !== null && (!Number.isFinite(age) || age < 0 || age > 150)) {
      return res.status(400).json({ success: false, message: "Invalid age value" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    const doc = new ClinicPatient({
      clinic: clinic._id,
      clinic_name: clinic.clinicName || clinic.name || "",
      name,
      mobile,
      age,
      email,
      gender,
      address,
      notes,
      treatment,
      treatmentDate,
      treatmentTime
    });

    await doc.save();

    return res.json({ success: true, message: "Patient added", patientId: doc._id, patient: doc.toObject() });
  } catch (err) {
    console.error("Add clinic patient error:", err);
    return res.status(500).json({ success: false, message: "Server error adding patient" });
  }
});




// routes/addclinicpatient.js  (replace the existing /public/:clinicId handler with this)
// routes/addclinicpatient.js  (replacement for the existing /public/:clinicId handler)
router.get("/public/:clinicId", async (req, res) => {
  try {
    const clinicId = (req.params.clinicId || "").trim();
    if (!clinicId || !mongoose.Types.ObjectId.isValid(clinicId)) {
      return res.status(400).json({ success: false, message: "Invalid clinic id" });
    }

    // verify clinic exists
    const clinicExists = await Clinic.findById(clinicId).lean().catch(() => null);
    if (!clinicExists) {
      return res.status(404).json({ success: false, message: "Clinic not found" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();
    const treatmentDateRaw = (req.query.treatmentDate || "").trim();

    const filter = { clinic: clinicId };

    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(esc, "i");
      filter.$or = [{ name: regex }, { mobile: regex }, { treatment: regex }];
    }

    if (treatmentDateRaw) {
      const day = new Date(treatmentDateRaw);
      if (!isNaN(day.getTime())) {
        const start = new Date(day);
        start.setHours(0, 0, 0, 0);
        const end = new Date(day);
        end.setHours(23, 59, 59, 999);
        filter.treatmentDate = { $gte: start, $lte: end };
      }
    }

    // include invoice fields so UI can show invoice link after refresh
    const projection = {
      name: 1,
      mobile: 1,
      age: 1,
      email: 1,
      treatment: 1,
      treatmentDate: 1,
      treatmentTime: 1,
      createdAt: 1,
      transferredTo: 1,
      "invoice.url": 1,
      "invoice.driveId": 1,
      "invoice.filename": 1,
      "invoice.amount": 1,
      "invoice.currency": 1,
      "invoice.generatedAt": 1,
      "invoice.generatedByName": 1
    };

    // fetch docs and populate transferredTo to get clinicName
    const [rawDocs, total] = await Promise.all([
      ClinicPatient.find(filter)
        .select(projection)
        .sort({ treatmentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "transferredTo", select: "clinicName" }) // <-- populate clinicName
        .lean(),
      ClinicPatient.countDocuments(filter),
    ]);

    // normalize: add transferredToName string for frontend convenience
    const docs = (rawDocs || []).map((d) => {
      let name = null;
      if (d.transferredTo) {
        // if populate worked, transferredTo is an object with clinicName
        if (typeof d.transferredTo === "object" && d.transferredTo.clinicName) {
          name = d.transferredTo.clinicName;
        } else {
          // if it's just an ID or something else, convert to string (fallback)
          name = String(d.transferredTo);
        }
      }
      return { ...d, transferredToName: name };
    });

    return res.json({ success: true, data: docs, total, page, limit });
  } catch (err) {
    console.error("Public clinic patients list error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



// GET /api/zeromedixine/clinics
router.get("/clinics", async (req, res) => {
  try {
    const docs = await ZeromedixineClinic.find({}).select({ clinicName: 1 }).lean();
    return res.json({ success: true, data: docs });
  } catch (err) {
    console.error("Fetch zeromedixine clinics error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// router.post("/:patientId/transfer", authenticateToken, requireRole("clinic"), async (req, res) => {
//   try {
//     const clinicUserId = req.user?.id; // authenticated clinic id (owner)
//     if (!clinicUserId || !mongoose.Types.ObjectId.isValid(clinicUserId)) {
//       return res.status(401).json({ success: false, message: "Invalid clinic authentication" });
//     }

//     const patientId = req.params.patientId;
//     if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
//       return res.status(400).json({ success: false, message: "Invalid patient id" });
//     }

//     const { toClinic, treatment, notes } = req.body;
//     if (!toClinic || !mongoose.Types.ObjectId.isValid(toClinic)) {
//       return res.status(400).json({ success: false, message: "Invalid target clinic id" });
//     }
//     if (!treatment || !String(treatment).trim()) {
//       return res.status(400).json({ success: false, message: "Treatment is required" });
//     }

//     // find patient
//     const patient = await ClinicPatient.findById(patientId);
//     if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

//     // verify patient belongs to this clinic (security)
//     if (String(patient.clinic) !== String(clinicUserId)) {
//       return res.status(403).json({ success: false, message: "Not authorized to transfer this patient" });
//     }

//     // verify target Zeromedixine clinic exists
//     const targetClinic = await ZeromedixineClinic.findById(toClinic).lean();
//     if (!targetClinic) {
//       return res.status(404).json({ success: false, message: "Destination clinic not found" });
//     }

//     // update patient: set transferredTo and optionally store lastTransfer info
//     patient.transferredTo = targetClinic._id;
//     // optionally record transfer meta
//     patient.notes = (patient.notes ? patient.notes + "\n\n" : "") + `Transferred to ${targetClinic.clinicName} on ${new Date().toISOString()}. Notes: ${notes || "-"}`;
//     // you may also set a flag
//     patient.transferredAt = new Date();
//     patient.treatment = treatment;
//     await patient.save();

//     // create an Appointment in Appointments collection, with transferredFrom = original clinic id
//     // Basic appointment mapping — adapt fields as needed
//     const appt = new Appointment({
//       name: patient.name,
//       age: null, // unknown from patient doc; set if available
//       gender: patient.gender || "other",
//       phone: patient.mobile,
//       email: "", // if you have email in patient doc, add
//       primaryConcern: null,
//       appointment_date: patient.treatmentDate ? patient.treatmentDate.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
//       appointment_time: patient.treatmentTime || "",
//       cdate: new Date().toISOString().split("T")[0],
//       ctime: new Date().toISOString().split("T")[1] || "",
//       language: null,
//       couponCode: null,
//       whatsAppOptIn: false,
//       status: "transferred",
//       doctorAssigned: null,
//       confirmedAt: null,
//       twilioRoom: {},
//       twilioRoomPatient: {},
//       twilioRoomDoctor: {},
//       chiefComplaint: patient.notes || null,
//       enquiryNotes: notes || null,
//       // custom transfer fields:
//       transferredFrom: patient.clinic, // original clinic id
//       transferredTo: targetClinic._id,
//       sourcePatientId: patient._id, // link back to clinicpatients doc
//     });

//     await appt.save();

//     return res.json({ success: true, message: "Patient transferred", transfer: { toClinic: targetClinic._id, clinicName: targetClinic.clinicName }, appointmentId: appt._id });
//   } catch (err) {
//     console.error("Transfer error:", err);
//     return res.status(500).json({ success: false, message: "Server error during transfer" });
//   }
// });


// routes/addclinicpatient.js  — updated transfer endpoint
// router.post("/:patientId/transfer", authenticateToken, requireRole("clinic"), async (req, res) => {
//   try {
//     const clinicUserId = req.user?.id;
//     if (!clinicUserId || !mongoose.Types.ObjectId.isValid(clinicUserId)) {
//       return res.status(401).json({ success: false, message: "Invalid clinic authentication" });
//     }

//     const patientId = req.params.patientId;
//     if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
//       return res.status(400).json({ success: false, message: "Invalid patient id" });
//     }

//     const { toClinic, concernId, notes } = req.body;
//     if (!toClinic || !mongoose.Types.ObjectId.isValid(toClinic)) {
//       return res.status(400).json({ success: false, message: "Invalid target clinic id" });
//     }
//     if (!concernId || !mongoose.Types.ObjectId.isValid(concernId)) {
//       return res.status(400).json({ success: false, message: "Valid concern is required" });
//     }

//     // find patient
//     const patient = await ClinicPatient.findById(patientId);
//     if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

//     // verify patient belongs to this clinic
//     if (String(patient.clinic) !== String(clinicUserId)) {
//       return res.status(403).json({ success: false, message: "Not authorized to transfer this patient" });
//     }

//     // verify target Zeromedixine clinic exists
//     const targetClinic = await ZeromedixineClinic.findById(toClinic).lean();
//     if (!targetClinic) {
//       return res.status(404).json({ success: false, message: "Destination clinic not found" });
//     }

//     // update patient: set transferredTo and record transfer
//     patient.transferredTo = targetClinic._id;
//     patient.transferredAt = new Date();
//    patient.primaryConcern = concernId;

    
//     // Append transfer note to existing notes
//     patient.notes = (patient.notes ? patient.notes + "\n\n" : "") + 
//       `Transferred to ${targetClinic.clinicName} on ${new Date().toLocaleString()}. Transfer notes: ${notes || "-"}`;
    
//     await patient.save();

//     // Create Appointment with transfer fields
//     const appt = new Appointment({
//       name: patient.name,
//       age: patient.age || null,
//       gender: patient.gender || "other",
//       phone: patient.mobile,
//       email: patient.email || "",
//       primaryConcern: concernId,

//       appointment_date: patient.treatmentDate ? 
//         patient.treatmentDate.toISOString().split("T")[0] : 
//         new Date().toISOString().split("T")[0],
//       appointment_time: patient.treatmentTime || "",
//       cdate: new Date().toISOString().split("T")[0],
//       ctime: new Date().toISOString().split("T")[1].split(".")[0] || "",
//       language: null,
//       couponCode: null,
//       whatsAppOptIn: false,
//       status: "transferred",
//       doctorAssigned: null,
//       confirmedAt: null,
//       twilioRoom: {},
//       twilioRoomPatient: {},
//       twilioRoomDoctor: {},
//       chiefComplaint: patient.notes ? patient.notes.replace(/Transferred to.*/s, "").trim() : null, // Remove transfer notes
//       enquiryNotes: notes || null,
//       // Add transfer-specific fields
//       transferredFrom: patient.clinic,
//       transferredTo: targetClinic._id,
//       sourcePatientId: patient._id,
//       transferNotes: notes || null, // Add transfer notes as separate field
//       transferredAt: new Date()
//     });

//     await appt.save();

//     return res.json({ 
//       success: true, 
//       message: "Patient transferred", 
//       transfer: { 
//         toClinic: targetClinic._id, 
//         clinicName: targetClinic.clinicName 
//       }, 
//       appointmentId: appt._id 
//     });
//   } catch (err) {
//     console.error("Transfer error:", err);
//     return res.status(500).json({ success: false, message: "Server error during transfer" });
//   }
// });

router.post("/:patientId/transfer", authenticateToken, requireRole("clinic"), async (req, res) => {
  try {
    const clinicUserId = req.user?.id;
    if (!clinicUserId || !mongoose.Types.ObjectId.isValid(clinicUserId)) {
      return res.status(401).json({ success: false, message: "Invalid clinic authentication" });
    }

    const patientId = req.params.patientId;
    if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ success: false, message: "Invalid patient id" });
    }

    const { toClinic, concernId, notes } = req.body;
    if (!toClinic || !mongoose.Types.ObjectId.isValid(toClinic)) {
      return res.status(400).json({ success: false, message: "Invalid target clinic id" });
    }
    if (!concernId || !mongoose.Types.ObjectId.isValid(concernId)) {
      return res.status(400).json({ success: false, message: "Valid concern is required" });
    }

    // find patient
    const patient = await ClinicPatient.findById(patientId);
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    // verify patient belongs to this clinic
    if (String(patient.clinic) !== String(clinicUserId)) {
      return res.status(403).json({ success: false, message: "Not authorized to transfer this patient" });
    }

    // verify target Zeromedixine clinic exists
    const targetClinic = await ZeromedixineClinic.findById(toClinic).lean();
    if (!targetClinic) {
      return res.status(404).json({ success: false, message: "Destination clinic not found" });
    }

    // update patient: set transferredTo and record transfer
    patient.transferredTo = targetClinic._id;
    patient.transferredAt = new Date();
    patient.primaryConcern = concernId;

    // Append transfer note to existing notes
    patient.notes = (patient.notes ? patient.notes + "\n\n" : "") +
      `Transferred to ${targetClinic.clinicName} on ${new Date().toLocaleString()}. Transfer notes: ${notes || "-"}`;

    await patient.save();

    // Create Appointment with transfer fields
    const appt = new Appointment({
      name: patient.name,
      age: patient.age || null,
      gender: patient.gender || "other",
      phone: patient.mobile,
      email: patient.email || "",
      primaryConcern: concernId,

      appointment_date: patient.treatmentDate ?
        patient.treatmentDate.toISOString().split("T")[0] :
        new Date().toISOString().split("T")[0],
      appointment_time: patient.treatmentTime || "",
      cdate: new Date().toISOString().split("T")[0],
      ctime: new Date().toISOString().split("T")[1].split(".")[0] || "",
      language: null,
      couponCode: null,
      whatsAppOptIn: false,
      status: "transferred",
      doctorAssigned: null,
      confirmedAt: null,
      twilioRoom: {},
      twilioRoomPatient: {},
      twilioRoomDoctor: {},
      chiefComplaint: patient.notes ? patient.notes.replace(/Transferred to.*/s, "").trim() : null, // Remove transfer notes
      enquiryNotes: notes || null,
      // Add transfer-specific fields
      transferredFrom: patient.clinic,
      transferredTo: targetClinic._id,
      sourcePatientId: patient._id,
      transferNotes: notes || null,
      transferredAt: new Date()
    });

    await appt.save();

    // -------------------------------
    // Notify Zeromedixine via AiSensy (WhatsApp) - best-effort (non-blocking)
    // -------------------------------
 // Notify Zeromedixine via AiSensy (WhatsApp) - best-effort (non-blocking)
// try {
//   if (typeof sendTemplateMessage !== "function") {
//     console.warn("sendTemplateMessage not available — skipping transfer WhatsApp notify.");
//   } else {
//     const notifyRaw = process.env.NOTIFY_ZEROMEDIXINE || "";
//     function normalizePhone(p) {
//       if (!p) return "";
//       let s = String(p).replace(/\D/g, "");
//       if (s.length === 10) s = "91" + s;
//       return s;
//     }
//     const destination = normalizePhone(notifyRaw);
//     if (!destination) {
//       console.warn("NOTIFY_ZEROMEDIXINE not configured — skipping WhatsApp notify.");
//     } else {
//       const FRONTEND = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
//       const confirmLink = `${FRONTEND}/transfers/confirm/${appt._id}`;

//       // load source clinic (the clinic initiating this transfer)
//       let sourceClinic = null;
//       try {
//         sourceClinic = await Clinic.findById(clinicUserId).lean();
//       } catch (e) {
//         console.warn("Could not fetch source clinic for transfer notify:", e?.message || e);
//       }

//       // Build template var order from env (fallback to clinicName,link)
//       const varsEnv = (process.env.AISENSY_TRANSFER_TEMPLATE_VARS || "clinicName,link").split(",").map(s => s.trim()).filter(Boolean);

//       // Build a map of available values (clinicName is the SOURCE clinic)
//       const varsMap = {
//         clinicName: String(
//           (sourceClinic && (sourceClinic.clinicName || sourceClinic.clinic_name)) ||
//           (targetClinic && (targetClinic.clinicName || targetClinic.clinic_name)) ||
//           "Clinic"
//         ),
//         link: confirmLink,
//         patientName: String(patient.name || ""),
//         patientPhone: String(patient.mobile || ""),
//         appointmentId: String(appt._id)
//       };

//       const templateParams = varsEnv.map(k => varsMap[k] !== undefined ? varsMap[k] : "");

//       const campaignName = process.env.AISENSY_TRANSFER_CAMPAIGN || process.env.AISENSY_CAMPAIGN_NAME || process.env.AISENSY_CAMPAIGN;
//       if (!campaignName) {
//         console.warn("AISENSY_TRANSFER_CAMPAIGN/AISENSY_CAMPAIGN not set — skipping WhatsApp notify.");
//       } else {
//         const payload = {
//           to: destination,
//           campaignName,
//           templateName: process.env.AISENSY_TRANSFER_TEMPLATE || "transfer_request_to_admin",
//           params: templateParams
//         };

//         sendTemplateMessage(payload)
//           .then((resp) => {
//             console.log("AiSensy transfer notify sent:", { to: destination, apptId: appt._id, resp });
//           })
//           .catch((err) => {
//             console.error("AiSensy transfer notify failed (non-fatal):", err?.debug || err?.message || err);
//             if (err?.debug?.data) console.error("AiSensy debug data:", err.debug.data);
//           });
//       }
//     }
//   }
// } catch (notifyErr) {
//   console.error("Transfer notify error (non-fatal):", notifyErr);
// }

// ------------------------------------------------------
// 📲 Notify Zeromedixine via Superfone (non-blocking)
// ------------------------------------------------------
try {

  const notifyRaw = process.env.NOTIFY_ZEROMEDIXINE || "";

  function normalizePhone(p) {
    if (!p) return "";
    let s = String(p).replace(/\D/g, "");
    if (s.length === 10) s = "91" + s;
    return s;
  }

  const destination = normalizePhone(notifyRaw);

  if (!destination) {
    console.warn("NOTIFY_ZEROMEDIXINE not configured — skipping Superfone notify.");
  } else {

    const FRONTEND =
      (process.env.FRONTEND_URL || "https://www.zeromedixine.com")
        .replace(/\/$/, "");

    const confirmLink =
      `${FRONTEND}/transfers/confirm/${appt._id}`;

    // Load SOURCE clinic (the one transferring)
    let sourceClinic = null;
    try {
      sourceClinic = await Clinic.findById(clinicUserId).lean();
    } catch (e) {
      console.warn("Could not fetch source clinic:", e?.message || e);
    }

    const clinicName =
      sourceClinic?.clinicName ||
      sourceClinic?.clinic_name ||
      "Clinic";

    const params = [
      clinicName,  // {{1}}
      confirmLink  // {{2}}
    ];

    console.log("📤 Superfone TRANSFER notify:", {
      to: destination,
      template: "transfer_request_new_new",
      params
    });

    sendTemplateMessage({
      to: destination,
      templateName: "transfer_request_new_new",
      language: "en_US",
      params
    })
    .then(() => {
      console.log("✅ Superfone transfer notify sent:", destination);
    })
    .catch(err => {
      console.error(
        "❌ Superfone transfer notify failed (non-fatal):",
        err?.response?.data || err?.message || err
      );
    });
  }

} catch (notifyErr) {
  console.error("Transfer notify error (non-fatal):", notifyErr);
}


    // return response
    return res.json({
      success: true,
      message: "Patient transferred",
      transfer: {
        toClinic: targetClinic._id,
        clinicName: targetClinic.clinicName
      },
      appointmentId: appt._id
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return res.status(500).json({ success: false, message: "Server error during transfer" });
  }
});




module.exports = router;
