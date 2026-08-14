// Routes/doctorPanelInvoiceRoutes.js
//
// Invoice generation for the Doctor Panel dashboard's "My Appointments"
// detail view (DoctorPanelDashboard.jsx -> InvoiceSection), which calls:
//
//   POST /api/doctor-panel/appointments/:id/generate-invoice
//
// This mirrors Routes/invoiceRoutes.js (PDF layout, Drive upload, Superfone
// WhatsApp send) but reads/writes the Appointment model instead of
// AddSession, since `appt._id` in the doctor-panel dashboard is an
// Appointment _id, not an AddSession _id.
//
// IMPORTANT: field names below (amount_paid, invoice, patient_name, etc.)
// are inferred from how DoctorPanelDashboard.jsx reads `appt.*`. Verify
// these against your actual Appointment schema and adjust the `parseNum` /
// fallback chains as needed.

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const path = require("path");
const axios = require("axios");
const PDFDocument = require("pdfkit");

// NOTE: this dashboard's appointments (patient_name, patient_phone, concern,
// amount_paid, invoice, consent_form, sessions[]...) live in the physio
// appointment collection — the SAME model used by
// Routes/adminPhysioAppointmentRoutes.js / Routes/physioAppointmentRoutes.js
// — not in the generic "Appointment" model. Confirm this path matches
// whatever those route files import; adjust if your model file is named
// differently (e.g. Models/PhysioAppointment.js).
const Appointment = require("../Models/PhysioAppointment");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const { sendTemplateMessage } = require("../utils/superfone");

const LOGO_URL = "https://zeromedixine.com/assets/zeromedixine-CD7SGup0.png";
const FONT_PATH = path.join(__dirname, "..", "fonts", "Roboto-Regular.ttf");

async function fetchImageBuffer(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 10000,
  });
  return Buffer.from(response.data, "binary");
}

// Same visual layout as the AddSession invoice PDF in invoiceRoutes.js —
// kept in sync intentionally so invoices look identical regardless of
// whether they were generated from a package (AddSession) or a single
// appointment (Appointment).
async function generateInvoicePdfBuffer({ appointment, invoiceMeta }) {
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
      const patientName = appointment?.patient_name || appointment?.name || "Patient";
      const patientPhone =
        appointment?.patient_phone || appointment?.phone || appointment?.contact || "-";
      const patientEmail = appointment?.email || "-";

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
        .text(patientName, 320, boxTop + 30)
        .text(`Phone: ${patientPhone}`)
        .text(`Email: ${patientEmail}`);

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

      y += 60;

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

// POST /api/doctor-panel/appointments/:id/generate-invoice
router.post("/appointments/:id/generate-invoice", async (req, res) => {
  const { id } = req.params;

  try {
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id" });
    }

    const appointment = await Appointment.findById(id).lean().exec();
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    // ---- Determine invoice amount (in paise / smallest unit) ----
    // Verify these field names against your Appointment schema — this
    // tries the names DoctorPanelDashboard.jsx already reads from `appt.*`
    // (amount_paid, currency), then falls back to a few common variants,
    // then finally an explicit amount passed in the request body.
    const parseNum = (v) => {
      if (v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    let amountPaise =
      parseNum(appointment.amount_paid) ??
      parseNum(appointment.amountPaid) ??
      (parseNum(appointment.amount) !== null ? Math.round(parseNum(appointment.amount) * 100) : null) ??
      (parseNum(req.body?.amount) !== null ? parseNum(req.body.amount) : null);

    if (amountPaise === null) amountPaise = 0;

    const currency = appointment.currency || req.body?.currency || "INR";
    const desc =
    appointment.invoice_description ||
    appointment.concern ||
    appointment.session_type ||
    "Consultation";

    
    const items = [
      {
        desc,
        qty: 1,
        rate: amountPaise,
      },
    ];

    const invoiceMeta = {
      amount: amountPaise,
      currency,
      items,
      invoiceNumber: `INV-${Date.now()}`,
      generatedByName:
        (req.user && (req.user.username || req.user.name)) ||
        req.body?.generatedByName ||
        "System",
      notes: req.body?.notes || `Invoice for ${desc}`,
    };

    // 1) Generate PDF
    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePdfBuffer({ appointment, invoiceMeta });
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr);
      return res.status(500).json({
        success: false,
        message: "PDF generation failed",
        error: String(pdfErr?.message || pdfErr),
      });
    }

    // 2) Upload to Drive
    const safeName = appointment.patient_name
      ? String(appointment.patient_name).replace(/\s+/g, "_")
      : "patient";
    const filename = `${invoiceMeta.invoiceNumber}_${safeName}.pdf`;

    let uploadRes;
    try {
      uploadRes = await uploadToDriveOAuth(
        pdfBuffer,
        filename,
        "application/pdf",
        process.env.GOOGLE_DRIVE_FOLDER_INVOICE || process.env.GOOGLE_DRIVE_FOLDER_ID
      );
      if (!uploadRes || !uploadRes.id) {
        console.warn("Drive upload returned no id:", uploadRes);
      }
    } catch (driveErr) {
      console.warn("Drive upload failed:", driveErr?.message || driveErr);
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
      generatedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null,
      generatedByName: invoiceMeta.generatedByName,
      generatedAt: new Date(),
      razorpayPaymentLink: null,
    };

    // 3) Save invoice sub-document onto the physio appointment.
    //
    // IMPORTANT: this writes via the native MongoDB driver (not
    // Appointment.updateOne) because Mongoose's default strict mode
    // silently drops any $set path that isn't declared on the schema —
    // which is exactly why earlier attempts showed "Invoice Sent" in the
    // UI (from the response payload) but reverted to "Not sent" after a
    // refresh: the write never actually reached the document. Going
    // through the raw collection guarantees the field persists regardless
    // of what the Mongoose schema declares (consent_form on this same
    // collection appears to have been populated the same way).
    try {
      const writeResult = await mongoose.connection
        .collection("physio_appointments")
        .updateOne(
          { _id: appointment._id },
          { $set: { invoice: invoiceData, updatedAt: new Date() } }
        );

      if (!writeResult.matchedCount) {
        console.warn(
          "generate-invoice: no physio_appointments document matched for _id",
          appointment._id
        );
      } else if (!writeResult.modifiedCount) {
        console.warn(
          "generate-invoice: matched but did not modify document for _id",
          appointment._id
        );
      }
    } catch (updateErr) {
      console.warn(
        "Failed to persist invoice onto physio_appointments:",
        updateErr?.message || updateErr
      );
      // continue — still return the generated invoice info so the doctor
      // isn't blocked, but this case needs investigating if it recurs.
    }

    // 4) Best-effort WhatsApp send via Superfone
    try {
      const rawPhone = appointment.patient_phone || appointment.phone || appointment.contact || null;

      if (!rawPhone) {
        console.warn("No valid phone to send invoice WA for appointment:", id);
      } else {
        const amountDisplay = `₹${(amountPaise / 100).toFixed(2)}`;

        const templateParams = [
          appointment.patient_name || "Patient", // {{1}}
          invoiceMeta.invoiceNumber, // {{2}}
          amountDisplay, // {{3}}
          invoiceData.url || "", // {{4}}
        ];

        console.log("📤 Sending Superfone INVOICE WA:", {
          to: rawPhone,
          template: process.env.SUPERFONE_INVOICE_TEMPLATE || "invoice",
          params: templateParams,
        });

        await sendTemplateMessage({
          to: rawPhone,
          templateName: process.env.SUPERFONE_INVOICE_TEMPLATE || "invoice",
          language: "en",
          params: templateParams,
        });

        console.log("✅ Superfone invoice WA sent");
      }
    } catch (waErr) {
      console.warn("❌ Superfone WA send error (invoice):", waErr?.message || waErr);
    }

    return res.json({ success: true, message: "Invoice generated and saved", invoice: invoiceData });
  } catch (err) {
    console.error("Error in doctor-panel generate-invoice:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: String(err?.message || err),
    });
  }
});

module.exports = router;