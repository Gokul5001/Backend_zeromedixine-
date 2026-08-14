// routes/consentRoutes.js (top)
const express = require("express");
const router = express.Router();
const multer = require("multer");
const Appointment = require("../Models/Appointment");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const AddSession = require("../Models/AddSession"); // <-- ensure this path matches your project
const mongoose = require("mongoose");
// const { sendConsentFormMessage } = require("../utils/aisensy"); // existing util you already use elsewhere
const { sendConsentFormMessage } = require("../utils/superfone");
const OplivaAppointment = require("../Models/OplivaAppointment");
const PhysioAppointment = require("../Models/PhysioAppointment");

// simple memory storage for small files - good for immediate upload to Drive
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max - increase if needed
});

// ---------------------------------------------
// PHONE NORMALIZER (Strong version)
// ---------------------------------------------
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");

  // If number starts with +91 or 91 multiple times (ex: 9191xxxxx)
  while (digits.startsWith("91") && digits.length > 12) {
    digits = digits.substring(2);
  }

  // 10-digit Indian mobile → convert to 91XXXXXXXXXX
  if (digits.length === 10) return "91" + digits;

  // Already 12-digit correct format
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return null; // Any other case = invalid number
}


router.post("/send/:appointmentId", async (req, res) => {
  try {
    const apptId = req.params.appointmentId;
    const { doctorName } = req.body; // Get doctor name from request body
    
    const appt = await Appointment.findById(apptId).lean();

    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    const phone = normalizePhone(appt.phone);
    if (!phone)
      return res.status(400).json({ success: false, message: "Invalid patient phone number" });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const consentLink = `${frontendUrl}/consent/${appt._id}`;

    console.log("📩 Sending consent link to:", phone);
    console.log("👨‍⚕️ Assigned Doctor:", doctorName);

    await sendConsentFormMessage({
      to: phone,
      patientName: appt.name || "Patient",
      formLink: consentLink,
      doctorName: doctorName || appt.doctorAssignedUsername || "Doctor", // Use the provided doctor name
    });

    return res.json({ success: true, message: "Consent link sent to patient" });
  } catch (err) {
    console.error("Consent link error:", err);
    return res.status(500).json({ success: false, message: "Failed to send consent link", error: err });
  }
});

router.post("/send/opliva/:appointmentId", async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { doctorName } = req.body;

    const appt = await OplivaAppointment.findById(appointmentId).lean();

    if (!appt) {
      return res.status(404).json({
        success: false,
        message: "Opliva appointment not found"
      });
    }

    const phone = normalizePhone(appt.phone || appt.contact);

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number"
      });
    }

    const frontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5173";

    const consentLink = `${frontendUrl}/consent/${appt._id}`;

    await sendConsentFormMessage({
      to: phone,
      patientName: appt.name,
      formLink: consentLink,
      doctorName: doctorName || "Opliva Doctor"
    });

    await OplivaAppointment.findByIdAndUpdate(appointmentId, {
      consentSent: true,
      consentSentAt: new Date()
    });

    return res.json({
      success: true,
      message: "Opliva consent sent"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


  
// helper: safely convert a value to ObjectId or return null
function toObjectIdOrNull(v) {
    if (!v) return null;
    // if already an ObjectId instance
    if (v instanceof mongoose.Types.ObjectId) return v;
    try {
      // create new ObjectId using constructor
      return new mongoose.Types.ObjectId(String(v));
    } catch (e) {
      return null;
    }
  }
  
  router.post("/", upload.single("file"), async (req, res) => {
    try {
      const { appointmentId, patientId, name, age, concern, date, contact, assessmentLink } = req.body || {};
      const file = req.file;
  
      const idCandidate = appointmentId || patientId || null;
      if (!idCandidate) return res.status(400).json({ success: false, message: "Missing appointmentId/patientId" });
  
      const objectId = toObjectIdOrNull(idCandidate);
      if (!objectId) return res.status(400).json({ success: false, message: "Invalid appointmentId/patientId" });
  
      if (!file) return res.status(400).json({ success: false, message: "Missing file upload" });
  
      // upload to Drive
      const filename = file.originalname || `consent_${String(objectId)}_${Date.now()}.pdf`;
      const result = await uploadToDriveOAuth(file.buffer, filename, file.mimetype || "application/pdf", process.env.GOOGLE_DRIVE_FOLDER_ID);
  
      // prefer webViewLink if available
      const driveUrl = (result && (result.webViewLink || (result.id ? `https://drive.google.com/file/d/${result.id}/view` : null))) || null;
  
      // Build consent object
      const consentObj = {
        url: driveUrl,
        driveId: result && result.id ? result.id : null,
        filename,
        name: name || null,
        age: age || null,
        concern: concern || null,
        assessmentLink: assessmentLink || null,
        submittedAt: new Date()
      };
  
      // Update Appointment.consentForm (best-effort)
      try {
        const apptUpdate = await Appointment.updateOne(
          { _id: objectId },
          { $set: { consentForm: consentObj } }
        );
        console.log("Appointment updateOne result:", apptUpdate);
      } catch (apptErr) {
        console.warn("Warning: failed to update Appointment.consentForm:", apptErr && (apptErr.message || apptErr));
      }
  
      // Update AddSession documents that reference this appointmentId
      try {
        const addSessionResult = await AddSession.updateMany(
          { appointmentId: objectId },
          { $set: { consentForm: consentObj } }
        );
        console.log("AddSession updateMany result:", addSessionResult);
      } catch (addSessErr) {
        console.warn("Warning: failed to update AddSession.consentForm:", addSessErr && (addSessErr.message || addSessErr));
      }
  
      return res.json({ success: true, driveUrl, id: result && result.id ? result.id : null });
    } catch (err) {
      console.error("Consent upload error (multipart):", err && (err.message || err));
      return res.status(500).json({ success: false, message: "Upload error", error: err && (err.message || err) });
    }
  });

  // POST /api/consent/inline
// Called from ClinicBooking step 4 — generates PDF + uploads to Drive
// Does NOT require appointmentId (called before payment)
router.post("/inline", upload.none(), async (req, res) => {
  console.log("📝 /api/consent/inline hit:", { name: req.body?.name, hasSig: !!req.body?.sigDataUrl });

  try {
    const { name, age, concern, contact, date, sigDataUrl } = req.body || {};

    if (!name) {
      console.warn("⚠️ /consent/inline rejected — missing name");
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const PDFDocument = require("pdfkit");
    const chunks = [];

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.on("data", chunk => chunks.push(chunk));

    const ASSESSMENT_URL = "https://docs.google.com/document/d/13eyBB4ZJ8cGcwv-0sv_JBwEb6d9BKbI6htzVW1RWFBI/edit?usp=sharing";

    await new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);

      // ── Header ──────────────────────────────────────────────────────────────
      doc.fontSize(20).font("Helvetica-Bold").text("Zeromedixine", 48, 48);
      doc.fontSize(10).font("Helvetica").fillColor("#555555").text("Comprehensive Pain & Rehab Care", 48, 72);
      doc.fillColor("#000000");

      // ── Title ───────────────────────────────────────────────────────────────
      doc.fontSize(15).font("Helvetica-Bold")
        .text("Consent for Assessment & Treatment", 48, 100, { align: "center", width: 499 });

      // ── Details box ─────────────────────────────────────────────────────────
      const boxY = 128;
      doc.rect(48, boxY, 499, 120).stroke("#cccccc");

      // Row 1: Name | Age
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text("Name:", 60, boxY + 12);
      doc.font("Helvetica").text(name || "-", 105, boxY + 12);
      doc.font("Helvetica-Bold").text("Age:", 360, boxY + 12);
      doc.font("Helvetica").text(String(age || "-"), 385, boxY + 12);

      // Row 2: Concern
      doc.font("Helvetica-Bold").text("Concern:", 60, boxY + 32);
      doc.font("Helvetica").text(concern || "-", 60, boxY + 48, { width: 480 });

      // Row 3: Date | Contact
      doc.font("Helvetica-Bold").text("Date:", 60, boxY + 72);
      doc.font("Helvetica").text(date || "-", 95, boxY + 72);
      doc.font("Helvetica-Bold").text("Contact no:", 260, boxY + 72);
      doc.font("Helvetica").text(contact || "-", 330, boxY + 72);

      // Row 4: Assessment Document link
      doc.font("Helvetica-Bold").text("Assessment Document:", 60, boxY + 92);
      doc.fillColor("#1155CC")
        .font("Helvetica")
        .text("Click here to read the assessment document", 60, boxY + 108, {
          link: ASSESSMENT_URL,
          underline: true,
          width: 480,
        });
      doc.fillColor("#000000");

      // ── Consent body ─────────────────────────────────────────────────────────
      let y = boxY + 140;

      doc.fontSize(10).font("Helvetica")
        .text(
          "I give my consent for assessment and treatment by Zeromedixine clinicians. I understand the nature of the assessment and agree to proceed.",
          48, y, { width: 499 }
        );
      y += 36;

      doc.font("Helvetica-Bold").text("By signing below, I acknowledge that:", 48, y);
      y += 16;

      const ackLines = [
        "I have read and understood this consent form",
        "The treatment plan and risks were explained to me",
        "I agree to proceed with rehabilitation at Zeromedixine",
      ];
      doc.font("Helvetica");
      ackLines.forEach(line => {
        doc.text(line, 48, y, { width: 499 });
        y += 14;
      });

      // ── Signature (bottom-right, fixed position) ──────────────────────────
      const sigX     = 390;
      const sigY     = 680;
      const sigW     = 155;
      const sigH     = 70;
      const nameY    = sigY + sigH + 4;
      const stampY   = 750;

      // Signature image
      const sigPromise = sigDataUrl
        ? new Promise((sigRes) => {
            const base64 = sigDataUrl.replace(/^data:image\/\w+;base64,/, "");
            const imgBuf = Buffer.from(base64, "base64");
            try {
              doc.image(imgBuf, sigX, sigY, { width: sigW, height: sigH });
            } catch (imgErr) {
              doc.fontSize(9).font("Helvetica").fillColor("#999")
                .text("(Signature not captured)", sigX, sigY + 28);
              doc.fillColor("#000");
            }
            sigRes();
          })
        : Promise.resolve();

      sigPromise.then(() => {
        // Signer name below signature
        doc.fontSize(9).font("Helvetica").fillColor("#000")
          .text(name || "", sigX, nameY, { width: sigW, align: "center" });

        // Electronic timestamp (bottom-left)
        doc.fontSize(8).fillColor("#555555")
          .text(
            `Signed electronically on ${new Date().toLocaleString()}`,
            48, stampY
          );

        doc.end();
      });
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename  = `consent_inline_${Date.now()}.pdf`;

    const result   = await uploadToDriveOAuth(
      pdfBuffer, filename, "application/pdf",
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );
    const driveUrl = result?.webViewLink
      || (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);

    console.log("✅ Consent PDF uploaded to Drive:", driveUrl);
    return res.json({ success: true, driveUrl, id: result?.id });

  } catch (err) {
    console.error("POST /consent/inline error:", err);
    return res.status(500).json({
      success: false,
      message: "Consent PDF generation failed",
      error: String(err?.message || err),
    });
  }
});

  // GET /api/consent/appointment/:physioAppointmentId
// Prefill data for the consent page
router.get("/appointment/:physioAppointmentId", async (req, res) => {
  try {
    const appt = await PhysioAppointment.findById(req.params.physioAppointmentId)
      .select("patient_name patient_age patient_phone concern date time doctor_id consent_form")
      .lean();
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });
    return res.json({ success: true, appointment: appt });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});

// POST /api/consent/appointment/:physioAppointmentId
// Generates the signed consent PDF and saves it onto the PhysioAppointment
router.post("/appointment/:physioAppointmentId", upload.none(), async (req, res) => {
  try {
    const { physioAppointmentId } = req.params;
    const { sigDataUrl } = req.body || {};

    const appt = await PhysioAppointment.findById(physioAppointmentId);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    const name    = appt.patient_name;
    const age     = appt.patient_age;
    const concern = appt.concern;
    const contact = appt.patient_phone;
    const date    = appt.date;

    const PDFDocument = require("pdfkit");
    const chunks = [];
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.on("data", chunk => chunks.push(chunk));

    const ASSESSMENT_URL = "https://docs.google.com/document/d/13eyBB4ZJ8cGcwv-0sv_JBwEb6d9BKbI6htzVW1RWFBI/edit?usp=sharing";

    await new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);

      doc.fontSize(20).font("Helvetica-Bold").text("Zeromedixine", 48, 48);
      doc.fontSize(10).font("Helvetica").fillColor("#555555").text("Comprehensive Pain & Rehab Care", 48, 72);
      doc.fillColor("#000000");

      doc.fontSize(15).font("Helvetica-Bold")
        .text("Consent for Assessment & Treatment", 48, 100, { align: "center", width: 499 });

      const boxY = 128;
      doc.rect(48, boxY, 499, 120).stroke("#cccccc");

      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text("Name:", 60, boxY + 12);
      doc.font("Helvetica").text(name || "-", 105, boxY + 12);
      doc.font("Helvetica-Bold").text("Age:", 360, boxY + 12);
      doc.font("Helvetica").text(String(age || "-"), 385, boxY + 12);

      doc.font("Helvetica-Bold").text("Concern:", 60, boxY + 32);
      doc.font("Helvetica").text(concern || "-", 60, boxY + 48, { width: 480 });

      doc.font("Helvetica-Bold").text("Date:", 60, boxY + 72);
      doc.font("Helvetica").text(date || "-", 95, boxY + 72);
      doc.font("Helvetica-Bold").text("Contact no:", 260, boxY + 72);
      doc.font("Helvetica").text(contact || "-", 330, boxY + 72);

      doc.font("Helvetica-Bold").text("Assessment Document:", 60, boxY + 92);
      doc.fillColor("#1155CC").font("Helvetica")
        .text("Click here to read the assessment document", 60, boxY + 108, {
          link: ASSESSMENT_URL, underline: true, width: 480,
        });
      doc.fillColor("#000000");

      let y = boxY + 140;
      doc.fontSize(10).font("Helvetica")
        .text(
          "I give my consent for assessment and treatment by Zeromedixine clinicians. I understand the nature of the assessment and agree to proceed.",
          48, y, { width: 499 }
        );
      y += 36;

      doc.font("Helvetica-Bold").text("By signing below, I acknowledge that:", 48, y);
      y += 16;

      const ackLines = [
        "I have read and understood this consent form",
        "The treatment plan and risks were explained to me",
        "I agree to proceed with rehabilitation at Zeromedixine",
      ];
      doc.font("Helvetica");
      ackLines.forEach(line => { doc.text(line, 48, y, { width: 499 }); y += 14; });

      const sigX = 390, sigY = 680, sigW = 155, sigH = 70;
      const nameY = sigY + sigH + 4, stampY = 750;

      const sigPromise = sigDataUrl
        ? new Promise((sigRes) => {
            const base64 = sigDataUrl.replace(/^data:image\/\w+;base64,/, "");
            const imgBuf = Buffer.from(base64, "base64");
            try {
              doc.image(imgBuf, sigX, sigY, { width: sigW, height: sigH });
            } catch {
              doc.fontSize(9).font("Helvetica").fillColor("#999").text("(Signature not captured)", sigX, sigY + 28);
              doc.fillColor("#000");
            }
            sigRes();
          })
        : Promise.resolve();

      sigPromise.then(() => {
        doc.fontSize(9).font("Helvetica").fillColor("#000")
          .text(name || "", sigX, nameY, { width: sigW, align: "center" });
        doc.fontSize(8).fillColor("#555555")
          .text(`Signed electronically on ${new Date().toLocaleString()}`, 48, stampY);
        doc.end();
      });
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename  = `consent_${physioAppointmentId}_${Date.now()}.pdf`;
    const result    = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", process.env.GOOGLE_DRIVE_FOLDER_ID);
    const driveUrl  = result?.webViewLink || (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);

    appt.consent_form = { url: driveUrl, driveId: result?.id || null, submittedAt: new Date() };
    await appt.save();

    return res.json({ success: true, driveUrl });
  } catch (err) {
    console.error("POST /consent/appointment error:", err);
    return res.status(500).json({
      success: false,
      message: "Consent PDF generation failed",
      error: String(err?.message || err),
    });
  }
});

  module.exports = router;