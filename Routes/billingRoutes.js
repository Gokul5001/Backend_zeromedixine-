// routes/billingRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { v4: uuidv4 } = require("uuid");

const Appointment = require("../Models/Appointment");
const Payment = require("../Models/Payment");
const Concern = require("../Models/Concern");
const { requireAuth } = require("../Middleware/authMiddleware");
const { generateInvoicePdfBuffer } = require("../utils/invoiceGenerator");
const { uploadBufferToS3 } = require("../utils/s3Upload");

function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

// NOTE: assumes amount should be stored in the same "smallest unit" your
// Payment.amount already uses elsewhere (paise for INR, going by your
// payments collection). Verify against your Razorpay flow and adjust if
// your sessions/payments actually store rupees directly.
function toSmallestUnit(amount) {
  const n = Number(amount);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

router.post("/create", requireAuth, async (req, res) => {
  try {
    const {
      mode, // "existing" | "new"
      appointmentId, // required for existing
      patient, // { name, age, gender, phone, email, primaryConcern } required for new
      doctorId,
      doctorUsername,
      amount,
      currency,
      purpose,
      notes,
    } = req.body || {};

    if (!mode || !["existing", "new"].includes(mode)) {
      return res.status(400).json({ success: false, message: "mode must be 'existing' or 'new'" });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required" });
    }
    if (!doctorId && !doctorUsername) {
      return res.status(400).json({ success: false, message: "doctorId or doctorUsername is required" });
    }

    let appointment = null;
    let concernName = null;

    if (mode === "existing") {
      if (!appointmentId) {
        return res.status(400).json({ success: false, message: "appointmentId is required for existing patient billing" });
      }
      appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ success: false, message: "Selected patient/appointment not found" });
      }
    } else {
      if (!patient || !patient.name || !patient.phone) {
        return res.status(400).json({ success: false, message: "New patient requires at least name and phone" });
      }

      // Appointment.primaryConcern is a Mongoose ObjectId ref to the Concern
      // collection (see Models/Appointment), so the frontend now sends the
      // selected concern's _id from a dropdown (GET /api/concerns) instead
      // of free text — free text used to fail Mongoose's ObjectId cast
      // (e.g. "Back pain" -> CastError). Validate it actually exists.
      let concernId = null;
      if (patient.primaryConcern) {
        if (!mongoose.Types.ObjectId.isValid(patient.primaryConcern)) {
          return res.status(400).json({ success: false, message: "Invalid primary concern selected" });
        }
        const concernDoc = await Concern.findById(patient.primaryConcern).lean();
        if (!concernDoc) {
          return res.status(400).json({ success: false, message: "Selected primary concern was not found" });
        }
        concernId = concernDoc._id;
        concernName = concernDoc.concern;
      }

      const now = moment().tz("Asia/Kolkata");

      appointment = new Appointment({
        name: patient.name,
        age: patient.age || null,
        gender: patient.gender || "other",
        phone: normalizePhone(patient.phone),
        email: patient.email || "",
        primaryConcern: concernId,
        appointment_date: now.format("YYYY-MM-DD"),
        appointment_time: now.format("HH:mm"),
        cdate: now.format("YYYY-MM-DD"),
        ctime: now.format("HH:mm:ss"),
        status: "completed",
        doctorAssigned: doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId)) ? doctorId : null,
        doctorAssignedUsername: doctorUsername || null,
        confirmedAt: now.toDate(),
      });

      await appointment.save();
    }

    const resolvedDoctorId =
      appointment.doctorAssigned ||
      (doctorId && /^[0-9a-fA-F]{24}$/.test(String(doctorId)) ? doctorId : null);

    const smallestUnitAmount = toSmallestUnit(amount);
    const invoiceNumber = `INV-${moment().format("YYYYMMDD")}-${uuidv4().slice(0, 6).toUpperCase()}`;

    const payment = new Payment({
      appointmentId: appointment._id,
      amount: smallestUnitAmount,
      currency: currency || "INR",
      purpose: purpose || "Manual billing",
      status: "paid",
      doctorAssigned: resolvedDoctorId,
      customer: {
        name: appointment.name,
        email: appointment.email || null,
        contact: appointment.phone || null,
      },
      raw: {
        method: "manual",
        createdBy: doctorUsername || (req.user && req.user.username) || "unknown",
        notes: notes || "",
        invoiceNumber,
      },
    });

    await payment.save();

    // Best-effort invoice generation — billing still succeeds even if this fails
    try {
      const pdfBuffer = await generateInvoicePdfBuffer({
        invoiceNumber,
        patientName: appointment.name,
        patientPhone: appointment.phone,
        patientEmail: appointment.email,
        doctorName: doctorUsername || appointment.doctorAssignedUsername || "Doctor",
        purpose: payment.purpose,
        amount: Number(amount),
        currency: payment.currency,
        notes: notes || "",
        date: moment().tz("Asia/Kolkata").format("DD MMM YYYY, h:mm A"),
      });

      const s3Key = `invoices/${invoiceNumber}.pdf`;
      const uploadResult = await uploadBufferToS3(pdfBuffer, s3Key, "application/pdf");

      payment.invoice = {
        invoiceUrl: uploadResult.url,
        invoiceDriveId: uploadResult.key,
        invoiceFilename: `${invoiceNumber}.pdf`,
        invoiceCreatedAt: new Date(),
      };
      await payment.save();
    } catch (invoiceErr) {
      console.error("Invoice generation/upload failed (non-fatal):", invoiceErr?.message || invoiceErr);
    }

    return res.status(201).json({
      success: true,
      message: "Bill created successfully",
      appointment,
      // Resolved concern label (only set for the "new" patient path) so the
      // frontend can show it immediately without re-fetching/populating.
      appointmentPrimaryConcernName: concernName,
      payment,
    });
  } catch (err) {
    console.error("Error creating manual bill:", err);
    return res.status(500).json({ success: false, message: "Server error creating bill" });
  }
});

module.exports = router;