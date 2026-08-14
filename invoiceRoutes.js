// Routes/invoiceRoutes.js
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const streamBuffers = require("stream-buffers");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const axios = require("axios");
require("dotenv").config();

// AiSensy settings (configure in .env)
const AISENSY_API_URL = process.env.AISENSY_API_URL;
const AISENSY_API_KEY = process.env.AISENSY_API_KEY || ""; // required
const AISENSY_CAMPAIGN_NAME = process.env.AISENSY_CAMPAIGN_NAME || ""; // optional if you use direct templateName

// Helper: generate PDF buffer (same as before)
async function generateInvoicePdfBuffer({ invoiceNumber, dateStr, patient, package_snapshot, sessions, amountStr }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const writableStream = new streamBuffers.WritableStreamBuffer({
        initialSize: (100 * 1024),
        incrementAmount: (10 * 1024)
      });

      // Build a simple invoice (logo optional)
      doc.fontSize(20).text("Zeromedixine", { align: "left" });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("#666").text("Invoice", { align: "right" });
      doc.fontSize(9).fillColor("#333").text(`Invoice No: ${invoiceNumber}`, { align: "right" });
      doc.text(`Date: ${dateStr}`, { align: "right" });
      doc.moveDown();

      doc.fontSize(12).fillColor("#333").text("Bill To:");
      doc.fontSize(10).fillColor("#444").text(`${patient.name || "-"}`);
      doc.text(`${patient.contact || "-"}`);
      if (patient.email) doc.text(patient.email);
      doc.moveDown();

      const startX = doc.x;
      const tableTop = doc.y;
      const col1 = startX;
      const col2 = startX + 300;
      doc.fontSize(10).text("Description", col1, tableTop);
      doc.text("Amount", col2, tableTop);
      doc.moveDown(0.5);

      const descLines = [];
      descLines.push(package_snapshot.package_name || "Package");
      if (package_snapshot.concern) descLines.push(`Concern: ${package_snapshot.concern}`);
      if (package_snapshot.duration_weeks) descLines.push(`Duration: ${package_snapshot.duration_weeks} weeks`);
      const desc = descLines.join(" | ");

      doc.fontSize(10).text(desc, { continued: false, width: 320 });
      doc.text(amountStr || "-", col2, doc.y - 12);

      if (sessions && sessions.length) {
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Sessions (${sessions.length}):`, { continued: false });
        sessions.forEach((s, idx) => {
          const sdesc = `Session ${s.index || idx+1} — ${s.date || "-"} ${s.time || ""}`;
          doc.fontSize(9).text(sdesc);
        });
      }

      doc.moveDown(1);
      doc.fontSize(11).text("Total", { continued: true });
      doc.text(amountStr || "-", { align: "right" });
      doc.moveDown(2);

      doc.fontSize(9).fillColor("#666").text("Thank you for choosing Zeromedixine.", { align: "center" });

      doc.end();

      doc.pipe(writableStream);
      writableStream.on("finish", () => {
        const buffer = writableStream.getContents();
        resolve(buffer);
      });
      writableStream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// POST /api/invoice/send
router.post("/send", async (req, res) => {
  try {
    const {
      appointmentId,
      addSessionId,
      sessionIndex,
      patientName,
      patientPhone,
      package_snapshot,
      sessions,
    } = req.body;

    if (!patientPhone) return res.status(400).json({ success: false, message: "Missing patient phone" });

    // invoice metadata
    const invoiceNumber = `INV-${Date.now()}`;
    const dateStr = new Date().toLocaleDateString();

    let amountStr = "-";
    if (package_snapshot && (package_snapshot.price_inr || package_snapshot.price)) {
      const amt = package_snapshot.price_inr || package_snapshot.price;
      if (typeof amt === "number" && amt > 1000 && String(amt).length > 3) {
        amountStr = `₹${(amt / 100).toFixed(2)}`;
      } else {
        amountStr = `₹${amt}`;
      }
    }

    const patient = { name: patientName || "", contact: patientPhone };

    // generate PDF buffer
    const pdfBuffer = await generateInvoicePdfBuffer({
      invoiceNumber,
      dateStr,
      patient,
      package_snapshot,
      sessions,
      amountStr
    });

    const filename = `invoice_${appointmentId || addSessionId || invoiceNumber}.pdf`;
    const folderId = process.env.GOOGLE_DRIVE_INVOICE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_INVOICE || null;
    const uploadRes = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", folderId);
    const driveLink = uploadRes.webViewLink ? uploadRes.webViewLink : (uploadRes.id ? `https://drive.google.com/file/d/${uploadRes.id}/view` : null);

    // ----- Send via AiSensy -----
    // AiSensy expects: apiKey, campaignName (or templateName), destination (full phone like +91...), templateParams or mediaUrl
    // You must create a template or API campaign in AiSensy and allow passing a media param (if sending file)
    try {
      if (!AISENSY_API_KEY) {
        console.warn("AISENSY_API_KEY not set - skipping AiSensy send");
      } else {
        // Destination number: ensure E.164, AiSensy docs expect +country format (e.g. +9198xxxx)
        const destination = patientPhone.startsWith("+") ? patientPhone : ("+" + patientPhone.replace(/\D/g, ""));

        // Build payload - adjust keys if your AiSensy account requires different names.
        // Common required fields: apiKey, campaignName (or templateName), destination, userName, templateParams, mediaUrl
        const payload = {
          apiKey: AISENSY_API_KEY,
          campaignName: AISENSY_CAMPAIGN_NAME || "InvoiceCampaign",
          destination,
          userName: patient.name || "",
          // templateParams: list of string parameters for your template placeholders
          templateParams: [ invoiceNumber, amountStr, dateStr, driveLink || "" ],
          // If your template expects media file as parameter, you may instead pass `mediaUrl: driveLink`
          mediaUrl: driveLink || undefined
        };

        // Example endpoint from AiSensy docs:
        const resp = await axios.post(AISENSY_API_URL, payload, { timeout: 20000 });

        // Check response structure; AiSensy returns HTTP 200 for enqueued campaign sends
        if (resp && (resp.status === 200 || (resp.data && resp.data.success))) {
          // ok
          console.log("AiSensy send response:", resp.data || resp.status);
        } else {
          console.warn("AiSensy responded with non-200:", resp.status, resp.data);
        }
      }
    } catch (aisErr) {
      console.error("AiSensy send error (non-fatal):", aisErr.response ? aisErr.response.data : aisErr.message);
      // continue — return drive link to caller and don't fail whole flow
    }

    // return success (drive link)
    return res.json({ success: true, driveLink, driveId: uploadRes.id || null });
  } catch (err) {
    console.error("Invoice send error:", err);
    return res.status(500).json({ success: false, message: "Server error generating invoice" });
  }
});

module.exports = router;
