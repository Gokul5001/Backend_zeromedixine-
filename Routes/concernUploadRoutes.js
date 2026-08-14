const express = require("express");
const router = express.Router();
const { uploadToDriveOAuth } = require("../lib/drive-oauth");

router.post("/", async (req, res) => {
  try {
    const { patientId, name, age, concern, pdfBase64, filename } = req.body;

    if (!pdfBase64) return res.json({ success: false });

    const buffer = Buffer.from(pdfBase64, "base64");

    const result = await uploadToDriveOAuth(
      buffer,
      filename,
      "application/pdf",
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );

    return res.json({
      success: true,
      driveUrl: `https://drive.google.com/file/d/${result.id}/view`
    });
  } catch (err) {
    console.error("Consent upload error:", err);
    res.json({ success: false });
  }
});

module.exports = router;
