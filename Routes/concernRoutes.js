// routes/concernRoutes.js
const express = require("express");
const router = express.Router();
const Concern = require("../Models/Concern");
const Appointment = require("../Models/Appointment");

const { loginRateLimiter } = require("../Middleware/rateLimit");
const LoginCredential = require("../Models/Logincredential");


// helper at top of the file (add once)
function sanitizeIdParam(raw) {
  if (!raw) return raw;
  // remove surrounding brackets if present
  let s = String(raw).replace(/^\[+/, "").replace(/\]+$/, "");
  // if it's an ObjectId, make sure it's 24 hex chars
  const match = s.match(/[0-9a-fA-F]{24}/);
  if (match) return match[0];
  return s;
}


// GET all concerns
router.get("/", loginRateLimiter, async (req, res) => {
  try {
    const concerns = await Concern.find({}, { _id: 1, concern: 1 }); // only _id and concern
    res.json(concerns);
  } catch (err) {
    console.error("Error fetching concerns:", err);
    res.status(500).json({ message: "Server Error" });
  }
});


// router.get("/:id", async (req, res) => {
//   try {
//     const rawId = req.params.id;
//     const id = sanitizeIdParam(rawId);
//     console.log("GET appointment by id (sanitized):", id, "raw:", rawId);

//     const a = await Appointment.findById(id).populate({ path: "primaryConcern", select: "concern" });
//     if (!a) return res.status(404).json({ message: "Appointment not found" });

//     res.json({
//       _id: a._id,
//       name: a.name,
//       age: a.age,
//       gender: a.gender,
//       phone: a.phone,
//       email: a.email,
//       primaryConcern: a.primaryConcern ? a.primaryConcern.concern : null,
//       appointment_date: a.appointment_date,
//       appointment_time: a.appointment_time,
//       language: a.language,
//       status: a.status || "pending",
//       doctorAssigned: a.doctorAssigned || null
//     });
//   } catch (err) {
//     console.error("Error fetching appointment by id:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });

router.get("/:id", async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = sanitizeIdParam(rawId);

    console.log("GET appointment by id (sanitized):", id);

    const a = await Appointment.findById(id)
      .populate({ path: "primaryConcern", select: "concern" });

    if (!a) return res.status(404).json({ message: "Appointment not found" });

    let doctorUsername = null;

    if (a.doctorAssigned) {
      const login = await LoginCredential.findById(a.doctorAssigned).select("username");
      doctorUsername = login ? login.username : null;
    }

    // 🔥 Convert 24-hour → 12-hour format
    let formattedTime = a.appointment_time;

    if (a.appointment_time) {
      const [hourStr, minuteStr] = a.appointment_time.split(":");
      let hour = parseInt(hourStr, 10);
      const minute = minuteStr;

      const ampm = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      hour = hour ? hour : 12; // 0 → 12

      formattedTime = `${hour}:${minute} ${ampm}`;
    }

    res.json({
      _id: a._id,
      name: a.name,
      age: a.age,
      gender: a.gender,
      phone: a.phone,
      email: a.email,
      primaryConcern: a.primaryConcern ? a.primaryConcern.concern : null,
      appointment_date: a.appointment_date,
      appointment_time: formattedTime,  // 👈 send formatted time
      language: a.language,
      status: a.status || "pending",
      doctorAssigned: doctorUsername
    });

  } catch (err) {
    console.error("Error fetching appointment by id:", err);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
