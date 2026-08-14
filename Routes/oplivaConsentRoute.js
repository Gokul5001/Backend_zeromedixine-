const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");

const upload = multer({ storage: multer.memoryStorage() });

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const data = JSON.parse(req.body.data);

    const result = await uploadToDriveOAuth(
      req.file.buffer,
      "opliva-consent.pdf",
      "application/pdf",
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );

    return res.json({
      success: true,
      driveUrl: result.webViewLink,
      formData: data
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;