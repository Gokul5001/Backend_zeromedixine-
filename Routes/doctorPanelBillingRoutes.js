// Routes/doctorPanelBillingRoutes.js
//
// "New Bill" flow for the Doctor Panel dashboard (DoctorPanelDashboard.jsx
// -> NewBillModal), which calls:
//
//   POST /api/doctor-panel/billing/create-bill
//
// Lets a doctor manually bill an EXISTING patient (links a new payment to
// one of their existing physio_appointments — no duplicate appointment is
// created) or a brand-NEW patient (creates a new physio_appointments doc
// first, then a payment linked to it). Both paths generate + upload an
// invoice PDF the same way Routes/doctorPanelInvoiceRoutes.js does for the
// "Send Invoice" button, and save it onto both the appointment and the
// payment record.
//
// Mount in server.js:
//   const doctorPanelBilling = require("./Routes/doctorPanelBillingRoutes");
//   app.use("/api/doctor-panel/billing", doctorPanelBilling);

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const path = require("path");
const axios = require("axios");
const PDFDocument = require("pdfkit");

const Doctor = require("../Models/Doctor");
const PhysioAppointment = require("../Models/PhysioAppointment");
const { requireAuth } = require("../Middleware/authMiddleware");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const { sendTemplateMessage } = require("../utils/superfone");

// IMPORTANT: verify this path matches whatever model already backs your
// `payments` collection (103 existing docs — fields: appointmentId,
// sessionId, referenceId, linkId, amount, currency, purpose, status,
// doctorAssigned, customer{name,email,contact}, invoice{...},
// razorpay_payment_id, razorpay_order_id, raw{createdBy, razorpay_link},
// createdAt, updatedAt). If you don't have Models/Payment.js yet, see the
// companion file Payment.js provided alongside this route.
const Payment = require("../Models/Payment");

const LOGO_URL = "https://zeromedixine.com/assets/zeromedixine-CD7SGup0.png";
const FONT_PATH = path.join(__dirname, "..", "fonts", "Roboto-Regular.ttf");

async function fetchImageBuffer(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 10000 });
  return Buffer.from(response.data, "binary");
}

// Same visual layout as doctorPanelInvoiceRoutes.js's invoice PDF — kept in
// sync intentionally so a manually-created bill's invoice looks identical
// to one generated from an existing appointment.
async function generateInvoicePdfBuffer({ patient, invoiceMeta }) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      doc.registerFont("AppFont", FONT_PATH);
      doc.font("AppFont");

      /* ================= HEADER ================= */
      doc.rect(0, 0, doc.page.width, 95).fill("#eaf6fd");
      try {
        const logoBuffer = await fetchImageBuffer(LOGO_URL);
        doc.image(logoBuffer, 40, 22, { width: 130 });
      } catch (e) {
        console.warn("Logo load failed from URL:", e.message || e);
      }

      doc.fillColor("#1e8fd3").fontSize(22).text("INVOICE", 0, 30, { align: "right" });
      doc
        .fontSize(10)
        .fillColor("#444")
        .text(`Invoice No: ${invoiceMeta.invoiceNumber}`, { align: "right" })
        .text(`Date: ${new Date().toLocaleDateString("en-IN")}`, { align: "right" });

      doc.moveDown(5);

      /* ================= FROM / TO ================= */
      const boxTop = doc.y;
      doc.roundedRect(40, boxTop, 240, 90, 8).stroke("#d9eaf7");
      doc.roundedRect(310, boxTop, 240, 90, 8).stroke("#d9eaf7");

      doc.fillColor("#1e8fd3").fontSize(11).text("FROM", 50, boxTop + 10);
      doc
        .fontSize(9)
        .fillColor("#333")
        .text("Zeromedixine Clinic", 50, boxTop + 30)
        .text("support@zeromedixine.com")
        .text("+91 98765 43210");

      doc.fillColor("#1e8fd3").fontSize(11).text("BILL TO", 320, boxTop + 10);
      doc
        .fontSize(9)
        .fillColor("#333")
        .text(patient.name, 320, boxTop + 30)
        .text(`Phone: ${patient.phone || "-"}`)
        .text(`Email: ${patient.email || "-"}`);

      doc.moveDown(7);

      /* ================= TABLE ================= */
      const startX = 40;
      const tableWidth = 515;
      const formatMoney = (p) =>
        "₹" + (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
      const items = invoiceMeta.items;

      const headerY = doc.y;
      doc.rect(startX, headerY - 4, tableWidth, 24).fill("#f1f9ff");
      doc.fillColor("#1e8fd3").fontSize(10);
      doc.text("S.No", startX, headerY);
      doc.text("Description", startX + 50, headerY);
      doc.text("Qty", startX + 320, headerY, { width: 40, align: "right" });
      doc.text("Rate", startX + 380, headerY, { width: 60, align: "right" });
      doc.text("Amount", startX + 450, headerY, { width: 80, align: "right" });

      let y = headerY + 30;
      let total = 0;
      doc.fontSize(9).fillColor("#333");
      items.forEach((it, i) => {
        const amt = it.qty * it.rate;
        total += amt;
        doc.text(i + 1, startX, y);
        doc.text(it.desc, startX + 50, y, { width: 260 });
        doc.text(it.qty, startX + 320, y, { width: 40, align: "right" });
        doc.text(formatMoney(it.rate), startX + 380, y, { width: 60, align: "right" });
        doc.text(formatMoney(amt), startX + 450, y, { width: 80, align: "right" });
        y += 22;
      });

      /* ================= TOTAL ================= */
      y += 10;
      doc.roundedRect(350, y, 205, 36, 8).fill("#1e8fd3");
      doc.fillColor("#fff").fontSize(14);
      doc.text("TOTAL", 360, y + 10);
      doc.text(formatMoney(total), 420, y + 10, { align: "right", width: 120 });

      /* ================= FOOTER ================= */
      doc
        .fontSize(8)
        .fillColor("#777")
        .text(
          "This is a computer-generated invoice. No signature required.",
          40,
          doc.page.height - 80,
          { align: "center" }
        );
      doc.fillColor("#1e8fd3").text("www.zeromedixine.com", { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// POST /api/doctor-panel/billing/create-bill
router.post("/create-bill", requireAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ loginCredentialId: req.user.id }).lean();
    if (!doctor) {
      return res.status(404).json({ success: false, message: "No doctor profile linked to this login" });
    }

    const {
      patientMode, // "existing" | "new"
      existingAppointmentId,
      patient_name,
      patient_phone,
      patient_email,
      patient_age,
      concern,
      session_type,
      date,
      time,
      amount, // rupees, entered by the doctor
      notes,
    } = req.body || {};

    if (!["existing", "new"].includes(patientMode)) {
      return res.status(400).json({ success: false, message: "patientMode must be 'existing' or 'new'" });
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid amount" });
    }
    const amountPaise = Math.round(amt * 100);
    const currency = "INR";
    const description = (concern && concern.trim()) || "Consultation";

    let appointmentDoc; // the physio_appointments doc this bill attaches to
    let createdNewAppointment = false;

    if (patientMode === "existing") {
      if (!existingAppointmentId || !/^[0-9a-fA-F]{24}$/.test(existingAppointmentId)) {
        return res.status(400).json({ success: false, message: "Select a valid existing patient" });
      }
      // Scoped to this doctor — a doctor can only bill their own patients.
      appointmentDoc = await PhysioAppointment.findOne({
        _id: existingAppointmentId,
        $or: [{ doctor_ref: doctor._id }, { doctor_id: doctor.doctor_id }],
      });
      if (!appointmentDoc) {
        return res.status(404).json({ success: false, message: "Patient/appointment not found for this doctor" });
      }
    } else {
      if (!patient_name || !patient_name.trim() || !patient_phone || !patient_phone.trim()) {
        return res.status(400).json({ success: false, message: "Patient name and phone are required" });
      }
      appointmentDoc = new PhysioAppointment({
        doctor_id: doctor.doctor_id,
        doctor_ref: doctor._id,
        patient_name: patient_name.trim(),
        patient_phone: patient_phone.trim(),
        patient_email: patient_email || null,
        patient_age: patient_age || null,
        concern: description,
        session_type: session_type || "Online",
        date: date || null,
        time: time || null,
        notes: notes || null,
        status: "confirmed",
        amount_paid: amountPaise,
        currency,
        booking_type: "single",
        invoice_description: description,
      });
      await appointmentDoc.save();
      createdNewAppointment = true;
    }

    // ---- Generate + upload invoice PDF ----
    const invoiceNumber = `INV-${Date.now()}`;
    const items = [{ desc: description, qty: 1, rate: amountPaise }];

    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePdfBuffer({
        patient: {
          name: appointmentDoc.patient_name,
          phone: appointmentDoc.patient_phone,
          email: appointmentDoc.patient_email,
        },
        invoiceMeta: { invoiceNumber, items },
      });
    } catch (pdfErr) {
      console.error("Billing PDF generation failed:", pdfErr);
      return res.status(500).json({
        success: false,
        message: "PDF generation failed",
        error: String(pdfErr?.message || pdfErr),
      });
    }

    const safeName = String(appointmentDoc.patient_name || "patient").replace(/\s+/g, "_");
    const filename = `${invoiceNumber}_${safeName}.pdf`;

    let uploadRes;
    try {
      uploadRes = await uploadToDriveOAuth(
        pdfBuffer,
        filename,
        "application/pdf",
        process.env.GOOGLE_DRIVE_FOLDER_INVOICE || process.env.GOOGLE_DRIVE_FOLDER_ID
      );
    } catch (driveErr) {
      console.warn("Billing Drive upload failed:", driveErr?.message || driveErr);
      return res.status(500).json({
        success: false,
        message: "Drive upload failed",
        error: String(driveErr?.message || driveErr),
      });
    }

    const invoiceData = {
      url: uploadRes?.webViewLink || null,
      driveId: uploadRes?.id || null,
      filename,
      amount: amountPaise,
      currency,
      generatedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : null,
      generatedByName: req.user?.username || "Doctor",
      generatedAt: new Date(),
      razorpayPaymentLink: null,
    };

    // Persist the invoice onto the appointment via the raw driver — same
    // reasoning as doctorPanelInvoiceRoutes.js: guarantees the write lands
    // even if Mongoose strict mode would otherwise silently drop a
    // not-yet-declared subdocument path.
    try {
      await mongoose.connection.collection("physio_appointments").updateOne(
        { _id: appointmentDoc._id },
        {
          $set: {
            invoice: invoiceData,
            invoice_description: description,
            updatedAt: new Date(),
          },
        }
      );
    } catch (updateErr) {
      console.warn("Failed to persist invoice onto physio_appointments:", updateErr?.message || updateErr);
    }

    // ---- Create the payment record ----
    let paymentDoc;
    try {
      paymentDoc = await Payment.create({
        appointmentId: appointmentDoc._id,
        referenceId: invoiceNumber,
        amount: amountPaise,
        currency,
        purpose: `Manual bill — ${description}`,
        status: "created",
        doctorAssigned: doctor._id,
        customer: {
          name: appointmentDoc.patient_name,
          email: appointmentDoc.patient_email || null,
          contact: appointmentDoc.patient_phone,
        },
        invoice: {
          invoiceUrl: invoiceData.url,
          invoiceDriveId: invoiceData.driveId,
          invoiceFilename: invoiceData.filename,
          invoiceCreatedAt: invoiceData.generatedAt,
        },
        razorpay_payment_id: null,
        razorpay_order_id: null,
        raw: { createdBy: "doctor-panel-billing" },
      });
    } catch (paymentErr) {
      console.error("Failed to create payment record for manual bill:", paymentErr);
      return res.status(500).json({
        success: false,
        message: "Invoice was generated but saving the payment record failed",
        error: String(paymentErr?.message || paymentErr),
      });
    }

    // Best-effort WhatsApp send, mirrors doctorPanelInvoiceRoutes.js
    try {
      const rawPhone = appointmentDoc.patient_phone;
      if (rawPhone) {
        const amountDisplay = `₹${(amountPaise / 100).toFixed(2)}`;
        await sendTemplateMessage({
          to: rawPhone,
          templateName: process.env.SUPERFONE_INVOICE_TEMPLATE || "invoice",
          language: "en",
          params: [appointmentDoc.patient_name || "Patient", invoiceNumber, amountDisplay, invoiceData.url || ""],
        });
      }
    } catch (waErr) {
      console.warn("Superfone WA send error (manual bill):", waErr?.message || waErr);
    }

    const updatedAppointment = await PhysioAppointment.findById(appointmentDoc._id).lean();

    return res.json({
      success: true,
      message: createdNewAppointment
        ? "New patient, appointment, payment and invoice created"
        : "Payment and invoice created for existing patient",
      appointment: updatedAppointment,
      payment: paymentDoc,
      invoice: invoiceData,
      createdNewAppointment,
    });
  } catch (err) {
    console.error("Error in doctor-panel create-bill:", err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err?.message || err) });
  }
});

module.exports = router;
