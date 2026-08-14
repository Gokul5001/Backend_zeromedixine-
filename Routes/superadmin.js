// Routes/superadmin.js
const express = require("express");
const router = express.Router();
const SuperAdmin = require("../Models/SuperAdminCredential");
const Appointment = require("../Models/Appointment");

// Simple plaintext login (keeps it minimal)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ success: false, message: "Missing username/password" });

    const user = await SuperAdmin.findOne({ username }).lean();
    if (!user || user.password !== password) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    // success -> send minimal user object
    return res.json({
      success: true,
      user: { _id: user._id, username: user.username, role: "superadmin" }
    });
  } catch (err) {
    console.error("superadmin login error:", err);
    return res.json({ success: false, message: "Server error" });
  }
});

// GET /api/superadmin/appointments  -> return all appointments
router.get("/appointments", async (req, res) => {
  try {
    const docs = await Appointment.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: docs.length, appointments: docs });
  } catch (err) {
    console.error("fetch appointments error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/superadmin/appointments/:id -> return single appointment by _id
router.get("/appointments/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Appointment.findById(id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, appointment: doc });
  } catch (err) {
    console.error("fetch appointment by id error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
