// routes/appointmentRoutes.js
const express = require("express");
const router = express.Router();
const Appointment = require("../Models/Appointment");
const Concern = require("../Models/Concern");
const moment = require("moment-timezone");

// ✅ Add new appointment
router.post("/", async (req, res) => {
  try {
    const {
      name,
      age,
      gender,
      phone,
      email,
      primaryConcern, // concern text coming from frontend
      date,
      time,
    } = req.body;

    // 🔎 Find concern by name
    const concern = await Concern.findOne({ concern: primaryConcern });
    if (!concern) {
      return res.status(400).json({ error: "Invalid concern selected" });
    }

    // 🕒 Current date/time in Asia/Kolkata
    const now = moment().tz("Asia/Kolkata");
    const cdate = now.format("YYYY-MM-DD");
    const ctime = now.format("HH:mm:ss");

    // 🆕 Create appointment document
    const newAppointment = new Appointment({
      name,
      age,
      gender,
      phone,
      email,
      primaryConcern: concern._id, // store ObjectId of concern
      appointment_date: date,
      appointment_time: time,
      cdate,
      ctime,
    });

    await newAppointment.save();

    res.status(201).json({
      message: "Appointment stored successfully",
      appointment: newAppointment,
    });
  } catch (error) {
    console.error("Error saving appointment:", error);
    res.status(500).json({ error: "Server error while saving appointment" });
  }
});

module.exports = router;
