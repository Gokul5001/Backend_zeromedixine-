// routes/clinicPatientInvoice.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const path = require("path");
const axios = require("axios");


const ClinicPatient = require("../models/addpatient");
const Clinic = require("../Models/Clinic");
const { uploadToDriveOAuth } = require("../lib/drive-oauth"); // your helper
const { authenticateToken, requireRole } = require("../middleware/auth");


const LOGO_URL = "https://zeromedixine.com/assets/zeromedixine-CD7SGup0.png";

const FONT_PATH  = path.join(__dirname, "..", "fonts", "Roboto-Regular.ttf"); // ensure file exists

// helper to format money (INR paise -> display)
function formatMoneyPaise(paise) {
  if (paise === undefined || paise === null) return "-";
  const rupees = Number(paise) / 100;
  return "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let cachedLogo = null;
async function getLogoBuffer() {
  if (!cachedLogo) {
    const res = await axios.get(LOGO_URL, { responseType: "arraybuffer" });
    cachedLogo = Buffer.from(res.data);
  }
  return cachedLogo;
}


// generate simple invoice pdf buffer for a ClinicPatient
// async function generatePatientInvoicePdfBuffer({ patient, clinic, invoiceMeta }) {
//   return new Promise((resolve, reject) => {
//     try {
//       const doc = new PDFDocument({ size: "A4", margin: 40 });
//       try {
//         doc.registerFont("AppFont", invoiceMeta.fontPath || DEFAULT_FONT_PATH);
//         doc.font("AppFont");
//       } catch (e) {
//         console.warn("Font registration failed:", e && e.message ? e.message : e);
//       }

//       const buffers = [];
//       doc.on("data", (chunk) => buffers.push(chunk));
//       doc.on("end", () => resolve(Buffer.concat(buffers)));

//       // header — use clinic actual name (check multiple possible fields)
//       const clinicDisplayName = clinic?.clinicName || clinic?.clinic_name || clinic?.name || "Zeromedixine Clinic";
//       doc.fontSize(18).fillColor("#1e8fd3").text(clinicDisplayName);
//       doc.moveDown(0.2);
//       doc.fontSize(10).fillColor("#444").text("Invoice", { align: "right" });

//       doc.moveDown(0.4);

//       const invoiceNum = invoiceMeta.invoiceNumber || `INV-${Date.now()}`;
//       doc.fontSize(10).fillColor("#444").text(`Invoice No: ${invoiceNum}`, { continued: true });
//       doc.text(``, { align: "right" });
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#666").text(`Date: ${new Date().toLocaleString()}`, { align: "right" });

//       doc.moveDown(1);

//       // From
//       doc.fontSize(10).fillColor("#333").text("From:");
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#444");
//       doc.text(clinicDisplayName);
//       if (clinic?.email) doc.text(`Email: ${clinic.email}`);
//       if (clinic?.mobile_no) doc.text(`Phone: ${clinic.mobile_no}`);

//       // To
//       const toX = 330;
//       const topY = doc.y - 48;
//       doc.fontSize(10).fillColor("#333").text("Bill To:", toX, topY);
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#444");
//       doc.text(patient.name || "-", { align: "left" });
//       doc.text(`Phone: ${patient.mobile || "-"}`, { align: "left" });
//       if (patient.address) doc.text(patient.address, { align: "left" });

//       doc.moveDown(2);

//       // table header
//       const startX = 40;
//       const tableWidth = 515;
//       const snoWidth = 40;
//       const amountWidth = 90;
//       const rateWidth = 80;
//       const qtyWidth = 40;
//       const gap = 10;
//       const tableRight = startX + tableWidth;
//       const amountX = tableRight - amountWidth;
//       const rateX = amountX - gap - rateWidth;
//       const qtyX = rateX - gap - qtyWidth;
//       const descX = startX + snoWidth + gap;
//       const descWidth = qtyX - gap - descX;
//       const headerY = doc.y;

//       doc.fontSize(10).fillColor("#333");
//       doc.text("S.No", startX, headerY, { width: snoWidth, align: "left" });
//       doc.text("Description", descX, headerY, { width: descWidth, align: "left" });
//       doc.text("Qty", qtyX, headerY, { width: qtyWidth, align: "right" });
//       doc.text("Rate", rateX, headerY, { width: rateWidth, align: "right" });
//       doc.text("Amount", amountX, headerY, { width: amountWidth, align: "right" });

//       const afterHeaderY = headerY + 18;
//       doc.moveTo(startX, afterHeaderY).lineTo(tableRight, afterHeaderY).strokeColor("#e6e6e6").stroke();

//       let currentY = afterHeaderY + 10;
//       doc.fontSize(9).fillColor("#444");

//       // items fallback
//       const items = Array.isArray(invoiceMeta.items) && invoiceMeta.items.length ? invoiceMeta.items : [
//         { desc: invoiceMeta.description || (patient.treatment || "Treatment"), qty: 1, rate: invoiceMeta.amount || 0 }
//       ];

//       let subtotalPaise = 0;
//       for (let i = 0; i < items.length; i++) {
//         const it = items[i];
//         const qty = Number(it.qty || 1);
//         const ratePaise = Number(it.rate || 0); // paise
//         const amountPaise = qty * ratePaise;
//         subtotalPaise += amountPaise;

//         // page break
//         if (currentY > doc.page.height - 120) {
//           doc.addPage();
//           currentY = 50;
//         }

//         // description height
//         const descHeightEstimate = doc.heightOfString(String(it.desc || ""), { width: descWidth, align: "left", size: 9 });
//         const used = Math.max(18, descHeightEstimate);

//         doc.text(String(i + 1), startX, currentY, { width: snoWidth, align: "left" });
//         doc.text(String(it.desc || ""), descX, currentY, { width: descWidth, align: "left" });
//         doc.text(String(qty), qtyX, currentY, { width: qtyWidth, align: "right" });
//         doc.text(formatMoneyPaise(ratePaise), rateX, currentY, { width: rateWidth, align: "right" });
//         doc.text(formatMoneyPaise(amountPaise), amountX, currentY, { width: amountWidth, align: "right" });

//         currentY += used + 6;
//       }

//       // totals
//       doc.moveTo(startX, currentY).lineTo(tableRight, currentY).strokeColor("#e6e6e6").stroke();
//       currentY += 12;

//       doc.fontSize(10).fillColor("#333");
//       doc.text("Subtotal", rateX, currentY, { width: rateWidth, align: "right" });
//       doc.text(formatMoneyPaise(subtotalPaise), amountX, currentY, { width: amountWidth, align: "right" });
//       currentY += 18;

//       doc.fontSize(13).fillColor("#1e8fd3");
//       doc.text("Total", rateX, currentY, { width: rateWidth, align: "right" });
//       doc.text(formatMoneyPaise(subtotalPaise), amountX, currentY, { width: amountWidth, align: "right" });
//       currentY += 24;

//       if (invoiceMeta.notes) {
//         doc.fontSize(9).fillColor("#444").text("Notes:", startX, currentY);
//         currentY += 12;
//         doc.fontSize(9).fillColor("#666").text(invoiceMeta.notes, startX, currentY, { width: tableWidth - 20 });
//         currentY += 20;
//       }

//       doc.fontSize(9).fillColor("#666").text(`Generated by: ${invoiceMeta.generatedByName || "-"}`, startX, currentY);
//       doc.text(`Generated at: ${new Date().toLocaleString()}`, { align: "right" });

//       doc.end();
//     } catch (err) {
//       reject(err);
//     }
//   });
// }

async function generatePatientInvoicePdfBuffer({ patient, clinic, invoiceMeta }) {
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
        const logo = await getLogoBuffer();
        doc.image(logo, 40, 22, { width: 130 });
      } catch {}

      doc
        .fillColor("#1e8fd3")
        .fontSize(22)
        .text("INVOICE", 0, 30, { align: "right" });

      doc
        .fontSize(10)
        .fillColor("#444")
        .text(`Invoice No: ${invoiceMeta.invoiceNumber}`, { align: "right" })
        .text(`Date: ${new Date().toLocaleDateString("en-IN")}`, {
          align: "right",
        });

      doc.moveDown(5);

      /* ================= FROM / TO ================= */
      const clinicName =
        clinic?.clinicName ||
        clinic?.clinic_name ||
        clinic?.name ||
        "Zeromedixine Clinic";
      

      const boxTop = doc.y;

      doc.roundedRect(40, boxTop, 240, 90, 8).stroke("#d9eaf7");
      doc.roundedRect(310, boxTop, 240, 90, 8).stroke("#d9eaf7");

      // FROM
      doc.fillColor("#1e8fd3").fontSize(11).text("FROM", 50, boxTop + 10);
      doc
        .fontSize(9)
        .fillColor("#333")
        .text(clinicName, 50, boxTop + 30);
      if (clinic?.email) doc.text(`Email: ${clinic.email}`);
      if (clinic?.mobile_no) doc.text(`Phone: ${clinic.mobile_no}`);

      // TO
      doc.fillColor("#1e8fd3").fontSize(11).text("BILL TO", 320, boxTop + 10);
      doc
        .fontSize(9)
        .fillColor("#333")
        .text(patient.name || "Patient", 320, boxTop + 30)
        .text(`Phone: ${patient.mobile || "-"}`);
      if (patient.address) doc.text(patient.address);

      doc.moveDown(7);

      /* ================= TABLE (RIGHT-ANCHORED) ================= */
      const pageRight = doc.page.width - 40;
      const startX = 40;

      const col = {
        sno: 40,
        desc: 300,
        qty: 50,
        rate: 80,
        amount: 90
      };

      const x = {
        sno: startX,
        desc: startX + col.sno + 10,
        qty: pageRight - col.amount - col.rate - col.qty - 40,
        rate: pageRight - col.amount - col.rate - 20,
        amount: pageRight - col.amount
      };

      let y = doc.y;

      doc.rect(startX, y - 6, pageRight - startX, 26).fill("#f1f9ff");

      doc.fillColor("#1e8fd3").fontSize(10);
      doc.text("S.No", x.sno, y);
      doc.text("Description", x.desc, y);
      doc.text("Qty", x.qty, y, { width: col.qty, align: "center" });
      doc.text("Rate", x.rate, y, { width: col.rate, align: "right" });
      doc.text("Amount", x.amount, y, { width: col.amount, align: "right" });

      y += 30;
      doc.fontSize(9).fillColor("#333");

      let total = 0;

      invoiceMeta.items.forEach((it, i) => {
        const amt = it.qty * it.rate;
        total += amt;

        doc.text(i + 1, x.sno, y);
        doc.text(it.desc, x.desc, y, { width: col.desc });
        doc.text(it.qty, x.qty, y, { width: col.qty, align: "center" });
        doc.text(`₹${(it.rate / 100).toFixed(2)}`, x.rate, y, { width: col.rate, align: "right" });
        doc.text(`₹${(amt / 100).toFixed(2)}`, x.amount, y, { width: col.amount, align: "right" });

        y += 22;
      });

      /* ================= TOTAL PILL ================= */
      y += 12;
      const totalBoxWidth = col.rate + col.amount + 24;
      const totalBoxX = pageRight - totalBoxWidth;

      doc.roundedRect(totalBoxX, y, totalBoxWidth, 38, 10).fill("#1e8fd3");
      doc.fillColor("#fff").fontSize(14);
      doc.text("TOTAL", totalBoxX + 10, y + 11);
      doc.text(`₹${(total / 100).toFixed(2)}`, totalBoxX, y + 11, {
        width: totalBoxWidth - 12,
        align: "right"
      });

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

// POST /api/clinics/patients/:patientId/generate-invoice
// clinic-auth required
router.post("/:patientId/generate-invoice", authenticateToken, requireRole("clinic"), async (req, res) => {
  try {
    const clinicUserId = req.user?.id;
    if (!clinicUserId || !mongoose.Types.ObjectId.isValid(clinicUserId)) {
      return res.status(401).json({ success: false, message: "Invalid clinic authentication" });
    }

    const patientId = (req.params.patientId || "").trim();
    if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ success: false, message: "Invalid patient id" });
    }

    // ensure patient belongs to this clinic
    const patient = await ClinicPatient.findById(patientId).lean().exec();
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    if (String(patient.clinic) !== String(clinicUserId)) {
      return res.status(403).json({ success: false, message: "Not allowed to create invoice for this patient" });
    }

    // fetch clinic info for "From" block
    const clinic = await Clinic.findById(clinicUserId).lean().catch(() => null);

    // Build invoice metadata
    // Accept amount from body (paise). If frontend passed rupees converted to paise, frontend sends paise already.
    // Fallback: 70000 paise (₹700)
    const amountPaise = (req.body && typeof req.body.amount !== "undefined" && req.body.amount !== null)
      ? Number(req.body.amount)
      : 70000;

    // items: expect rates in paise
    const items = (req.body && Array.isArray(req.body.items) && req.body.items.length)
      ? req.body.items
      : [{ desc: req.body?.description || (patient.treatment || "Treatment"), qty: 1, rate: amountPaise }];

    const invoiceMeta = {
      amount: amountPaise,
      currency: "INR",
      items,
      invoiceNumber: `INV-${Date.now()}`,
      generatedByName: (req.user && (req.user.username || req.user.name)) || (req.body.generatedByName) || "Clinic",
      notes: req.body.notes || `Invoice for ${patient.treatment || "treatment"}`,
      fontPath: req.body.fontPath || FONT_PATH,
      description: req.body.description || (patient.treatment || "Treatment")
    };

    // Generate PDF buffer
    let pdfBuffer;
    try {
      pdfBuffer = await generatePatientInvoicePdfBuffer({ patient, clinic, invoiceMeta });
    } catch (pdfErr) {
      console.error("PDF generation error:", pdfErr);
      return res.status(500).json({ success: false, message: "PDF generation failed", error: String(pdfErr && pdfErr.message ? pdfErr.message : pdfErr) });
    }

    // Upload to Drive
    const safeName = (patient.name ? String(patient.name).replace(/\s+/g, "_") : "patient");
    const filename = `${invoiceMeta.invoiceNumber}_${safeName}.pdf`;
    let uploadRes;
    try {
      uploadRes = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", process.env.CLINIC_INVOICE_GOOGLE_DRIVE_FOLDER_ID || null);
      if (!uploadRes || !uploadRes.id) {
        console.warn("Drive upload no id", uploadRes);
      }
    } catch (driveErr) {
      console.error("Drive upload failed:", driveErr && driveErr.message ? driveErr.message : driveErr);
      return res.status(500).json({ success: false, message: "Drive upload failed", error: String(driveErr && driveErr.message ? driveErr.message : driveErr) });
    }

    // invoice object to save on patient document
    const invoiceData = {
      url: uploadRes.webViewLink || null,
      driveId: uploadRes.id || null,
      filename,
      amount: invoiceMeta.amount,
      currency: invoiceMeta.currency || "INR",
      generatedByName: invoiceMeta.generatedByName,
      generatedAt: new Date()
    };

    // update ClinicPatient document
    try {
      await ClinicPatient.updateOne({ _id: patient._id }, { $set: { invoice: invoiceData, updatedAt: new Date() } });
    } catch (updateErr) {
      console.warn("Failed to update ClinicPatient with invoice:", updateErr && updateErr.message ? updateErr.message : updateErr);
    }

    return res.json({ success: true, message: "Invoice generated and saved", invoice: invoiceData });
  } catch (err) {
    console.error("Error /generate-invoice:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;
