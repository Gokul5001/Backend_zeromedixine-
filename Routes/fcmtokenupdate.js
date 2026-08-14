const express = require("express");
const router = express.Router();
const FcmDevice = require("../models/FcmDevice");

router.post("/update", async (req, res) => {
  const { userId, role, token, deviceType, clinicId } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ message: "userId and token required" });
  }

  try {
    // Remove old token if exists
    await FcmDevice.findOneAndDelete({ token });

    // Save new token
    await FcmDevice.create({
      userId,
      role,
      token,
      deviceType,
      clinicId: clinicId || null,
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
