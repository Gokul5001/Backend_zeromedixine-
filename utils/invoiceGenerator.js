// utils/invoiceGenerator.js
const PDFDocument = require("pdfkit");

function generateInvoicePdfBuffer({
  invoiceNumber, patientName, patientPhone, patientEmail,
  doctorName, purpose, amount, currency, notes, date,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const symbol = currency === "USD" ? "$" : "₹";

      doc.fontSize(20).text("Zeromedixine", { align: "left" });
      doc.fontSize(10).fillColor("#555").text("House of Humans Healthcare Pvt. Ltd.");
      doc.moveDown(1.5);

      doc.fillColor("#000").fontSize(16).text("Invoice", { align: "right" });
      doc.fontSize(10).text(`Invoice No: ${invoiceNumber}`, { align: "right" });
      doc.text(`Date: ${date}`, { align: "right" });
      doc.moveDown(1.5);

      doc.fontSize(12).text("Billed To:", { underline: true });
      doc.fontSize(10).text(patientName || "-");
      if (patientPhone) doc.text(`Phone: ${patientPhone}`);
      if (patientEmail) doc.text(`Email: ${patientEmail}`);
      doc.moveDown();

      doc.fontSize(12).text("Consulting Doctor:", { underline: true });
      doc.fontSize(10).text(doctorName || "-");
      doc.moveDown(1.5);

      const top = doc.y;
      doc.fontSize(11).text("Description", 50, top);
      doc.text("Amount", 400, top);
      doc.moveTo(50, top + 18).lineTo(545, top + 18).stroke();

      doc.fontSize(10).text(purpose || "Consultation / Session", 50, top + 26);
      doc.text(`${symbol}${amount.toFixed(2)}`, 400, top + 26);

      doc.moveTo(50, top + 50).lineTo(545, top + 50).stroke();
      doc.fontSize(12).text("Total", 350, top + 60);
      doc.text(`${symbol}${amount.toFixed(2)}`, 400, top + 60);

      if (notes) {
        doc.moveDown(3);
        doc.fontSize(10).fillColor("#555").text(`Notes: ${notes}`);
      }

      doc.moveDown(3);
      doc.fontSize(9).fillColor("#999").text("This is a system-generated invoice.", { align: "center" });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePdfBuffer };