const express = require("express");
const router = express.Router();

const ForParentsAppointment = require("../models/ForParentsAppointment");

const {
  sendForParentsPatientConfirmation,
  sendForParentsAdminAlert
} = require("../utils/forParentsWhatsApp");

const normalizePhone = require("../utils/normalizePhone");

router.post("/consultation", async (req, res) => {
  try {
    const { name, email, phone, age, message } = req.body;

    if (!name || !email || !phone || !age || !message) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // ==========================
    // 1️⃣ STORE IN NEW COLLECTION
    // ==========================
    const newLead = await ForParentsAppointment.create({
      name,
      email,
      phone,
      age,
      message
    });

    console.log("✅ For Parents lead stored:", newLead._id);

    const normalizedPhone = normalizePhone(phone);

    // ==========================
    // 2️⃣ PATIENT WHATSAPP
    // ==========================
    try {
      await sendForParentsPatientConfirmation({
        to: normalizedPhone,
        name
      });
      console.log("📤 Patient WA sent");
    } catch (err) {
      console.error("⚠ Patient WA failed:", err.message);
    }

    // ==========================
    // 3️⃣ ADMIN WHATSAPP
    // ==========================
    try {
      const adminNumber = process.env.OPLIVA_ADMIN_NUMBER;

      if (adminNumber) {
        await sendForParentsAdminAlert({
          to: adminNumber,
          name,
          phone: normalizedPhone,
          age
        });
        console.log("📤 Admin WA sent");
      }
    } catch (err) {
      console.error("⚠ Admin WA failed:", err.message);
    }

    return res.status(201).json({
      success: true,
      message: "For Parents consultation stored & notifications sent"
    });

  } catch (error) {
    console.error("For Parents consultation error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

module.exports = router;