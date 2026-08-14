// Routes/invoiceRoutes.js
const express = require("express");
const router = express.Router();
const AddSession = require("../Models/AddSession");
const Appointment = require("../Models/Appointment");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
// const { sendTemplateMessage } = require("../utils/aisensy"); // your WA helper
const { sendTemplateMessage } = require("../utils/superfone");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const path = require("path");
const axios = require("axios");


// Ensure you have a Unicode font (Roboto/Noto) at backend/fonts/Roboto-Regular.ttf
// const DEFAULT_FONT_PATH = path.join(__dirname, "..", "fonts", "Roboto-Regular.ttf");
// Paths
const LOGO_URL = "https://zeromedixine.com/assets/zeromedixine-CD7SGup0.png";
const FONT_PATH = path.join(__dirname, "..", "fonts", "Roboto-Regular.ttf");
// generateInvoicePdfBuffer - creates a simple invoice PDF using PDFKit and returns a Buffer
// async function generateInvoicePdfBuffer({ addSession, appointment, invoiceMeta }) {
//   return new Promise((resolve, reject) => {
//     try {
//       const doc = new PDFDocument({ size: "A4", margin: 40 });
//       // Register and set Unicode font so ₹ renders correctly
//       try {
//         doc.registerFont("AppFont", (invoiceMeta && invoiceMeta.fontPath) || DEFAULT_FONT_PATH);
//         doc.font("AppFont");
//       } catch (e) {
//         // if font registration fails, continue with default (but rupee may not render)
//         console.warn("Font registration failed:", e && e.message ? e.message : e);
//       }

//       const buffers = [];
//       doc.on("data", (chunk) => buffers.push(chunk));
//       doc.on("end", () => {
//         const pdfData = Buffer.concat(buffers);
//         resolve(pdfData);
//       });

//       // Helpers
//       const formatMoney = (valSmallest, currency = "INR") => {
//         if (valSmallest === undefined || valSmallest === null) return "-";
//         if (String(currency).toUpperCase() === "INR") {
//           const rupees = Number(valSmallest) / 100;
//           // ensure thousands separators
//           return "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
//         }
//         return String(valSmallest);
//       };
//       const safe = (v) => (v === undefined || v === null ? "-" : String(v));

//       // Header
//       doc.fontSize(18).fillColor("#1e8fd3").text("Zeromedixine", { continued: false });
//       doc.moveDown(0.2);
//       doc.fontSize(10).fillColor("#444").text("Invoice", { align: "right" });

//       doc.moveDown(0.5);
//       const invoiceNum = invoiceMeta.invoiceNumber || `INV-${Date.now()}`;
//       doc.fontSize(10).fillColor("#444").text(`Invoice No: ${invoiceNum}`, { continued: true });
//       doc.text(``, { align: "right" });
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#666").text(`Date: ${new Date().toLocaleString()}`, { align: "right" });

//       doc.moveDown(2);   // increased spacing after header

//       // From / To blocks
//       const leftX = doc.x;
//       const topY = doc.y;

//       doc.fontSize(10).fillColor("#333").text("From:", leftX, topY);
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#444");
//       doc.text("Zeromedixine Clinic");
//       doc.text("Email: support@zeromedixine.com");
//       doc.text("Phone: +91 98765 43210");

//       const toX = 330;
//       doc.fontSize(10).fillColor("#333").text("Bill To:", toX, topY);
//       doc.moveDown(0.2);
//       doc.fontSize(9).fillColor("#444");
//       const patientName = appointment?.name || (addSession?.customer && addSession.customer.name) || invoiceMeta.generatedByName || "Patient";
//       const patientPhone = appointment?.phone || appointment?.contact || (addSession?.customer && addSession.customer.contact) || "-";
//       const patientEmail = appointment?.email || (addSession?.customer && addSession.customer.email) || "-";
//       doc.text(patientName, { align: "left" });
//       doc.text(`Phone: ${patientPhone}`, { align: "left" });
//       doc.text(`Email: ${patientEmail}`, { align: "left" });

//       // extra spacing before the table
//       doc.moveDown(3);

//       // horizontal rule
//       const startX = 40;
//       const tableWidth = 515; // 40 .. 555
//       doc.moveTo(startX, doc.y).lineTo(startX + tableWidth, doc.y).strokeColor("#eeeeee").stroke();
//       doc.moveDown(0.6);

//       // items fallback
//       const items = Array.isArray(invoiceMeta.items) && invoiceMeta.items.length ? invoiceMeta.items : [
//         { desc: addSession?.package_snapshot?.package_name || "Package", qty: 1, rate: invoiceMeta.amount || 0 }
//       ];

//       // Table columns: compute from right to ensure numeric columns have fixed width
//       const gap = 10;
//       const snoWidth = 40;
//       const amountWidth = 90; // enough to keep number on single line
//       const rateWidth = 80;
//       const qtyWidth = 40;

//       const tableRight = startX + tableWidth;
//       const amountX = tableRight - amountWidth;
//       const rateX = amountX - gap - rateWidth;
//       const qtyX = rateX - gap - qtyWidth;
//       const descX = startX + snoWidth + gap;
//       const descWidth = qtyX - gap - descX;

//       // header
//       const headerY = doc.y;
//       const headerFontSize = 10;
//       const rowFontSize = 9;

//       doc.fontSize(headerFontSize).fillColor("#333");
//       doc.text("S.No", startX, headerY, { width: snoWidth, align: "left" });
//       doc.text("Description", descX, headerY, { width: descWidth, align: "left" });
//       doc.text("Qty", qtyX, headerY, { width: qtyWidth, align: "right" });
//       doc.text("Rate", rateX, headerY, { width: rateWidth, align: "right" });
//       doc.text("Amount", amountX, headerY, { width: amountWidth, align: "right" });

//       // line under header
//       const afterHeaderY = headerY + headerFontSize + 6;
//       doc.moveTo(startX, afterHeaderY).lineTo(tableRight, afterHeaderY).strokeColor("#e6e6e6").stroke();

//       // rows
//       let currentY = afterHeaderY + 8;
//       doc.fontSize(rowFontSize).fillColor("#444");

//       let subtotal = 0;
//       for (let idx = 0; idx < items.length; idx++) {
//         const it = items[idx];
//         const qty = Number(it.qty || 1);
//         const rate = Number(it.rate || 0);
//         const amount = qty * rate;
//         subtotal += amount;

//         // page break safety
//         if (currentY > doc.page.height - 100) {
//           doc.addPage();
//           currentY = 50;
//         }

//         // measure description height properly using doc.heightOfString (ensure font & size used)
//         doc.font("AppFont");
//         const descHeightEstimate = doc.heightOfString(String(it.desc || ""), { width: descWidth, align: "left", size: rowFontSize });
//         const usedHeight = Math.max(18, descHeightEstimate);

//         // render cells
//         doc.fontSize(rowFontSize).fillColor("#444");
//         doc.text(String(idx + 1), startX, currentY, { width: snoWidth, align: "left" });
//         doc.text(String(it.desc || ""), descX, currentY, { width: descWidth, align: "left" });
//         doc.text(String(qty), qtyX, currentY, { width: qtyWidth, align: "right" });
//         doc.text(formatMoney(rate, invoiceMeta.currency), rateX, currentY, { width: rateWidth, align: "right" });
//         doc.text(formatMoney(amount, invoiceMeta.currency), amountX, currentY, { width: amountWidth, align: "right" });

//         currentY += usedHeight + 6;
//       }

//       // bottom rule
//       doc.moveTo(startX, currentY).lineTo(tableRight, currentY).strokeColor("#e6e6e6").stroke();
//       currentY += 12;

//       // Subtotal / Total aligned under right columns
//       const labelX = rateX;
//       const valueX = amountX;

//       doc.fontSize(10).fillColor("#333");
//       doc.text("Subtotal", labelX, currentY, { width: rateWidth, align: "right" });
//       doc.text(formatMoney(subtotal, invoiceMeta.currency), valueX, currentY, { width: amountWidth, align: "right" });
//       currentY += 18;

//       // Total (highlight)
//       doc.fontSize(13).fillColor("#1e8fd3");
//       doc.text("Total", labelX, currentY, { width: rateWidth, align: "right" });
//       doc.text(formatMoney(subtotal, invoiceMeta.currency), valueX, currentY, { width: amountWidth, align: "right" });
//       currentY += 24;

//       // Notes / footer
//       if (invoiceMeta.notes) {
//         doc.fontSize(9).fillColor("#444").text("Notes:", startX, currentY);
//         currentY += 14;
//         doc.fontSize(9).fillColor("#666").text(invoiceMeta.notes, startX, currentY, { width: tableWidth - 20 });
//         currentY += 30;
//       }

//       doc.fontSize(9).fillColor("#666").text(`Generated by: ${invoiceMeta.generatedByName || "-"}`, startX, currentY);
//       doc.text(`Generated at: ${new Date().toLocaleString()}`, { align: "right" });

//       doc.end();
//     } catch (err) {
//       reject(err);
//     }
//   });
// }


async function fetchImageBuffer(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 10000
  });
  return Buffer.from(response.data, "binary");
}



async function generateInvoicePdfBuffer({ addSession, appointment, invoiceMeta }) {
  return new Promise(async(resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      // Font
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
      const patientName =
        appointment?.name ||
        addSession?.customer?.name ||
        "Patient";

      const patientPhone =
        appointment?.phone ||
        appointment?.contact ||
        addSession?.customer?.contact ||
        "-";

      const patientEmail =
        appointment?.email ||
        addSession?.customer?.email ||
        "-";

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

      doc
        .fillColor("#1e8fd3")
        .text("www.zeromedixine.com", { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}


// Route: POST /api/add_sessions/:addSessionId/generate-invoice
// router.post("/:addSessionId/generate-invoice", async (req, res) => {
//   try {
//     const { addSessionId } = req.params;
//     const { amount = 0, currency = "INR", items = [], notes = "" } = req.body || {};
//     const user = req.user || {}; // if you have auth middleware; fallback to req.body.generatedBy

//     if (!addSessionId || !/^[0-9a-fA-F]{24}$/.test(addSessionId)) {
//       return res.status(400).json({ success: false, message: "Invalid addSessionId" });
//     }

//     const addSession = await AddSession.findById(addSessionId).lean();
//     if (!addSession) return res.status(404).json({ success: false, message: "AddSession not found" });

//     // fetch appointment (for patient contact / name)
//     const appointment = await Appointment.findById(addSession.appointmentId).lean();

//     // build invoice metadata
//     const invoiceMeta = {
//       amount,
//       currency,
//       items,
//       invoiceNumber: `INV-${Date.now()}`,
//       generatedByName: (user.username || user.name) || (req.body.generatedByName || "System"),
//       notes,
//       // optional: allow user to override fontPath if needed
//       fontPath: req.body.fontPath || DEFAULT_FONT_PATH
//     };

//     // 1) Generate PDF buffer
//     let pdfBuffer;
//     try {
//       pdfBuffer = await generateInvoicePdfBuffer({ addSession, appointment, invoiceMeta });
//     } catch (e) {
//       console.error("PDF generation failed:", e);
//       return res.status(500).json({ success: false, message: "PDF generation failed", error: String(e.message || e) });
//     }

//     // 2) Upload to Drive using helper
//     const safeName = appointment?.name ? String(appointment.name).replace(/\s+/g, "_") : "patient";
//     const filename = `${invoiceMeta.invoiceNumber}_${safeName}.pdf`;
//     const uploadRes = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", process.env.GOOGLE_DRIVE_FOLDER_INVOICE || process.env.GOOGLE_DRIVE_FOLDER_ID);

//     const invoiceData = {
//       url: uploadRes.webViewLink || null,
//       driveId: uploadRes.id || null,
//       filename,
//       amount,
//       currency,
//       generatedBy: user._id ? mongoose.Types.ObjectId(user._id) : null,
//       generatedByName: invoiceMeta.generatedByName,
//       generatedAt: new Date(),
//       razorpayPaymentLink: null
//     };

//     // 3) Update addSession with invoice sub-doc
//     try {
//       await AddSession.updateOne({ _id: addSessionId }, { $set: { invoice: invoiceData } });
//     } catch (e) {
//       console.warn("Failed to update AddSession with invoice:", e && e.message ? e.message : e);
//     }

//     // 4) Optional: send WhatsApp using AiSensy (best-effort)
// // --- REPLACE current AiSensy send block with this ---
// try {
//     const rawPhone = appointment?.phone || appointment?.contact || (addSession.customer && addSession.customer.contact) || null;
//     let to = (rawPhone || "").replace(/\D/g, "");
//     if (to && to.length >= 10) {
//       if (to.length === 10) to = "91" + to; // quick normalization
  
//       const amountDisplay = (String(currency).toUpperCase() === "INR")
//         ? `₹${(amount || 0) / 100}`
//         : `${amount}`;
  
//       const templateName = process.env.AISENSY_INVOICE_TEMPLATE || "invoice";
//       const campaignName = process.env.AISENSY_INVOICE_CAMPAIGN || "";
  
//       // IMPORTANT: ensure the order & count of params matches your AiSensy template placeholders exactly.
//       // Template shown earlier expects 4 placeholders:
//       // 1 => patient name
//       // 2 => invoice number
//       // 3 => amount
//       // 4 => invoice url
//       const templateParams = [
//         appointment?.name || "Patient",          // {{1}}
//         invoiceMeta.invoiceNumber,               // {{2}}
//         amountDisplay,                           // {{3}}
//         invoiceData.url || ""                    // {{4}}
//       ];
  
//       const payload = {
//         to,
//         campaignName,
//         templateName,
//         params: templateParams
//       };
  
//       console.log("� AiSensy: sending campaign \"%s\" to %s (template: %s).", campaignName, to, templateName);
//       console.log("� POST payload:", payload);
  
//       await sendTemplateMessage(payload);
  
//       console.log("✅ AiSensy send success (invoice)");
//     } else {
//       console.warn("No valid phone to send invoice WA for addSession:", addSessionId);
//     }
//   } catch (waErr) {
//     console.warn("AiSensy WA send error (invoice):", waErr && (waErr.message || waErr));
//   }
  

//     return res.json({ success: true, message: "Invoice generated and saved", invoice: invoiceData });
//   } catch (err) {
//     console.error("Error in generate-invoice:", err);
//     return res.status(500).json({ success: false, message: "Server error", error: String(err && err.message ? err.message : err) });
//   }
// });


// Route: POST /api/add_sessions/:addSessionId/generate-invoice
router.post("/:addSessionId/generate-invoice", async (req, res) => {
  const { addSessionId } = req.params;
  try {
    if (!addSessionId || !/^[0-9a-fA-F]{24}$/.test(addSessionId)) {
      return res.status(400).json({ success: false, message: "Invalid addSessionId" });
    }

    // fetch addSession
    const addSession = await AddSession.findById(addSessionId).lean().exec();
    if (!addSession) return res.status(404).json({ success: false, message: "AddSession not found" });

    // fetch appointment for contact/details (if exists)
    const appointment = addSession.appointmentId ? await Appointment.findById(addSession.appointmentId).lean().exec() : null;

    // fetch the referenced session document (from Sessions collection)
    let sessionDoc = null;
    if (addSession.session) {
      try {
        // prefer using mongoose model if available; fallback to collection access
        const coll = mongoose.connection.collection("Sessions");
        sessionDoc = await coll.findOne({ _id: new mongoose.Types.ObjectId(addSession.session) });
      } catch (e) {
        console.warn("Unable to fetch session doc:", e && e.message ? e.message : e);
      }
    }

    // Determine invoice amount (INR) in paise (smallest unit)
    // Prioritise: session.price_inr -> addSession.package_snapshot.price_inr -> package_snapshot.price -> payments info -> req.body.amount
    const parseNum = (v) => {
      if (v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    let priceInr = null;
    if (sessionDoc && parseNum(sessionDoc.price_inr) !== null) priceInr = parseNum(sessionDoc.price_inr);
    else if (addSession.package_snapshot && parseNum(addSession.package_snapshot.price_inr) !== null) priceInr = parseNum(addSession.package_snapshot.price_inr);
    else if (addSession.package_snapshot && parseNum(addSession.package_snapshot.price) !== null) priceInr = parseNum(addSession.package_snapshot.price);
    else if (req.body && parseNum(req.body.amount) !== null) {
      // if user passed an amount in request body, allow it (assumed smallest unit? handle below)
      priceInr = parseNum(req.body.amount) / 100; // assume they passed paise by mistake; convert to INR
    } else if (addSession.payments && addSession.payments.length) {
      // try to infer from first payment
      const p0 = addSession.payments[0];
      if (p0 && parseNum(p0.amount) !== null) {
        // payments may be stored in paise or rupees — if amount > 1000 treat as paise
        const a = parseNum(p0.amount);
        priceInr = a > 1000 ? a / 100 : a;
      }
    }

    // If still null, default to 0
    if (priceInr === null) priceInr = 0;

    // Convert to paise integer
    const amountPaise = Math.round(Number(priceInr) * 100);

    // Build items array for invoice pdf
    const pkg = addSession.package_snapshot || {};
    const desc = pkg.package_name || pkg.concern || "Package";
    const items = [
      {
        desc: desc,
        qty: 1,
        rate: amountPaise // rate in paise (smallest currency unit)
      }
    ];

    // invoice metadata
    const invoiceMeta = {
      amount: amountPaise,
      currency: "INR",
      items,
      invoiceNumber: `INV-${Date.now()}`,
      generatedByName: (req.user && (req.user.username || req.user.name)) || (req.body.generatedByName) || "System",
      notes: req.body.notes || `Invoice for ${desc}`,
    };

    // 1) Generate PDF buffer
    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePdfBuffer({ addSession, appointment, invoiceMeta });
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr);
      return res.status(500).json({ success: false, message: "PDF generation failed", error: String(pdfErr && pdfErr.message ? pdfErr.message : pdfErr) });
    }

    // 2) Upload to Drive
    const safeName = (appointment && appointment.name) ? String(appointment.name).replace(/\s+/g, "_") : (addSession.customer && addSession.customer.name ? String(addSession.customer.name).replace(/\s+/g, "_") : "patient");
    const filename = `${invoiceMeta.invoiceNumber}_${safeName}.pdf`;
    let uploadRes;
    try {
      uploadRes = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", process.env.GOOGLE_DRIVE_FOLDER_INVOICE || process.env.GOOGLE_DRIVE_FOLDER_ID);
      if (!uploadRes || !uploadRes.id) {
        console.warn("Drive upload returned no id:", uploadRes);
      }
    } catch (driveErr) {
      console.warn("Drive upload failed:", driveErr && driveErr.message ? driveErr.message : driveErr);
      // we proceed — still attach pdf as fallback later if you want. For now return error.
      return res.status(500).json({ success: false, message: "Drive upload failed", error: String(driveErr && driveErr.message ? driveErr.message : driveErr) });
    }

    // Build invoice object to store on addSession
    const invoiceData = {
      url: (uploadRes && uploadRes.webViewLink) || null,
      driveId: (uploadRes && uploadRes.id) || null,
      filename,
      amount: amountPaise,
      currency: "INR",
      generatedBy: (req.user && req.user._id) ? mongoose.Types.ObjectId(req.user._id) : null,
      generatedByName: invoiceMeta.generatedByName,
      generatedAt: new Date(),
      razorpayPaymentLink: null
    };

    // 3) Update AddSession with invoice sub-document
    try {
      await AddSession.updateOne({ _id: addSession._id }, { $set: { invoice: invoiceData, updatedAt: new Date() } });
    } catch (updateErr) {
      console.warn("Failed to update AddSession with invoice:", updateErr && updateErr.message ? updateErr.message : updateErr);
      // but continue — still return success with invoice info
    }

    // 4) Optional: send WhatsApp template via AiSensy (best-effort)
    // try {
    //   const rawPhone = (appointment && (appointment.phone || appointment.contact)) || (addSession.customer && addSession.customer.contact) || null;
    //   let to = (rawPhone || "").replace(/\D/g, "");
    //   if (to && to.length >= 10) {
    //     if (to.length === 10) to = "91" + to; // normalize to India country code if missing

    //     const amountDisplay = `₹${(amountPaise / 100).toFixed(2)}`;

    //     const templateName = process.env.AISENSY_INVOICE_TEMPLATE || "invoice";
    //     const campaignName = process.env.AISENSY_INVOICE_CAMPAIGN || "";

    //     // Template params must match your AiSensy template placeholders exactly
    //     const templateParams = [
    //       appointment?.name || addSession?.customer?.name || "Patient", // {{1}}
    //       invoiceMeta.invoiceNumber,                                     // {{2}}
    //       amountDisplay,                                                 // {{3}}
    //       invoiceData.url || ""                                          // {{4}}
    //     ];

    //     const payload = {
    //       to,
    //       campaignName,
    //       templateName,
    //       params: templateParams
    //     };

    //     console.log("AiSensy: sending invoice WA to", to, "payload:", payload);
    //     await sendTemplateMessage(payload);
    //     console.log("AiSensy invoice WA attempted");
    //   } else {
    //     console.warn("No valid phone to send invoice WA for addSession:", addSessionId);
    //   }
    // } catch (waErr) {
    //   console.warn("AiSensy WA send error (invoice):", waErr && (waErr.message || waErr));
    // }

    // 4) Send WhatsApp via Superfone (best-effort)
try {
  const rawPhone =
    (appointment && (appointment.phone || appointment.contact)) ||
    (addSession.customer && addSession.customer.contact) ||
    null;

  if (!rawPhone) {
    console.warn("No valid phone to send invoice WA for addSession:", addSessionId);
  } else {
    const amountDisplay = `₹${(amountPaise / 100).toFixed(2)}`;

    const templateParams = [
      appointment?.name || addSession?.customer?.name || "Patient", // {{1}}
      invoiceMeta.invoiceNumber,                                     // {{2}}
      amountDisplay,                                                 // {{3}}
      invoiceData.url || ""                                          // {{4}}
    ];

    console.log("📤 Sending Superfone INVOICE WA:", {
      to: rawPhone,
      template: process.env.SUPERFONE_INVOICE_TEMPLATE || "invoice",
      params: templateParams
    });

    await sendTemplateMessage({
      to: rawPhone,
      templateName: process.env.SUPERFONE_INVOICE_TEMPLATE || "invoice",
      language: "en",
      params: templateParams
    });

    console.log("✅ Superfone invoice WA sent");
  }
} catch (waErr) {
  console.warn("❌ Superfone WA send error (invoice):", waErr?.message || waErr);
}

    // return the invoice data
    return res.json({ success: true, message: "Invoice generated and saved", invoice: invoiceData });
  } catch (err) {
    console.error("Error in generate-invoice:", err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err && err.message ? err.message : err) });
  }
});


  

// GET - fetch addSession by id
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  try {
    const addSession = await AddSession.findById(id).lean().exec();
    if (!addSession) return res.status(404).json({ success: false, message: 'addSession not found' });

    console.log('>>> GET addSession:', JSON.stringify(addSession, null, 2));
    return res.json({ success: true, addSession });
  } catch (err) {
    console.error('Error fetching addSession', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});




module.exports = router;
