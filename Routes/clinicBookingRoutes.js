const express = require("express");
const router = express.Router();
const { sendTemplateMessage } = require("../utils/superfone");
require("dotenv").config();

const normalizePhone = (p) => {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
};

router.post("/", async (req, res) => {
  try {
    const {
      patientName,
      patientWhatsApp,
      doctorName,
      consultFee,
      ownerNumber,
    } = req.body;

    if (
      !patientName ||
      !patientWhatsApp ||
      !doctorName ||
      !consultFee ||
      !ownerNumber
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }

    const patientPhone = normalizePhone(patientWhatsApp);
    const ownerPhone = normalizePhone(ownerNumber);

    // ============================
    // 1️⃣ Send to Patient
    // ============================
    if (patientPhone) {
      await sendTemplateMessage({
        to: patientPhone,
        templateName: "pdf_template",
        language: "en_US",
        params: []  // or actual value if required
      });

      console.log("✅ Patient booking received WA sent:", patientPhone);
    }

    // ============================
    // 2️⃣ Send to Doctor / Owner
    // ============================
    if (ownerPhone) {
      await sendTemplateMessage({
        to: ownerPhone,
        templateName: "booking",
        language: "en_US",
        params: [
          patientName,          // {{1}}
          patientPhone,         // {{2}}
          doctorName,           // {{3}}
          String(consultFee)    // {{4}}
        ]
      });

      console.log("✅ Doctor booking received WA sent:", ownerPhone);
    }

    return res.json({ success: true });

  } catch (err) {
    console.error(
      "Clinic booking WA error:",
      err?.response?.data || err.message
    );
    return res.status(500).json({ success: false });
  }
});




module.exports = router;